import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import AppHeader from "./AppHeader.vue";

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

async function mountAt(path: string, traceEnabled = false) {
  await router.push(path);
  await router.isReady();
  return mount(AppHeader, {
    props: { traceEnabled },
    global: { plugins: [router] },
  });
}

describe("AppHeader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the app title with logo", async () => {
    const wrapper = await mountAt("/");
    expect(wrapper.find("h1").text()).toContain("opencode-trace");
    expect(wrapper.find("h1 svg").exists()).toBe(true);
  });

  it("renders the dropdown toggle button", async () => {
    const wrapper = await mountAt("/");
    const toggle = wrapper.find(".dropdown-toggle");
    expect(toggle.exists()).toBe(true);
    expect(toggle.attributes("aria-expanded")).toBe("false");
  });

  it("opens and closes the dropdown on toggle click", async () => {
    const wrapper = await mountAt("/");
    const toggle = wrapper.find(".dropdown-toggle");
    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(wrapper.find(".dropdown-menu").isVisible()).toBe(true);
    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("false");
  });

  it("shows the import option only on the sessions route", async () => {
    const sessions = await mountAt("/");
    await sessions.find(".dropdown-toggle").trigger("click");
    const sessionsItems = sessions.findAll(".dropdown-item");
    const labels = sessionsItems.map((i) => i.text());
    expect(labels.some((l) => l.includes("Import Session"))).toBe(true);
    expect(labels.some((l) => l.includes("Export Session"))).toBe(false);

    const timeline = await mountAt("/session/abc");
    await timeline.find(".dropdown-toggle").trigger("click");
    const timelineItems = timeline.findAll(".dropdown-item");
    const timelineLabels = timelineItems.map((i) => i.text());
    expect(timelineLabels.some((l) => l.includes("Import Session"))).toBe(
      false,
    );
    expect(timelineLabels.some((l) => l.includes("Export Session"))).toBe(
      true,
    );
  });

  it("emits toggleTheme when theme menu item is clicked", async () => {
    const wrapper = await mountAt("/");
    await wrapper.find(".dropdown-toggle").trigger("click");
    const items = wrapper.findAll(".dropdown-item");
    const themeItem = items.find((i) => i.text().includes("Toggle theme"));
    expect(themeItem).toBeDefined();
    await themeItem!.trigger("click");
    const events = wrapper.emitted("toggleTheme");
    expect(events).toBeTruthy();
    expect(events!.length).toBe(1);
  });

  it("emits toggleTrace with ON/OFF label based on prop", async () => {
    const on = await mountAt("/", true);
    await on.find(".dropdown-toggle").trigger("click");
    const onItems = on.findAll(".dropdown-item");
    const traceOn = onItems.find((i) => i.text().includes("Trace ON"));
    expect(traceOn).toBeDefined();
    await traceOn!.trigger("click");
    expect(on.emitted("toggleTrace")).toBeTruthy();

    const off = await mountAt("/", false);
    await off.find(".dropdown-toggle").trigger("click");
    const offItems = off.findAll(".dropdown-item");
    const traceOff = offItems.find((i) => i.text().includes("Trace OFF"));
    expect(traceOff).toBeDefined();
  });

  it("emits import and keyboardHelp events", async () => {
    const wrapper = await mountAt("/");
    await wrapper.find(".dropdown-toggle").trigger("click");
    const items = wrapper.findAll(".dropdown-item");
    const importItem = items.find((i) => i.text().includes("Import Session"));
    const keyboardItem = items.find((i) =>
      i.text().includes("Keyboard shortcuts"),
    );
    await importItem!.trigger("click");
    await wrapper.find(".dropdown-toggle").trigger("click");
    const items2 = wrapper.findAll(".dropdown-item");
    const keyboardItem2 = items2.find((i) =>
      i.text().includes("Keyboard shortcuts"),
    );
    await keyboardItem2!.trigger("click");

    expect(wrapper.emitted("import")).toBeTruthy();
    expect(wrapper.emitted("keyboardHelp")).toBeTruthy();
  });
});
