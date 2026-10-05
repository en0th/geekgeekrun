// A small Markdown reader for release notes: headings, paragraphs, lists, rules, **bold**,
// `code` and links. It returns plain data that the page turns into elements, so no HTML from
// the notes ever reaches the DOM.

const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/;
// a bare URL ends at whitespace, brackets, quotes or Chinese punctuation
const URL_RE = /https?:\/\/[^\s()（）【】<>"'，。；：、！？“”‘’《》]+/;

/** inline tokens: { type: "text" | "strong" | "code" | "link", text, href? } */
export function parseInline(text) {
  const out = [];
  let rest = String(text ?? "");
  while (rest) {
    const candidates = [
      ["strong", /\*\*([^*]+)\*\*/.exec(rest)],
      ["code", /`([^`]+)`/.exec(rest)],
      ["link", LINK_RE.exec(rest)],
      ["url", URL_RE.exec(rest)],
    ].filter(([, m]) => m);
    if (!candidates.length) {
      out.push({ type: "text", text: rest });
      break;
    }
    const [type, m] = candidates.sort((a, b) => a[1].index - b[1].index)[0];
    if (m.index) out.push({ type: "text", text: rest.slice(0, m.index) });
    if (type === "link") out.push({ type: "link", text: m[1], href: m[2] });
    else if (type === "url") out.push({ type: "link", text: m[0], href: m[0] });
    else out.push({ type, text: m[1] });
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

/** blocks: { type: "h", level, inline } | { type: "p", inline } | { type: "ul", items } | { type: "hr" } */
export function parseMarkdown(source) {
  const blocks = [];
  let paragraph = [];
  let list = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "p", inline: parseInline(paragraph.join(" ")) });
    paragraph = [];
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of String(source ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    let m;
    if (!line) flush();
    else if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      flush();
      blocks.push({ type: "h", level: m[1].length, inline: parseInline(m[2]) });
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flush();
      blocks.push({ type: "hr" });
    } else if ((m = /^[-*+]\s+(.*)$/.exec(line)) || (m = /^\d+[.)]\s+(.*)$/.exec(line))) {
      if (paragraph.length) {
        blocks.push({ type: "p", inline: parseInline(paragraph.join(" ")) });
        paragraph = [];
      }
      list ??= { type: "ul", items: [] };
      list.items.push(parseInline(m[1]));
    } else if (list && /^\s{2,}/.test(raw)) {
      // continuation of the previous list item
      const last = list.items[list.items.length - 1];
      last.push({ type: "text", text: " " }, ...parseInline(line));
    } else {
      if (list) {
        blocks.push(list);
        list = null;
      }
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}
