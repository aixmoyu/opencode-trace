import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";

vi.mock("../composables/useSSE", () => ({
  useSSE: () => ({ refreshKey: ref(0), lastEvent: ref(null), connected: ref(false) }),
}));

import RecordView from "./RecordView.vue";

function mockResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function setFetchResponses(record: unknown, parsed: unknown, timeline: unknown, sessionResponse: unknown) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/parsed")) return mockResponse(parsed);
    if (url.endsWith("/timeline")) return mockResponse(timeline);
    if (url.includes("/records/")) return mockResponse(record);
    return mockResponse(sessionResponse);
  });
}

const baseRecord = {
  id: 7,
  requestAt: "2024-01-01T00:00:00Z",
  responseAt: "2024-01-01T00:00:02Z",
  request: { url: "https://api.example.com/v1/chat", method: "POST" },
  response: { status: 200, headers: { "content-type": "application/json" }, body: { ok: true } },
  provider: "openai",
};

const baseParsed = {
  provider: "openai",
  model: "gpt-4",
  usage: { inputMissTokens: 100, inputHitTokens: 50, outputTokens: 200 },
  msgs: [{ role: "user", blocks: [{ type: "text", text: "hi" }] }],
};

const baseTimeline = {
  changes: [
    {
      requestId: 7,
      isUserCall: true,
      interRequestDuration: 1500,
      delta: { sys: { added: [], removed: [] } },
    },
  ],
};

const baseSession = { session: { title: "My Session" } };

describe("RecordView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders loading state initially", () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));
    const wrapper = mount(RecordView, {
      props: { sessionId: "sess-1", recordId: "7" },
    });
    expect(wrapper.find(".loading").exists()).toBe(true);
    expect(wrapper.html()).toContain("Loading record");
  });

  it("renders error state when API fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({ error: "boom" }, 500),
    );
    const wrapper = mount(RecordView, {
      props: { sessionId: "sess-1", recordId: "7" },
    });
    await flushPromises();
    expect(wrapper.find(".error-banner").exists()).toBe(true);
    expect(wrapper.html()).toContain("Failed to load record");
  });

  it("renders the record metadata and changes by default", async () => {
    setFetchResponses(baseRecord, baseParsed, baseTimeline, baseSession);
    const wrapper = mount(RecordView, {
      props: { sessionId: "sess-1", recordId: "7" },
    });
    await flushPromises();
    expect(wrapper.html()).toContain("My Session");
    expect(wrapper.html()).toContain("sess-1");
    expect(wrapper.html()).toContain("#7");
    expect(wrapper.html()).toContain("Record Metadata");
  });

  it("switches the view mode when toggle buttons are clicked", async () => {
    setFetchResponses(baseRecord, baseParsed, baseTimeline, baseSession);
    const wrapper = mount(RecordView, {
      props: { sessionId: "sess-1", recordId: "7" },
    });
    await flushPromises();
    const buttons = wrapper.findAll(".view-toggle button");
    const convBtn = buttons.find((b) => b.text() === "Conversation")!;
    const reqBtn = buttons.find((b) => b.text() === "Request")!;
    const respBtn = buttons.find((b) => b.text() === "Response")!;

    await convBtn.trigger("click");
    expect(convBtn.classes()).toContain("active");
    expect(wrapper.html()).toContain("MESSAGES");

    await reqBtn.trigger("click");
    expect(reqBtn.classes()).toContain("active");
    expect(wrapper.html()).toContain("REQUEST HEADERS");

    await respBtn.trigger("click");
    expect(respBtn.classes()).toContain("active");
    expect(wrapper.html()).toContain("RESPONSE BODY");
  });

  it("falls back to sessionId when session has no title", async () => {
    setFetchResponses(baseRecord, baseParsed, baseTimeline, {
      session: {},
    });
    const wrapper = mount(RecordView, {
      props: { sessionId: "only-id", recordId: "7" },
    });
    await flushPromises();
    expect(wrapper.html()).toContain("only-id");
  });
});
