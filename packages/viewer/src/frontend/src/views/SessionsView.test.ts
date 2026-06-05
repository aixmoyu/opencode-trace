import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import { createRouter, createMemoryHistory } from "vue-router";
import { RouterLinkStub } from "@vue/test-utils";

vi.mock("../composables/useSSE", () => ({
  useSSE: () => ({ refreshKey: ref(0), lastEvent: ref(null), connected: ref(false) }),
}));

import SessionsView from "./SessionsView.vue";

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
  ],
});

const baseTree = [
  {
    id: "sess-a",
    title: "Alpha",
    folderPath: "/projects/alpha",
    requestCount: 3,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
    children: [
      {
        id: "sess-a-1",
        title: "Alpha child",
        folderPath: "/projects/alpha",
        requestCount: 1,
      },
    ],
  },
  {
    id: "sess-b",
    title: "Beta",
    folderPath: "/projects/beta",
    requestCount: 5,
    createdAt: "2024-01-03T00:00:00Z",
    updatedAt: "2024-01-04T00:00:00Z",
  },
];

async function mountSessions() {
  await router.push("/");
  await router.isReady();
  return mount(SessionsView, {
    global: {
      plugins: [router],
      stubs: { "router-link": RouterLinkStub },
      provide: {
        showConfirm: vi.fn(),
        showToast: vi.fn(),
      },
    },
  });
}

describe("SessionsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders loading state initially", () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));
    return mountSessions().then((wrapper) => {
      expect(wrapper.find(".loading").exists()).toBe(true);
    });
  });

  it("renders error state on fetch failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({}, 500),
    );
    const wrapper = await mountSessions();
    await flushPromises();
    expect(wrapper.find(".error-banner").exists()).toBe(true);
  });

  it("renders the empty state when no sessions exist", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse([]));
    const wrapper = await mountSessions();
    await flushPromises();
    expect(wrapper.find(".empty-state").exists()).toBe(true);
    expect(wrapper.html()).toContain("No sessions found");
  });

  it("renders folder groups with session cards", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse(baseTree));
    const wrapper = await mountSessions();
    await flushPromises();
    expect(wrapper.html()).toContain("Alpha");
    expect(wrapper.html()).toContain("Beta");
    const folderGroups = wrapper.findAll(".folder-group");
    expect(folderGroups.length).toBe(2);
    const sessionCards = wrapper.findAll(".session-card");
    expect(sessionCards.length).toBeGreaterThanOrEqual(2);
  });

  it("filters sessions by search query", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse(baseTree));
    const wrapper = await mountSessions();
    await flushPromises();
    const searchInput = wrapper.find('input[type="search"]');
    await searchInput.setValue("Beta");
    await flushPromises();
    expect(wrapper.html()).toContain("Beta");
    expect(wrapper.html()).not.toContain("Alpha");
  });

  it("toggles batch mode and selects a session", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse(baseTree));
    const wrapper = await mountSessions();
    await flushPromises();
    const toggle = wrapper.find(".batch-toggle-btn");
    await toggle.trigger("click");
    expect(toggle.text()).toBe("Cancel");
    const checkbox = wrapper.find('input[type="checkbox"]');
    expect(checkbox.exists()).toBe(true);
  });

  it("toggles subsessions expansion", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse(baseTree));
    const wrapper = await mountSessions();
    await flushPromises();
    const moreBtn = wrapper.find(".session-more-btn");
    await moreBtn.trigger("click");
    await flushPromises();
    const subsessionBtn = wrapper.findAll(".dropdown-item").find((b) =>
      b.text().includes("subsessions"),
    );
    expect(subsessionBtn).toBeDefined();
    await subsessionBtn!.trigger("click");
    expect(wrapper.html()).toContain("Alpha child");
  });
});
