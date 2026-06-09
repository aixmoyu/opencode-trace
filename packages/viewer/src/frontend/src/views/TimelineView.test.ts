import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import { createRouter, createMemoryHistory } from "vue-router";
import { RouterLinkStub } from "@vue/test-utils";

vi.mock("../composables/useSSE", () => ({
  useSSE: () => ({ refreshKey: ref(0), lastEvent: ref(null), connected: ref(false) }),
}));

import TimelineView from "./TimelineView.vue";

function mockResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/", name: "sessions", component: { template: "<div />" } },
    {
      path: "/session/:sessionId",
      name: "timeline",
      component: { template: "<div />" },
      props: true,
    },
    {
      path: "/session/:sessionId/record/:recordId",
      name: "record",
      component: { template: "<div />" },
      props: true,
    },
  ],
});

const baseSession = {
  session: { title: "My Session" },
  records: [
    {
      id: 1,
      requestAt: "2024-01-01T00:00:00Z",
      responseAt: "2024-01-01T00:00:02Z",
      request: { url: "https://api.example.com/v1/chat", method: "POST" },
      provider: "openai",
    },
    {
      id: 2,
      requestAt: "2024-01-01T00:00:05Z",
      responseAt: "2024-01-01T00:00:08Z",
      request: { url: "https://api.example.com/v1/chat", method: "POST" },
      provider: "openai",
    },
  ],
};

const baseTimeline = {
  changes: [
    { requestId: 1, isUserCall: true, interRequestDuration: 1000 },
    { requestId: 2, isUserCall: false, interRequestDuration: 2000 },
  ],
  recordMeta: [
    { id: 1, model: "gpt-4" },
    { id: 2, model: "gpt-3.5-turbo" },
  ],
};

const baseMetadata = {
  tokenUsage: {
    inputMissTokens: 100,
    inputHitTokens: 50,
    outputTokens: 200,
    totalTokens: 350,
    cacheHitRate: 0.333,
  },
  durationStats: { wallTime: 8000, agentTime: 5000, totalRequestDuration: 5000 },
};

async function mountTimeline() {
  await router.push("/session/sess-1");
  await router.isReady();
  return mount(TimelineView, {
    props: { sessionId: "sess-1" },
    global: {
      plugins: [router],
      stubs: { "router-link": RouterLinkStub },
    },
  });
}

function setFetchResponses() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/timeline")) return mockResponse(baseTimeline);
    if (url.endsWith("/metadata")) return mockResponse(baseMetadata);
    return mockResponse(baseSession);
  });
}

describe("TimelineView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders loading state initially", async () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));
    const wrapper = await mountTimeline();
    expect(wrapper.find(".loading").exists()).toBe(true);
    expect(wrapper.html()).toContain("Loading timeline");
  });

  it("renders error state on fetch failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse({}, 500));
    const wrapper = await mountTimeline();
    await flushPromises();
    expect(wrapper.find(".error-banner").exists()).toBe(true);
    expect(wrapper.html()).toContain("Failed to load session");
  });

  it("renders the title, subtitle, and record count", async () => {
    setFetchResponses();
    const wrapper = await mountTimeline();
    await flushPromises();
    expect(wrapper.html()).toContain("My Session");
    expect(wrapper.html()).toContain("sess-1");
    expect(wrapper.html()).toContain("2 requests");
  });

  it("falls back to sessionId when no session title is set", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/timeline")) return mockResponse(baseTimeline);
      if (url.endsWith("/metadata")) return mockResponse(baseMetadata);
      return mockResponse({ session: {}, records: [] });
    });
    const wrapper = await mountTimeline();
    await flushPromises();
    expect(wrapper.html()).toContain("sess-1");
  });

  it("renders the metadata card with token usage", async () => {
    setFetchResponses();
    const wrapper = await mountTimeline();
    await flushPromises();
    expect(wrapper.html()).toContain("Session Statistics");
    expect(wrapper.html()).toContain("Token Usage");
  });

  it("renders timeline cards with URL hosts and call-type tags", async () => {
    setFetchResponses();
    const wrapper = await mountTimeline();
    await flushPromises();
    const cards = wrapper.findAll(".timeline-card");
    expect(cards).toHaveLength(2);
    expect(wrapper.html()).toContain("api.example.com");
    expect(wrapper.html()).toContain("USER");
    expect(wrapper.html()).toContain("AGENT");
  });

  it("changes sort order when the sort select is changed", async () => {
    setFetchResponses();
    const wrapper = await mountTimeline();
    await flushPromises();
    const select = wrapper.find(".sort-select");
    await select.setValue("time_desc");
    await flushPromises();
    const items = wrapper.findAll(".req-num");
    expect(items[0].text()).toContain("#2");
    expect(items[1].text()).toContain("#1");
  });
});
