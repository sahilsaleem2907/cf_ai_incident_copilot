import { Fragment, type ReactNode } from "react";
import { parseMarkdown, type Inline } from "../lib/markdown";
import { EvidenceChip } from "./EvidenceChip";

/** Renders the narration subset as React elements; text is never injected as HTML. */
export function Markdown({ text, knownIds }: { text: string; knownIds: ReadonlySet<string> }) {
  return (
    <div className="space-y-2 leading-relaxed">
      {parseMarkdown(text, knownIds).map((b, i) =>
        b.t === "p" ? (
          <p key={i}>{inline(b.c)}</p>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((item, j) => (
              <li key={j}>{inline(item)}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

function inline(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        return <Fragment key={i}>{n.v}</Fragment>;
      case "bold":
        return <strong key={i} className="font-semibold">{inline(n.c)}</strong>;
      case "italic":
        return <em key={i} className="text-(--cf-fg-muted)">{inline(n.c)}</em>;
      case "code":
        return <code key={i} className="rounded-sm bg-(--cf-bg-300) px-1 font-mono text-[0.85em]">{n.v}</code>;
      case "ref":
        return <EvidenceChip key={i} id={n.id} />;
      case "br":
        return <br key={i} />;
    }
  });
}
