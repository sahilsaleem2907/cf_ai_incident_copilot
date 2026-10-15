import { Button, SensitiveInput, Sidebar } from "@cloudflare/kumo";
import { BellIcon, BellSlashIcon, CheckCircleIcon } from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent } from "react";
import { useNotificationPermission } from "../hooks/useNotifications";
import { getWebhook, removeWebhook, saveWebhook, testWebhook, WEBHOOK_ERROR_TEXT, type WebhookState } from "../lib/api";

const KIND_TEXT = { slack: "Slack", discord: "Discord" } as const;

/**
 * Notifications (FR-51 to FR-53, TDD §12.1; the TDD's WebhookSettings): browser notifications, switched on from
 * a click, and one Slack or Discord webhook per workspace. Webhooks fire for watched incidents only (D18).
 */
export function NotificationSettings() {
  const [permission, requestPermission] = useNotificationPermission();
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

  return (
    <Sidebar.Group>
      <Sidebar.GroupLabel>Notifications</Sidebar.GroupLabel>
      <div className="flex flex-col gap-3 px-2 pb-3 break-words whitespace-normal">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Browser</span>
          {permission === "granted" && (
            <span className="flex items-center gap-1 text-xs">
              <CheckCircleIcon aria-hidden size={14} /> On for this browser
            </span>
          )}
          {permission === "default" && (
            <Button size="sm" icon={BellIcon} className="w-fit" onClick={() => void requestPermission()}>
              Turn on notifications
            </Button>
          )}
          {permission === "denied" && (
            <span className="flex items-center gap-1 text-xs text-(--cf-fg-muted)">
              <BellSlashIcon aria-hidden size={14} /> Blocked in your browser settings
            </span>
          )}
          {permission === "unsupported" && <span className="text-xs text-(--cf-fg-muted)">Not supported in this browser</span>}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Slack or Discord</span>
          <span className="text-xs text-(--cf-fg-muted)">Posts when a watched site breaks, recovers and is resolved.</span>
          {hook && !hook.available && <span className="text-xs text-(--cf-fg-muted)">{WEBHOOK_ERROR_TEXT.webhooks_unavailable}</span>}
          {hook?.available && !hook.webhook && (
            <form onSubmit={save} className="flex flex-col gap-1.5">
              <SensitiveInput label="Webhook URL" size="sm" value={url} onValueChange={setUrl} placeholder="https://discord.com/api/webhooks/…" />
              <Button type="submit" size="sm" className="w-fit" loading={busy} disabled={!url.trim()}>
                Save webhook
              </Button>
            </form>
          )}
          {hook?.webhook && (
            <>
              <span className="text-xs">
                {KIND_TEXT[hook.webhook.kind]} · <span className="font-mono">{hook.webhook.hint}</span>
              </span>
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
      </div>
    </Sidebar.Group>
  );
}
