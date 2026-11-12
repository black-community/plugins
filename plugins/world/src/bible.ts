/*
 * The world bible, an export format in Compile: every entry in the world, kind by kind, with its other names, fields,
 * links and text, as Markdown or HTML. For the writer's own reference, or for a co-author.
 */

export interface BibleEntry {
  title: string;
  names: string;
  synopsis: string;
  fields: [string, string][];
  links: { label: string; other: string }[];
  /** The entry's own text, as plain text. */
  text: string;
}

export interface BibleInput {
  title: string;
  kinds: { plural: string; entries: BibleEntry[] }[];
  words: { otherNames: string; links: string; empty: string };
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Escapes what would otherwise be read as Markdown at the start of a line or around words. */
const escapeMd = (s: string) => s.replace(/([\\`*_[\]#<>|])/g, "\\$1");

/** The world bible as Markdown. */
export function bibleMarkdown(input: BibleInput): string {
  const out = [`# ${escapeMd(input.title)}`, ""];
  const kinds = input.kinds.filter((k) => k.entries.length);
  if (!kinds.length) return [...out, input.words.empty, ""].join("\n");
  for (const kind of kinds) {
    out.push(`## ${escapeMd(kind.plural)}`, "");
    for (const e of kind.entries) {
      out.push(`### ${escapeMd(e.title)}`, "");
      if (e.names) out.push(`*${escapeMd(input.words.otherNames)}:* ${escapeMd(e.names)}`, "");
      if (e.synopsis) out.push(escapeMd(e.synopsis), "");
      for (const [field, value] of e.fields) out.push(`- **${escapeMd(field)}:** ${escapeMd(value).replace(/\n/g, " ")}`);
      if (e.fields.length) out.push("");
      if (e.links.length) {
        out.push(`**${escapeMd(input.words.links)}**`, "");
        for (const l of e.links) out.push(`- ${escapeMd(l.label)}: ${escapeMd(l.other)}`);
        out.push("");
      }
      if (e.text.trim()) out.push(...e.text.trim().split(/\n+/).flatMap((p) => [escapeMd(p), ""]));
    }
  }
  return out.join("\n");
}

/** The world bible as a whole HTML page. */
export function bibleHtml(input: BibleInput, language: string): string {
  const h = escapeHtml;
  const body: string[] = [`<h1>${h(input.title)}</h1>`];
  const kinds = input.kinds.filter((k) => k.entries.length);
  if (!kinds.length) body.push(`<p>${h(input.words.empty)}</p>`);
  for (const kind of kinds) {
    body.push(`<h2>${h(kind.plural)}</h2>`);
    for (const e of kind.entries) {
      body.push(`<section>`, `<h3>${h(e.title)}</h3>`);
      if (e.names) body.push(`<p><em>${h(input.words.otherNames)}:</em> ${h(e.names)}</p>`);
      if (e.synopsis) body.push(`<p>${h(e.synopsis)}</p>`);
      if (e.fields.length) body.push(`<dl>${e.fields.map(([f, v]) => `<dt>${h(f)}</dt><dd>${h(v)}</dd>`).join("")}</dl>`);
      if (e.links.length) body.push(`<h4>${h(input.words.links)}</h4>`, `<ul>${e.links.map((l) => `<li>${h(l.label)}: ${h(l.other)}</li>`).join("")}</ul>`);
      for (const p of e.text.trim().split(/\n+/).filter(Boolean)) body.push(`<p>${h(p)}</p>`);
      body.push(`</section>`);
    }
  }
  return `<!doctype html>\n<html lang="${h(language || "en")}">\n<head>\n<meta charset="utf-8">\n<title>${h(input.title)}</title>\n<style>body{font-family:Georgia,serif;max-width:40em;margin:2em auto;line-height:1.5;padding:0 1em}dt{font-weight:bold}dd{margin:0 0 .5em}</style>\n</head>\n<body>\n${body.join("\n")}\n</body>\n</html>\n`;
}
