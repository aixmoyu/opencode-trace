import { describe, it, expect } from "vitest";
import "../parse/openai-chat.js";
import { diffConversations, buildSessionTimeline, buildSessionMetadata } from "./session.js";
import type { Conversation, Entry, Block, TextBlock, ToolDefinitionBlock } from "../parse/types.js";
import type { TraceRecord } from "../types.js";
import { generateId, createSysEntry, createToolEntry, createMsgEntry, createTextBlock, createToolDefinitionBlock } from "../parse/utils.js";

function createTextMsg(role: "user" | "assistant" | "tool", text: string): Entry {
  return createMsgEntry(role, [createTextBlock(text)]);
}

describe("diffConversations", () => {
  it("detects added messages", () => {
    const prev: Conversation = { provider: "test", model: null, msgs: [], usage: null, stream: false };
    const userMsg = createTextMsg("user", "hello");
    const curr: Conversation = { provider: "test", model: null, msgs: [userMsg], usage: null, stream: false };

    const result = diffConversations(prev, curr, 1);

    expect(result.requestId).toBe(1);
    expect(result.delta.msgs.length).toBe(1);
    expect(result.delta.msgs[0].id).toBe(userMsg.id);
    expect(result.delta.msgs[0].added?.length).toBe(1);
    expect((result.delta.msgs[0].added![0] as TextBlock).text).toBe("hello");
  });

  it("detects removed messages", () => {
    const userMsg = createTextMsg("user", "hello");
    const prev: Conversation = { provider: "test", model: null, msgs: [userMsg], usage: null, stream: false };
    const curr: Conversation = { provider: "test", model: null, msgs: [], usage: null, stream: false };

    const result = diffConversations(prev, curr, 1);

    expect(result.delta.msgs.length).toBe(1);
    expect(result.delta.msgs[0].id).toBe(userMsg.id);
    expect(result.delta.msgs[0].removed?.length).toBe(1);
  });

  it("detects system prompt changes", () => {
    const prevSys = createSysEntry([createTextBlock("old system")]);
    const prev: Conversation = { provider: "test", model: null, sys: prevSys, msgs: [], usage: null, stream: false };
    const currSys = createSysEntry([createTextBlock("new system")]);
    const curr: Conversation = { provider: "test", model: null, sys: currSys, msgs: [], usage: null, stream: false };

    const result = diffConversations(prev, curr, 1);

    expect(result.delta.sys).toBeDefined();
    expect(result.delta.sys?.added?.length).toBe(1);
    expect(result.delta.sys?.removed?.length).toBe(1);
  });

  it("detects tool changes", () => {
    const prevTool = createToolEntry([createToolDefinitionBlock("tool1", "desc1", null)]);
    const prev: Conversation = { provider: "test", model: null, tool: prevTool, msgs: [], usage: null, stream: false };
    const currTool = createToolEntry([createToolDefinitionBlock("tool2", "desc2", null)]);
    const curr: Conversation = { provider: "test", model: null, tool: currTool, msgs: [], usage: null, stream: false };

    const result = diffConversations(prev, curr, 1);

    expect(result.delta.tool).toBeDefined();
    expect(result.delta.tool?.added?.length).toBe(1);
    expect(result.delta.tool?.removed?.length).toBe(1);
  });

  it("returns empty delta for identical conversations", () => {
    const userMsg = createTextMsg("user", "hello");
    const conv: Conversation = { provider: "test", model: null, msgs: [userMsg], usage: null, stream: false };

    const result = diffConversations(conv, conv, 1);

    expect(result.delta.msgs.length).toBe(0);
    expect(result.delta.sys).toBeUndefined();
    expect(result.delta.tool).toBeUndefined();
  });
});

