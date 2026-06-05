import { describe, it, expect } from "vitest";
import { parseSSE, isSSEData } from "./sse.js";

describe("parseSSE", () => {
  it("returns empty array for empty input", () => {
    expect(parseSSE("")).toEqual([]);
  });

  it("returns empty array when no blank line and no data field is set", () => {
    expect(parseSSE("event: ping\nid: 1\n\n")).toEqual([]);
  });

  it("parses a single data event", () => {
    const raw = "data: hello\n\n";
    expect(parseSSE(raw)).toEqual([{ data: "hello" }]);
  });

  it("parses multiple events separated by blank lines", () => {
    const raw =
      "data: first\n\n" +
      "data: second\n\n" +
      "data: third\n\n";
    expect(parseSSE(raw)).toEqual([
      { data: "first" },
      { data: "second" },
      { data: "third" },
    ]);
  });

  it("joins multi-line data fields with newlines inside one event", () => {
    const raw = "data: line1\ndata: line2\ndata: line3\n\n";
    expect(parseSSE(raw)).toEqual([{ data: "line1\nline2\nline3" }]);
  });

  it("strips leading whitespace from value (trimStart)", () => {
    const raw = "data:    spaced\n\n";
    expect(parseSSE(raw)).toEqual([{ data: "spaced" }]);
  });

  it("ignores comment lines that start with a colon", () => {
    const raw = ": this is a heartbeat comment\n" + "data: real\n\n";
    expect(parseSSE(raw)).toEqual([{ data: "real" }]);
  });

  it("parses the [DONE] sentinel as ordinary data payload", () => {
    const raw = "data: [DONE]\n\n";
    expect(parseSSE(raw)).toEqual([{ data: "[DONE]" }]);
  });

  it("captures mixed id, event, and data fields in a single event", () => {
    const raw = "id: 42\nevent: ping\ndata: hello\n\n";
    expect(parseSSE(raw)).toEqual([
      { id: "42", event: "ping", data: "hello" },
    ]);
  });

  it("ignores lines that have no colon and are not 'data'", () => {
    const raw = "nocolon\nfoobar\ndata: real\n\n";
    expect(parseSSE(raw)).toEqual([{ data: "real" }]);
  });

  it("treats a bare 'data' token (no colon) as empty data", () => {
    const raw = "data\n\n";
    expect(parseSSE(raw)).toEqual([{ data: "" }]);
  });

  it("treats a bare 'data:' token (empty value) as empty data", () => {
    const raw = "data:\n\n";
    expect(parseSSE(raw)).toEqual([{ data: "" }]);
  });

  it("flushes the last event when stream ends without a trailing blank line", () => {
    const raw = "data: no-trailing-blank";
    expect(parseSSE(raw)).toEqual([{ data: "no-trailing-blank" }]);
  });

  it("preserves id and event across multiple data lines in the same event", () => {
    const raw =
      "id: evt-1\nevent: message\n" + "data: part1\ndata: part2\n\n";
    expect(parseSSE(raw)).toEqual([
      { id: "evt-1", event: "message", data: "part1\npart2" },
    ]);
  });

  it("emits separate events when blank lines separate id+data pairs", () => {
    const raw =
      "id: 1\nevent: a\ndata: first\n\n" + "id: 2\nevent: b\ndata: second\n\n";
    expect(parseSSE(raw)).toEqual([
      { id: "1", event: "a", data: "first" },
      { id: "2", event: "b", data: "second" },
    ]);
  });

  it("preserves data on a line whose colon is the last character with empty value", () => {
    const raw = "id: 1\nevent: ping\ndata:\n\n";
    expect(parseSSE(raw)).toEqual([
      { id: "1", event: "ping", data: "" },
    ]);
  });

  it("parses a realistic OpenAI [DONE] stream with multiple content chunks", () => {
    const raw =
      "data: {\"id\":\"chatcmpl-1\",\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n" +
      "data: {\"id\":\"chatcmpl-1\",\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n" +
      "data: [DONE]\n\n";
    const events = parseSSE(raw);
    expect(events).toHaveLength(3);
    expect(events[0].data).toBe(
      "{\"id\":\"chatcmpl-1\",\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}",
    );
    expect(events[1].data).toBe(
      "{\"id\":\"chatcmpl-1\",\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}",
    );
    expect(events[2].data).toBe("[DONE]");
  });
});

describe("isSSEData", () => {
  it("returns true for 'data:' prefix with payload", () => {
    expect(isSSEData("data: hello")).toBe(true);
  });

  it("returns true for 'data:' with empty payload", () => {
    expect(isSSEData("data:")).toBe(true);
  });

  it("returns true for 'data:' with only whitespace after", () => {
    expect(isSSEData("data:   ")).toBe(true);
  });

  it("returns false for 'event:' prefix", () => {
    expect(isSSEData("event: ping")).toBe(false);
  });

  it("returns false for 'id:' prefix", () => {
    expect(isSSEData("id: 1")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isSSEData("")).toBe(false);
  });

  it("returns false for comment line", () => {
    expect(isSSEData(": heartbeat")).toBe(false);
  });

  it("returns false for bare 'data' token without colon", () => {
    expect(isSSEData("data")).toBe(false);
  });
});
