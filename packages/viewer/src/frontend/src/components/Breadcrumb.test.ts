import { describe, it, expect, beforeEach } from "vitest";
import { mount, RouterLinkStub } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import Breadcrumb from "./Breadcrumb.vue";

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

async function mountAt(path: string) {
  await router.push(path);
  await router.isReady();
  return mount(Breadcrumb, {
    global: {
      plugins: [router],
      stubs: { "router-link": RouterLinkStub },
    },
  });
}

describe("Breadcrumb", () => {
  beforeEach(() => {
    // reset router to home
    router.push("/");
  });

  it("renders just the Sessions root crumb on the sessions (root) route", async () => {
    const wrapper = await mountAt("/");
    const breadcrumb = wrapper.find(".breadcrumb");
    expect(breadcrumb.exists()).toBe(true);
    expect(breadcrumb.text()).toContain("Sessions");
    const current = wrapper.find(".current");
    expect(current.exists()).toBe(true);
    expect(current.text()).toBe("Sessions");
  });

  it("renders Sessions > sessionId on the timeline route", async () => {
    const wrapper = await mountAt("/session/abc-123");
    const breadcrumb = wrapper.find(".breadcrumb");
    expect(breadcrumb.exists()).toBe(true);
    expect(breadcrumb.text()).toContain("Sessions");
    expect(breadcrumb.text()).toContain("abc-123");
    const links = wrapper.findAllComponents(RouterLinkStub);
    expect(links.length).toBeGreaterThanOrEqual(1);
    const current = wrapper.find(".current");
    expect(current.exists()).toBe(true);
    expect(current.text()).toBe("abc-123");
  });

  it("renders Sessions > sessionId > #recordId on the record route", async () => {
    const wrapper = await mountAt("/session/sess-1/record/42");
    const text = wrapper.find(".breadcrumb").text();
    expect(text).toContain("Sessions");
    expect(text).toContain("sess-1");
    expect(text).toContain("#42");
    const current = wrapper.find(".current");
    expect(current.text()).toBe("#42");
  });

  it("renders separators between crumbs on the record route", async () => {
    const wrapper = await mountAt("/session/sess-1/record/42");
    const seps = wrapper.findAll(".sep");
    expect(seps.length).toBe(2);
  });
});
