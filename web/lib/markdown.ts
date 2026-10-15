/**
 * The small Markdown subset narrations use (TDD §9.1): paragraphs, `- ` bullets, **bold**, `code`, _italic_
 * and `[http-1]` evidence references. It produces a tree that `Markdown.tsx` turns into React elements, never
 * HTML strings, so text from the model can't inject markup.
 */
export type Inline =
  | { t: "text"; v: string }
  | { t: "bold"; c: Inline[] }
  | { t: "italic"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "ref"; id: string }
  | { t: "br" };
export type Block = { t: "p"; c: Inline[] } | { t: "ul"; items: Inline[][] };

const BULLET = /^\s*[-*•]\s+/;
const TOKENS = /(\*\*[^*\n]+\*\*)|(`[^`\n]+`)|(\[[a-z]+-\d+\])|((?<![\w])_[^_\n]+_(?![\w]))/g;

export function parseMarkdown(text: string, knownIds: ReadonlySet<string>): Block[] {
  const blocks: Block[] = [];
  for (const chunk of text.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    let para: string[] = [];
    let list: string[] = [];
    const flushPara = () => {
      if (para.length) blocks.push({ t: "p", c: joinLines(para.map((l) => parseInline(l, knownIds))) });
      para = [];
    };
    const flushList = () => {
      if (list.length) blocks.push({ t: "ul", items: list.map((l) => parseInline(l, knownIds)) });
      list = [];
    };
    for (const line of chunk.split("\n")) {
      if (!line.trim()) continue;
      if (BULLET.test(line)) {
        flushPara();
        list.push(line.replace(BULLET, ""));
      } else {
        flushList();
        para.push(line.trim());
      }
    }
    flushPara();
    flushList();
  }
  return blocks;
}

export function parseInline(text: string, knownIds: ReadonlySet<string>): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKENS)) {
    if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
    const [tok] = m;
    if (m[1]) out.push({ t: "bold", c: parseInline(tok.slice(2, -2), knownIds) });
    else if (m[2]) out.push({ t: "code", v: tok.slice(1, -1) });
    else if (m[3]) {
      const id = tok.slice(1, -1);
      out.push(knownIds.has(id) ? { t: "ref", id } : { t: "text", v: tok });
    } else out.push({ t: "italic", c: parseInline(tok.slice(1, -1), knownIds) });
    last = m.index + tok.length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

function joinLines(lines: Inline[][]): Inline[] {
  return lines.flatMap((l, i) => (i === 0 ? l : [{ t: "br" } as Inline, ...l]));
}
