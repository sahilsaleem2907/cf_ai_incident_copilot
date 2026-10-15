import { Button } from "@cloudflare/kumo";
import { PaperPlaneRightIcon } from "@phosphor-icons/react";
import { useState, type KeyboardEvent, type ReactNode } from "react";

type Props = {
  onSend: (text: string) => Promise<void>;
  value?: string;
  onChange?: (text: string) => void;
  disabled?: boolean;
  /** Shown under the box when disabled (e.g. "Working on it…"). */
  disabledReason?: string;
  placeholder: string;
  /** Inline error or offer shown above the box. */
  notice?: ReactNode;
};

/** Enter sends, Shift+Enter adds a new line (TDD §12.4). Controlled or uncontrolled. */
export function Composer({ onSend, value, onChange, disabled, disabledReason, placeholder, notice }: Props) {
  const [own, setOwn] = useState("");
  const [busy, setBusy] = useState(false);
  const text = value ?? own;
  const setText = onChange ?? setOwn;
  const off = disabled || busy;

  const submit = async () => {
    const t = text.trim();
    if (!t || off) return;
    setBusy(true);
    try {
      await onSend(t);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <form
      className="mx-auto w-full max-w-3xl px-4 pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {notice && <div className="mb-2 text-sm">{notice}</div>}
      <div className="flex items-end gap-2 rounded-lg border border-(--cf-border) bg-(--cf-bg-200) p-2 focus-within:border-cf-orange">
        <label htmlFor="composer" className="sr-only">
          Message
        </label>
        <textarea
          id="composer"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          aria-describedby={disabled && disabledReason ? "composer-reason" : undefined}
          className="max-h-48 min-h-11 flex-1 resize-y bg-transparent px-2 py-1.5 outline-none placeholder:text-(--cf-fg-muted) disabled:cursor-not-allowed"
        />
        <Button type="submit" variant="primary" icon={PaperPlaneRightIcon} disabled={off || !text.trim()} loading={busy}>
          Send
        </Button>
      </div>
      {disabled && disabledReason && (
        <p id="composer-reason" className="mt-1 text-xs text-(--cf-fg-muted)">
          {disabledReason}
        </p>
      )}
    </form>
  );
}
