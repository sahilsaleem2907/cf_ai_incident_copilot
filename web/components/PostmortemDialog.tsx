import { Button, Dialog } from "@cloudflare/kumo";
import { CheckIcon, CopyIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { postmortemErrorText } from "../lib/postmortem";
import { DashedLoader } from "./DashedLoader";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The owner writes it the first time; viewers only read a stored one. */
  canWrite: boolean;
  hasPostmortem: boolean;
  /** The live text while the AI writes (the `postmortem` stream). */
  streaming: string | null;
  generate: () => Promise<{ markdown: string }>;
  load: () => Promise<{ markdown: string } | null>;
};

/** The postmortem as copyable markdown (FR-70, FR-71, TDD §12.2): written on first open, stored after that. */
export function PostmortemDialog({ open, onOpenChange, canWrite, hasPostmortem, streaming, generate, load }: Props) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!open || markdown !== null || started.current) return;
    started.current = true;
    setError(null);
    const get = hasPostmortem || !canWrite ? load() : generate();
    get
      .then((r) => (r ? setMarkdown(r.markdown) : setError("No postmortem has been written yet.")))
      .catch((e: Error) => setError(postmortemErrorText(e.message)))
      .finally(() => {
        started.current = false;
      });
  }, [open, markdown, hasPostmortem, canWrite, generate, load]);

  const copy = async () => {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy. Select the text and copy it by hand.");
    }
  };

  const text = markdown ?? streaming;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog size="xl" className="flex max-h-[90dvh] flex-col gap-3 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Dialog.Title className="font-display text-lg font-medium">Postmortem</Dialog.Title>
            <Dialog.Description className="text-sm text-(--cf-fg-muted)">
              Markdown to paste into your docs. The timeline comes from the incident's records.
            </Dialog.Description>
          </div>
          <Dialog.Close render={(p) => <Button {...p} variant="secondary" shape="square" icon={<XIcon />} aria-label="Close" />} />
        </div>
        {!markdown && !error && (
          <p className="flex items-center gap-2 text-sm text-(--cf-fg-muted)" aria-live="polite">
            <DashedLoader size={14} label={null} /> {hasPostmortem || !canWrite ? "Loading the postmortem…" : "Writing the postmortem…"}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm">
            {error}
          </p>
        )}
        {text && (
          <pre className="min-h-0 flex-1 overflow-auto rounded-md border border-(--cf-border) bg-(--cf-bg-200) p-3 font-mono text-xs break-words whitespace-pre-wrap" aria-live={markdown ? undefined : "polite"}>
            {text}
          </pre>
        )}
        {markdown && (
          <div className="flex justify-end">
            <Button variant="secondary" icon={copied ? <CheckIcon /> : <CopyIcon />} onClick={() => void copy()}>
              {copied ? "Copied" : "Copy markdown"}
            </Button>
          </div>
        )}
      </Dialog>
    </Dialog.Root>
  );
}
