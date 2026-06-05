import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ResponseView from "./ResponseView.vue";

const fullRecord = {
  response: {
    headers: { "content-type": "application/json" },
    body: { id: "chatcmpl-1", model: "gpt-4", choices: [] },
  },
};

describe("ResponseView", () => {
  it("renders response headers and body", () => {
    const wrapper = mount(ResponseView, { props: { record: fullRecord } });
    expect(wrapper.html()).toContain("RESPONSE HEADERS");
    expect(wrapper.html()).toContain("content-type");
    expect(wrapper.html()).toContain("RESPONSE BODY");
    expect(wrapper.html()).toContain("chatcmpl-1");
  });

  it("renders empty state when response is missing", () => {
    const wrapper = mount(ResponseView, { props: { record: {} } });
    expect(wrapper.find(".empty-state").exists()).toBe(true);
    expect(wrapper.html()).toContain("No response data");
  });

  it("uses an empty object for missing headers", () => {
    const wrapper = mount(ResponseView, {
      props: { record: { response: { body: { ok: true } } } },
    });
    expect(wrapper.html()).toContain("RESPONSE HEADERS");
    expect(wrapper.html()).toContain("RESPONSE BODY");
  });

  it("uses an empty object for missing body", () => {
    const wrapper = mount(ResponseView, {
      props: { record: { response: { headers: { a: "b" } } } },
    });
    expect(wrapper.html()).toContain("RESPONSE BODY");
  });

  it("collapses a section when its title is clicked", async () => {
    const wrapper = mount(ResponseView, { props: { record: fullRecord } });
    const titles = wrapper.findAll(".section-title");
    const headersTitle = titles[0];
    expect(headersTitle.classes()).toContain("expanded");
    await headersTitle.trigger("click");
    expect(headersTitle.classes()).not.toContain("expanded");
  });
});