describe("buildSessionTimeline", () => {
  it("builds timeline from records with initial change for first request", () => {
    const userMsg = createTextMsg("user", "hello");
    const records = [
      { id: 1, parsed: { provider: "test", model: null, msgs: [userMsg], usage: null, stream: false } as Conversation },
      { id: 2, parsed: { provider: "test", model: null, msgs: [userMsg, createTextMsg("assistant", "hi")], usage: null, stream: false } as Conversation },
    ];

    const result = buildSessionTimeline("test-session", records);

    expect(result.sessionId).toBe("test-session");
    expect(result.totalRequests).toBe(2);
    expect(result.changes.length).toBe(2);
    expect(result.changes[0].requestId).toBe(1);
    expect(result.changes[0].delta.msgs.length).toBe(1);
    expect(result.changes[0].delta.msgs[0].added?.length).toBe(1);
  });

  it("calculates interRequestDuration between requests", () => {
    const userMsg1 = createTextMsg("user", "hello");
    const assistantMsg = createTextMsg("assistant", "hi there");
    const userMsg2 = createTextMsg("user", "thanks");
    const records = [
      { 
        id: 1, 
        requestAt: "2026-04-29T00:00:00.000Z",
        requestMsgs: [userMsg1],
        parsed: { provider: "test", model: null, msgs: [userMsg1, assistantMsg], usage: null, stream: false } as Conversation 
      },
      { 
        id: 2, 
        requestAt: "2026-04-29T00:00:05.000Z",
        requestMsgs: [userMsg1, assistantMsg, userMsg2],
        parsed: { provider: "test", model: null, msgs: [userMsg1, assistantMsg, userMsg2], usage: null, stream: false } as Conversation 
      },
    ];

    const result = buildSessionTimeline("test-session", records);

    expect(result.changes[0].interRequestDuration).toBeNull();
    expect(result.changes[1].interRequestDuration).toBe(5000);
  });

  it("identifies isUserCall based on last request message having text block", () => {
    const userMsg = createTextMsg("user", "hello");
    const assistantMsg = createTextMsg("assistant", "hi");
    const toolCallMsg = createMsgEntry("assistant", [{ type: "tc", id: "tc1", name: "test_tool", arguments: "{}" }]);
    const records = [
      { 
        id: 1, 
        requestMsgs: [userMsg],
        parsed: { provider: "test", model: null, msgs: [userMsg, assistantMsg], usage: null, stream: false } as Conversation 
      },
      { 
        id: 2, 
        requestMsgs: [userMsg, assistantMsg, toolCallMsg],
        parsed: { provider: "test", model: null, msgs: [userMsg, assistantMsg, toolCallMsg, createTextMsg("tool", "result")], usage: null, stream: false } as Conversation 
      },
    ];

    const result = buildSessionTimeline("test-session", records);

    expect(result.changes[0].isUserCall).toBe(true);
    expect(result.changes[1].isUserCall).toBe(false);
  });
});

