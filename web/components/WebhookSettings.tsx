import { Button, SensitiveInput, Sidebar } from "@cloudflare/kumo";
import { DiscordLogoIcon, SlackLogoIcon } from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent } from "react";
import { getWebhook, removeWebhook, saveWebhook, testWebhook, WEBHOOK_ERROR_TEXT, type WebhookState } from "../lib/api";
import { CtaButton } from "./CtaButton";

const KIND_TEXT = { slack: "Slack", discord: "Discord" } as const;

/**
 * One Slack or Discord webhook per workspace (FR-52, FR-53, TDD §12.1). Webhooks fire for watched incidents only
 * (D18). Browser notifications are the header's switch. Both logos are grey until a webhook is saved; then its
 * app's logo takes its brand colour.
 */
export function WebhookSettings() {
  const [hook, setHook] = useState<WebhookState | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; alert: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    void getWebhook().then((r) => live && r.ok && setHook(r.value));
    return () => {
      live = false;
    };
  }, []);

  const run = async <T,>(fn: () => Promise<{ ok: true; value: T } | { ok: false; error: keyof typeof WEBHOOK_ERROR_TEXT; message?: string }>, ok: (v: T) => void) => {
    setBusy(true);
    setNote(null);
    const r = await fn();
    setBusy(false);
    if (r.ok) ok(r.value);
    else setNote({ text: r.message ?? WEBHOOK_ERROR_TEXT[r.error], alert: true });
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    void run(
      () => saveWebhook(url.trim()),
      (info) => {
        setUrl("");
        setHook({ available: true, webhook: info });
        setNote({ text: "Saved. Watched incidents will post here.", alert: false });
      },
    );
  };

  const kind = hook?.webhook?.kind;
  const logoColor = (k: keyof typeof KIND_TEXT) => (kind === k ? `var(--brand-${k})` : "var(--cf-fg-muted)");

  return (
    <Sidebar.Group>
      <Sidebar.GroupLabel>Notifications</Sidebar.GroupLabel>
      <div className="flex flex-col gap-1.5 px-2 pb-3 break-words whitespace-normal">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <span aria-hidden className="flex items-center gap-0.5">
            <SlackLogoIcon size={18} weight="fill" style={{ color: logoColor("slack") }} />
            <DiscordLogoIcon size={18} weight="fill" style={{ color: logoColor("discord") }} />
          </span>
          {kind ? KIND_TEXT[kind] : "Slack or Discord"}
        </span>
        <span className="text-xs text-(--cf-fg-muted)">Posts when a watched site breaks, recovers and is resolved.</span>
        {hook && !hook.available && <span className="text-xs text-(--cf-fg-muted)">{WEBHOOK_ERROR_TEXT.webhooks_unavailable}</span>}
        {hook?.available && !hook.webhook && (
          <form onSubmit={save} className="flex flex-col gap-1.5">
            <SensitiveInput label="Webhook URL" size="sm" value={url} onValueChange={setUrl} placeholder="https://discord.com/api/webhooks/…" />
            <CtaButton type="submit" size="sm" className="w-fit" loading={busy} disabled={!url.trim()}>
              Save webhook
            </CtaButton>
          </form>
        )}
        {hook?.webhook && (
          <>
            <span className="font-mono text-xs">{hook.webhook.hint}</span>
            <div className="flex gap-1.5">
              <Button size="xs" disabled={busy} onClick={() => void run(testWebhook, () => setNote({ text: "Test message sent.", alert: false }))}>
                Send test
              </Button>
              <Button
                size="xs"
                variant="secondary-destructive"
                disabled={busy}
                onClick={() => void run(removeWebhook, () => setHook({ available: true, webhook: null }))}
              >
                Remove
              </Button>
            </div>
          </>
        )}
        {note && (
          <p role={note.alert ? "alert" : "status"} className="text-xs">
            {note.text}
          </p>
        )}
      </div>
    </Sidebar.Group>
  );
}
