import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import RequestView from "./RequestView.vue";

const fullRecord = {
  request: {
    headers: { "content-type": "application/json", "x-trace-id": "abc-123" },
    body: { model: "gpt-4", messages: [{ role: "user", content: "hi" }] },
  },
};

describe("RequestView", () => {
  it("renders the request headers section", () => {
    const wrapper = mount(RequestView, { props: { record: fullRecord } });
    expect(wrapper.html()).toContain("REQUEST HEADERS");
    expect(wrapper.html()).toContain("content-type");
  });

  it("renders the request body section", () => {
    const wrapper = mount(RequestView, { props: { record: fullRecord } });
    expect(wrapper.html()).toContain("REQUEST BODY");
    expect(wrapper.html()).toContain("gpt-4");
  });

  it("uses an empty object for missing headers", () => {
    const wrapper = mount(RequestView, {
      props: { record: { request: { body: { x: 1 } } } },
    });
    expect(wrapper.html()).toContain("REQUEST HEADERS");
    expect(wrapper.html()).toContain("REQUEST BODY");
  });

  it("uses an empty object for missing body", () => {
    const wrapper = mount(RequestView, {
      props: { record: { request: { headers: { a: "b" } } } },
    });
    expect(wrapper.html()).toContain("REQUEST BODY");
  });

  it("collapses a section when its title is clicked", async () => {
    const wrapper = mount(RequestView, { props: { record: fullRecord } });
    const titles = wrapper.findAll(".section-title");
    const headersTitle = titles[0];
    expect(headersTitle.classes()).toContain("expanded");
    await headersTitle.trigger("click");
    expect(headersTitle.classes()).not.toContain("expanded");
  });
});
