import { Switch, Tooltip } from "@cloudflare/kumo";
import { BellIcon, BellSlashIcon } from "@phosphor-icons/react";
import { useNotificationSetting } from "../hooks/useNotifications";

/**
 * Browser notifications on/off, in the header (FR-51, TDD §12.1). Blocked in the browser: greyed out with the
 * reason in a tooltip. Not supported: not shown. The word "Notifications" is visible from `sm` up.
 */
export function NotificationToggle() {
  const { permission, on, setOn } = useNotificationSetting();
  if (permission === "unsupported") return null;
  const blocked = permission === "denied";

  const control = (
    <Switch
      size="sm"
      controlFirst={false}
      checked={on}
      disabled={blocked}
      onCheckedChange={(c) => void setOn(c)}
      label={
        <span className={`flex items-center gap-1.5 text-sm ${blocked ? "text-(--cf-fg-muted)" : ""}`}>
          {blocked ? <BellSlashIcon aria-hidden size={16} /> : <BellIcon aria-hidden size={16} />}
          <span className="max-sm:sr-only">Notifications</span>
          {blocked && <span className="sr-only">(blocked in browser settings)</span>}
        </span>
      }
    />
  );

  return blocked ? (
    <Tooltip content="Blocked in browser settings">
      <span>{control}</span>
    </Tooltip>
  ) : (
    control
  );
}
