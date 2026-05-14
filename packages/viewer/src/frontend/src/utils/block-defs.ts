import { esc, formatNumber } from "./format";

export interface Block {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  description?: string;
  parameters?: unknown;
  arguments?: string;
  toolCallId?: string;
  content?: string;
  data?: unknown;
}

export interface BlockDef {
  tag: string;
  toggle: boolean;
  renderMeta: ((b: Block) => string) | null;
  getRaw: ((b: Block) => string) | null;
  renderRaw: ((b: Block) => string) | null;
  renderRendered: ((raw: string) => string) | null;
}

export const BLOCK_DEFS: Record<string, BlockDef> = {
  text: {
    tag: "TEXT",
    toggle: true,
    renderMeta: null,
    getRaw: (b) => b.text || "",
    renderRaw: null,
    renderRendered: null,
  },
  thinking: {
    tag: "THINKING",
    toggle: true,
    renderMeta: null,
    getRaw: (b) => b.thinking || "",
    renderRaw: null,
    renderRendered: null,
  },
  td: {
    tag: "TD",
    toggle: true,
    renderMeta: (b) => `<span class="tool-meta-name">${esc(b.name || "")}</span>`,
    getRaw: (b) => {
      const obj: Record<string, unknown> = { name: b.name, description: b.description };
      if (b.parameters) obj.parameters = b.parameters;
      return JSON.stringify(obj, null, 2);
    },
    renderRaw: (b) => esc(b.description || ""),
    renderRendered: null,
  },
  tc: {
    tag: "TC",
    toggle: true,
    renderMeta: (b) => `<span class="tool-meta-name">${esc(b.name || "")}</span>`,
    getRaw: (b) => b.arguments || "",
    renderRaw: null,
    renderRendered: null,
  },
  tr: {
    tag: "TR",
    toggle: true,
    renderMeta: (b) => `<span class="tool-meta-id">Tool result: ${esc(b.toolCallId || "")}</span>`,
    getRaw: (b) => b.content || "",
    renderRaw: null,
    renderRendered: null,
  },
  image: {
    tag: "IMAGE",
    toggle: false,
    renderMeta: null,
    getRaw: null,
    renderRaw: () => '<span class="content-muted">[image]</span>',
    renderRendered: null,
  },
  json: {
    tag: "JSON",
    toggle: false,
    renderMeta: null,
    getRaw: (b) => JSON.stringify(b.data, null, 2),
    renderRaw: null,
    renderRendered: null,
  },
  xml: {
    tag: "XML",
    toggle: false,
    renderMeta: null,
    getRaw: (b) => (b.data as string) || "",
    renderRaw: null,
    renderRendered: null,
  },
  status: {
    tag: "STATUS",
    toggle: false,
    renderMeta: null,
    getRaw: (b) => b.text || "",
    renderRaw: (b) => esc(b.text || ""),
    renderRendered: null,
  },
};

export function formatJsonLines(obj: unknown): string {
  const json = JSON.stringify(obj, null, 2) || String(obj);
  const escaped = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const highlighted = escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+]?\d+)?)/g,
    (match) => {
      let cls = "json-number";
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = "json-key";
          const key = match.slice(0, -1);
          return `<span class="${cls}">${key}</span>:`;
        }
        cls = "json-string";
      } else if (/true/.test(match)) {
        cls = "json-bool json-true";
      } else if (/false/.test(match)) {
        cls = "json-bool json-false";
      } else if (/null/.test(match)) {
        cls = "json-null";
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );

  const lines = highlighted.split("\n");
  return lines
    .map((line, i) => `<div class="json-line"><span class="json-num">${i + 1}</span>${line}</div>`)
    .join("");
}

export function formatXmlLines(xml: string): string {
  const escaped = xml
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const lines = escaped.split("\n");
  return lines
    .map((line, i) => `<div class="xml-line"><span class="xml-num">${i + 1}</span>${line}</div>`)
    .join("");
}

export function renderContent(content: string): string {
  if (!content) return "";
  content = content.trim();

  if (
    (content.startsWith("{") && content.endsWith("}")) ||
    (content.startsWith("[") && content.endsWith("]"))
  ) {
    try {
      return formatJsonLines(JSON.parse(content));
    } catch {}
  }

  if (content.startsWith("<") && content.includes(">")) {
    return formatXmlLines(content);
  }

  return esc(content);
}
