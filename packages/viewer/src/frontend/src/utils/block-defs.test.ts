import { describe, it, expect } from "vitest";
import {
  BLOCK_DEFS,
  formatJsonLines,
  formatXmlLines,
  renderContent,
  type Block,
} from "./block-defs";

describe("block-defs", () => {
  describe("BLOCK_DEFS registry", () => {
    it("contains expected block types", () => {
      const expected = [
        "text",
        "thinking",
        "td",
        "tc",
        "tr",
        "image",
        "json",
        "xml",
        "status",
      ];
      for (const t of expected) {
        expect(BLOCK_DEFS[t]).toBeDefined();
        expect(BLOCK_DEFS[t].tag).toBeTruthy();
      }
    });

    it("text block reads b.text", () => {
      const def = BLOCK_DEFS.text;
      expect(def.tag).toBe("TEXT");
      expect(def.toggle).toBe(true);
      const out = def.getRaw?.({ type: "text", text: "hello" } as Block);
      expect(out).toBe("hello");
    });

    it("thinking block reads b.thinking", () => {
      const def = BLOCK_DEFS.thinking;
      expect(def.tag).toBe("THINKING");
      const out = def.getRaw?.({ type: "thinking", thinking: "hmm" } as Block);
      expect(out).toBe("hmm");
    });

    it("td (tool definition) returns JSON for raw and escaped description for renderRaw", () => {
      const def = BLOCK_DEFS.td;
      const block = {
        type: "td",
        name: "read_file",
        description: "Read a file <safe>",
      } as Block;
      const raw = JSON.parse(def.getRaw?.(block) || "null");
      expect(raw.name).toBe("read_file");
      expect(raw.description).toBe("Read a file <safe>");
      const rendered = def.renderRaw?.(block) || "";
      expect(rendered).not.toContain("<safe>");
      expect(rendered).toContain("Read a file &lt;safe&gt;");
    });

    it("td renderMeta includes escaped name", () => {
      const def = BLOCK_DEFS.td;
      const out = def.renderMeta?.({ name: "<b>x</b>" } as Block) || "";
      expect(out).toContain("&lt;b&gt;x&lt;/b&gt;");
    });

    it("tc (tool call) reads b.arguments", () => {
      const def = BLOCK_DEFS.tc;
      const out = def.getRaw?.({ arguments: '{"path":"/x"}' } as Block);
      expect(out).toBe('{"path":"/x"}');
    });

    it("tr (tool result) reads b.content and renders toolCallId in meta", () => {
      const def = BLOCK_DEFS.tr;
      expect(def.getRaw?.({ content: "result text" } as Block)).toBe(
        "result text",
      );
      const meta = def.renderMeta?.({ toolCallId: "abc-123" } as Block) || "";
      expect(meta).toContain("abc-123");
    });

    it("image block returns the placeholder span from renderRaw", () => {
      const def = BLOCK_DEFS.image;
      const out = def.renderRaw?.({} as Block) || "";
      expect(out).toContain("[image]");
      expect(out).toContain("content-muted");
    });

    it("json block stringifies b.data with indentation", () => {
      const def = BLOCK_DEFS.json;
      const out = def.getRaw?.({ data: { a: 1, b: 2 } } as Block) || "";
      expect(out).toContain('"a": 1');
      expect(out).toContain('"b": 2');
    });

    it("xml block reads b.data as string", () => {
      const def = BLOCK_DEFS.xml;
      expect(def.getRaw?.({ data: "<root/>" } as Block)).toBe("<root/>");
    });

    it("status block returns b.text from getRaw and escaped from renderRaw", () => {
      const def = BLOCK_DEFS.status;
      const block = { text: "<ok>" } as Block;
      expect(def.getRaw?.(block)).toBe("<ok>");
      expect(def.renderRaw?.(block)).toBe("&lt;ok&gt;");
    });
  });

  describe("formatJsonLines()", () => {
    it("produces a line-wrapped div per JSON line", () => {
      const html = formatJsonLines({ a: 1, b: [1, 2] });
      const lineCount = (html.match(/<div class="json-line">/g) || []).length;
      expect(lineCount).toBeGreaterThanOrEqual(2);
    });

    it("marks string tokens with json-string class and numbers with json-number", () => {
      // Note: the source regex uses /\\s*:/ (escaped backslash) instead of /\s*:/,
      // so JSON keys are matched as strings, not as keys. We assert the actual
      // current behaviour: strings and numbers get their dedicated CSS classes.
      const html = formatJsonLines({ name: "alice", age: 30 });
      expect(html).toMatch(/class="json-string">"name"<\/span>/);
      expect(html).toMatch(/class="json-string">"alice"<\/span>/);
      expect(html).toMatch(/class="json-number">30<\/span>/);
    });

    it("handles non-object values via JSON.stringify fallback", () => {
      const html = formatJsonLines("plain string");
      expect(html).toContain("plain string");
    });
  });

  describe("formatXmlLines()", () => {
    it("escapes XML special chars and wraps each line", () => {
      const html = formatXmlLines("<a>&<b/>");
      expect(html).toContain("&lt;a&gt;&amp;&lt;b/&gt;");
      expect(html).toMatch(/<div class="xml-line">/);
    });
  });

  describe("renderContent()", () => {
    it("returns empty string for empty input", () => {
      expect(renderContent("")).toBe("");
      expect(renderContent("   ")).toBe("");
    });

    it("renders JSON content with line numbers and highlighter", () => {
      const out = renderContent('{"a":1}');
      expect(out).toContain("json-line");
      // The string token "a" gets json-string class (see regex caveat above)
      expect(out).toContain("json-string");
      expect(out).toContain("json-number");
    });

    it("falls back to plain escaped text for malformed JSON", () => {
      // Use angle brackets so the esc() fallback actually escapes something
      const out = renderContent("{not <valid> json}");
      expect(out).toContain("&lt;valid&gt;");
      expect(out).toContain("not &lt;valid&gt; json");
    });

    it("renders JSON arrays as well as objects", () => {
      const out = renderContent("[1,2,3]");
      expect(out).toContain("json-line");
    });

    it("renders XML-like content with xml-line wrappers", () => {
      const out = renderContent("<root><child/></root>");
      expect(out).toContain("xml-line");
      expect(out).toContain("&lt;root&gt;");
    });

    it("returns escaped plain text for content that is neither JSON nor XML", () => {
      const out = renderContent("hello <world>");
      expect(out).toBe("hello &lt;world&gt;");
    });
  });
});
