import type { Category } from "../diagnosis/categories";
import type { Fetch } from "../lib/doh";
import { decryptUrl, encryptUrl, type Sealed } from "./crypto";

/**
 * Slack/Discord webhooks (FR-52 to FR-54, TDD §11). Only two exact hosts, https only. The URL is a credential:
 * it's encrypted at rest, shown masked, never logged and never sent to the LLM.
 */
export type WebhookKind = "slack" | "discord";
export type NotifyEvent = "opened" | "mitigated" | "resolved";

const DISCORD_HOSTS = new Set(["discord.com", "discordapp.com"]);
const MAX_URL = 512;
const SEND_TIMEOUT_MS = 10_000;

export function parseWebhookUrl(raw: string): { ok: true; kind: WebhookKind; url: string } | { ok: false; message: string } {
  const bad = (message: string) => ({ ok: false as const, message });
  if (raw.length > MAX_URL) return bad("That URL is too long for a webhook.");
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return bad("That isn't a valid URL.");
  }
  if (u.protocol !== "https:") return bad("Webhook URLs must start with https://.");
  if (u.username || u.password || u.port) return bad("Webhook URLs can't carry a login or a port.");
  if (u.hostname === "hooks.slack.com" && u.pathname.length > 1) return { ok: true, kind: "slack", url: u.href };
  if (DISCORD_HOSTS.has(u.hostname) && u.pathname.startsWith("/api/webhooks/")) return { ok: true, kind: "discord", url: u.href };
  return bad("Only Slack (hooks.slack.com) and Discord (discord.com/api/webhooks/…) webhook URLs are allowed.");
}

/** `hooks.slack.com/…/••••abcd`: enough to recognise it, not enough to use it. */
export function maskUrl(url: string): string {
  const u = new URL(url);
  const tail = u.pathname.replace(/\/+$/, "").slice(-4);
  return `${u.hostname}/…/••••${tail}`;
}

export type MessageInput = { event: NotifyEvent | "test"; target: string; category?: Category | null; cause?: string | null; link?: string | null };

/** One short message. Evidence refs like [http-1] are dropped: they mean nothing outside the app. */
export function formatMessage(kind: WebhookKind, m: MessageInput): { text: string } | { content: string } {
  const bold = (s: string) => (kind === "slack" ? `*${s}*` : `**${s}**`);
  const host = safeHost(m.target);
  const lines: string[] = [];
  switch (m.event) {
    case "test":
      lines.push(`✅ ${bold("Incident Copilot test message")}: this webhook works.`);
      break;
    case "opened": {
      lines.push(`🔴 ${bold(`Watch alert: ${host} is failing`)}. An incident was opened and diagnosed.`);
      const cause = m.cause?.replace(/\s*\[[a-z]+-\d+\]/g, "").trim();
      if (m.category && m.category !== "inconclusive") lines.push(`Likely cause (${m.category.replace(/_/g, " ")}): ${cause || "see the incident"}`);
      else lines.push("The diagnosis was inconclusive; the evidence is in the incident.");
      break;
    }
    case "mitigated":
      lines.push(`🟡 ${bold(`${host} is recovering`)}: a check passed. It resolves after 3 passing checks in a row.`);
      break;
    case "resolved":
      lines.push(`🟢 ${bold(`${host} is resolved`)}: 3 passing checks in a row.`);
      break;
  }
  if (m.link) lines.push(m.link);
  const text = lines.join("\n");
  return kind === "slack" ? { text } : { content: text };
}

export type SendResult = { sent: true } | { sent: false; permanent: true; status: number };

/** Thrown for failures worth retrying (429, 5xx, network, timeout), so a Workflow step tries again. */
export class RetryableSendError extends Error {
  override name = "RetryableSendError";
}

/**
 * POSTs the message. A 4xx other than 429 is permanent (a deleted or wrong webhook): no retry. Redirects aren't
 * followed, so the request can't be bounced to another host.
 */
export async function sendWebhook(url: string, body: object, f: Fetch = (i, init) => fetch(i, init)): Promise<SendResult> {
  let res: Response;
  try {
    res = await f(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (e) {
    throw new RetryableSendError(`webhook request failed: ${(e as Error).name}`);
  }
  if (res.status >= 200 && res.status < 300) return { sent: true };
  if (res.status === 429 || res.status >= 500) throw new RetryableSendError(`webhook answered ${res.status}`);
  return { sent: false, permanent: true, status: res.status };
}

function safeHost(target: string): string {
  try {
    const u = new URL(target);
    return u.pathname.length > 1 ? `${u.hostname}${u.pathname}` : u.hostname;
  } catch {
    return target;
  }
}

// ---- D1 (`webhooks`, one per workspace) ----

/** D1 may hand BLOBs back as an ArrayBuffer or as an array of byte values; `Uint8Array` takes either. */
type BlobValue = ArrayBuffer | number[];
type WebhookRow = { workspace_id: string; kind: WebhookKind; url_ciphertext: BlobValue; iv: BlobValue; url_hint: string; app_origin: string | null };

export type WebhookInfo = { kind: WebhookKind; hint: string };

export async function getWebhookInfo(db: D1Database, workspaceId: string): Promise<WebhookInfo | null> {
  const row = await db.prepare("SELECT kind, url_hint FROM webhooks WHERE workspace_id = ?1").bind(workspaceId).first<{ kind: WebhookKind; url_hint: string }>();
  return row ? { kind: row.kind, hint: row.url_hint } : null;
}

/** Encrypts and stores the URL (replacing any earlier one) with the app origin for incident links. */
export async function putWebhook(db: D1Database, key: CryptoKey, p: { workspaceId: string; kind: WebhookKind; url: string; appOrigin: string }): Promise<WebhookInfo> {
  const sealed = await encryptUrl(key, p.url, p.workspaceId);
  const hint = maskUrl(p.url);
  await db
    .prepare(
      `INSERT INTO webhooks (workspace_id, kind, url_ciphertext, iv, url_hint, created_at, app_origin) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (workspace_id) DO UPDATE SET kind = excluded.kind, url_ciphertext = excluded.url_ciphertext, iv = excluded.iv,
         url_hint = excluded.url_hint, created_at = excluded.created_at, app_origin = excluded.app_origin`,
    )
    .bind(p.workspaceId, p.kind, sealed.ciphertext, sealed.iv, hint, Date.now(), p.appOrigin)
    .run();
  return { kind: p.kind, hint };
}

export async function deleteWebhook(db: D1Database, workspaceId: string): Promise<void> {
  await db.prepare("DELETE FROM webhooks WHERE workspace_id = ?1").bind(workspaceId).run();
}

/** The decrypted webhook for sending, or null if there's none (or it can't be decrypted, which is logged). */
export async function loadWebhook(db: D1Database, key: CryptoKey, workspaceId: string): Promise<{ kind: WebhookKind; url: string; appOrigin: string | null } | null> {
  const row = await db.prepare("SELECT * FROM webhooks WHERE workspace_id = ?1").bind(workspaceId).first<WebhookRow>();
  if (!row) return null;
  try {
    const sealed: Sealed = { ciphertext: new Uint8Array(row.url_ciphertext), iv: new Uint8Array(row.iv) };
    return { kind: row.kind, url: await decryptUrl(key, sealed, workspaceId), appOrigin: row.app_origin };
  } catch {
    console.error("a stored webhook couldn't be decrypted (was WEBHOOK_KEY changed?)", workspaceId);
    return null;
  }
}

export const incidentLink = (appOrigin: string | null, incidentId: string) => (appOrigin ? `${appOrigin}/i/${incidentId}` : null);