describe("buildSessionMetadata", () => {
  it("calculates total token usage from records", () => {
    const userMsg = createTextMsg("user", "hello");
    const records = [
      { 
        id: 1, 
        parsed: { 
          provider: "test", 
          model: null, 
          msgs: [userMsg], 
          usage: { inputMissTokens: 100, inputHitTokens: 50, outputTokens: 200 }, 
          stream: false 
        } as Conversation 
      },
      { 
        id: 2, 
        parsed: { 
          provider: "test", 
          model: null, 
          msgs: [userMsg, createTextMsg("assistant", "hi")], 
          usage: { inputMissTokens: 150, inputHitTokens: 80, outputTokens: 300 }, 
          stream: false 
        } as Conversation 
      },
    ];

    const result = buildSessionMetadata("test-session", records);

    expect(result.sessionId).toBe("test-session");
    expect(result.requestCount).toBe(2);
    expect(result.tokenUsage.inputMissTokens).toBe(250);
    expect(result.tokenUsage.inputHitTokens).toBe(130);
    expect(result.tokenUsage.outputTokens).toBe(500);
    expect(result.tokenUsage.totalTokens).toBe(880);
  });

  it("calculates cache hit rate correctly", () => {
    const userMsg = createTextMsg("user", "hello");
    const records = [
      { 
        id: 1, 
        parsed: { 
          provider: "test", 
          model: null, 
          msgs: [userMsg], 
          usage: { inputMissTokens: 100, inputHitTokens: 100, outputTokens: 200 }, 
          stream: false 
        } as Conversation 
      },
    ];

    const result = buildSessionMetadata("test-session", records);

    expect(result.tokenUsage.cacheHitRate).toBe(0.5);
  });

  it("handles null usage gracefully", () => {
    const userMsg = createTextMsg("user", "hello");
    const records = [
      { id: 1, parsed: { provider: "test", model: null, msgs: [userMsg], usage: null, stream: false } as Conversation },
      { id: 2, parsed: { provider: "test", model: null, msgs: [userMsg], usage: { inputMissTokens: 100, inputHitTokens: 50, outputTokens: 200 }, stream: false } as Conversation },
    ];

    const result = buildSessionMetadata("test-session", records);

    expect(result.tokenUsage.inputMissTokens).toBe(100);
    expect(result.tokenUsage.inputHitTokens).toBe(50);
    expect(result.tokenUsage.outputTokens).toBe(200);
    expect(result.tokenUsage.totalTokens).toBe(350);
  });

  it("handles partial usage data", () => {
    const userMsg = createTextMsg("user", "hello");
    const records = [
      { 
        id: 1, 
        parsed: { 
          provider: "test", 
          model: null, 
          msgs: [userMsg], 
          usage: { inputMissTokens: null, inputHitTokens: 50, outputTokens: null }, 
          stream: false 
        } as Conversation 
      },
    ];

    const result = buildSessionMetadata("test-session", records);

    expect(result.tokenUsage.inputMissTokens).toBe(0);
    expect(result.tokenUsage.inputHitTokens).toBe(50);
    expect(result.tokenUsage.outputTokens).toBe(0);
    expect(result.tokenUsage.totalTokens).toBe(50);
  });

  it("calculates latency stats from records with latency data", () => {
    const userMsg = createTextMsg("user", "hello");
    const record1: TraceRecord = {
      id: 1,
      purpose: "",
      requestAt: "2026-04-29T00:00:00.000Z",
      responseAt: "2026-04-29T00:00:01.000Z",
      request: {
        method: "POST",
        url: "https://api.openai.com/v1/chat/completions",
        headers: {},
        body: { model: "gpt-4", messages: [{ role: "user", content: "hi" }] },
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: {},
        body: {
          choices: [{ message: { role: "assistant", content: "hello" } }],
          usage: { prompt_tokens: 10, completion_tokens: 100 },
        },
      },
      error: null,
      requestSentAt: 1000,
      firstTokenAt: 1100,
      lastTokenAt: 1500,
    };
    const record2: TraceRecord = {
      id: 2,
      purpose: "",
      requestAt: "2026-04-29T00:00:02.000Z",
      responseAt: "2026-04-29T00:00:03.000Z",
      request: {
        method: "POST",
        url: "https://api.openai.com/v1/chat/completions",
        headers: {},
        body: { model: "gpt-4", messages: [{ role: "user", content: "hi" }] },
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: {},
        body: {
          choices: [{ message: { role: "assistant", content: "hello" } }],
          usage: { prompt_tokens: 10, completion_tokens: 50 },
        },
      },
      error: null,
      requestSentAt: 2000,
      firstTokenAt: 2200,
      lastTokenAt: 2500,
    };
    const records = [
      { id: 1, record: record1, parsed: { provider: "test", model: null, msgs: [userMsg], usage: { inputMissTokens: 10, inputHitTokens: 0, outputTokens: 100 }, stream: false } as Conversation },
      { id: 2, record: record2, parsed: { provider: "test", model: null, msgs: [userMsg], usage: { inputMissTokens: 10, inputHitTokens: 0, outputTokens: 50 }, stream: false } as Conversation },
    ];

    const result = buildSessionMetadata("test-session", records);

    expect(result.latencyStats).toBeDefined();
    expect(result.latencyStats?.avgTTFT).toBeCloseTo(150, 1); // (100 + 200) / 2 = 150
    expect(result.latencyStats?.maxTTFT).toBe(200);
    expect(result.latencyStats?.avgTPOT).toBeCloseTo(5, 1); // (4 + 6) / 2 = 5
    expect(result.latencyStats?.maxTPOT).toBe(6);
    expect(result.latencyStats?.streamRequestCount).toBe(2);
  });

  it("returns null latencyStats when no records have latency data", () => {
    const userMsg = createTextMsg("user", "hello");
    const records = [
      { id: 1, record: { id: 1, purpose: "", requestAt: "", responseAt: "", request: { method: "POST", url: "", headers: {}, body: null }, response: null, error: null } as TraceRecord, parsed: { provider: "test", model: null, msgs: [userMsg], usage: null, stream: false } as Conversation },
    ];

    const result = buildSessionMetadata("test-session", records);

    expect(result.latencyStats).toBeNull();
  });

  it("includes folderPath when provided", () => {
    const userMsg = createTextMsg("user", "hello");
    const records = [
      { id: 1, parsed: { provider: "test", model: null, msgs: [userMsg], usage: null, stream: false } as Conversation },
    ];

    const result = buildSessionMetadata("test-session", records, "/path/to/folder");

    expect(result.folderPath).toBe("/path/to/folder");
  });

  it("returns undefined folderPath when not provided", () => {
    const userMsg = createTextMsg("user", "hello");
    const records = [
      { id: 1, parsed: { provider: "test", model: null, msgs: [userMsg], usage: null, stream: false } as Conversation },
    ];

    const result = buildSessionMetadata("test-session", records);

    expect(result.folderPath).toBeUndefined();
  });

  it("calculates duration stats from records", () => {
    const userMsg = createTextMsg("user", "hello");
    const record1: TraceRecord = {
      id: 1,
      purpose: "",
      requestAt: "2026-04-29T00:00:00.000Z",
      responseAt: "2026-04-29T00:00:02.000Z",
      request: {
        method: "POST",
        url: "https://api.openai.com/v1/chat/completions",
        headers: {},
        body: { model: "gpt-4", messages: [{ role: "user", content: "hi" }] },
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: {},
        body: {
          choices: [{ message: { role: "assistant", content: "hello" } }],
          usage: { prompt_tokens: 10, completion_tokens: 100 },
        },
      },
      error: null,
    };
    const record2: TraceRecord = {
      id: 2,
      purpose: "",
      requestAt: "2026-04-29T00:00:05.000Z",
      responseAt: "2026-04-29T00:00:08.000Z",
      request: {
        method: "POST",
        url: "https://api.openai.com/v1/chat/completions",
        headers: {},
        body: { model: "gpt-4", messages: [{ role: "user", content: "hi" }] },
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: {},
        body: {
          choices: [{ message: { role: "assistant", content: "hello" } }],
          usage: { prompt_tokens: 10, completion_tokens: 50 },
        },
      },
      error: null,
    };
    const records = [
      { id: 1, record: record1, parsed: { provider: "test", model: null, msgs: [userMsg], usage: null, stream: false } as Conversation },
      { id: 2, record: record2, parsed: { provider: "test", model: null, msgs: [userMsg], usage: null, stream: false } as Conversation },
    ];

    const result = buildSessionMetadata("test-session", records);

    expect(result.durationStats).toBeDefined();
    expect(result.durationStats?.wallTime).toBe(8000);
    expect(result.durationStats?.totalRequestDuration).toBe(5000);
  });

  it("returns null durationStats when records have no time data", () => {
    const userMsg = createTextMsg("user", "hello");
    const records = [
      { id: 1, parsed: { provider: "test", model: null, msgs: [userMsg], usage: null, stream: false } as Conversation },
    ];

    const result = buildSessionMetadata("test-session", records);

    expect(result.durationStats).toBeNull();
  });
});