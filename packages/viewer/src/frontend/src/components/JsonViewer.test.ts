import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import JsonViewer from "./JsonViewer.vue";

describe("JsonViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a simple object as JSON lines", () => {
    const wrapper = mount(JsonViewer, {
      props: { data: { foo: "bar" } },
    });
    const lines = wrapper.findAll(".json-line");
    expect(lines).toHaveLength(3);
    expect(lines[0].text()).toContain("1");
    expect(wrapper.html()).toContain("foo");
    expect(wrapper.html()).toContain("bar");
  });

  it("applies syntax highlighting to strings, numbers, and booleans", () => {
    const wrapper = mount(JsonViewer, {
      props: { data: { name: "alice", age: 30, active: true } },
    });
    const html = wrapper.html();
    expect(html).toMatch(/"name"/);
    expect(html).toContain("json-string");
    expect(html).toContain("json-number");
    expect(html).toContain("json-true");
  });

  it("highlights false and null values", () => {
    const wrapper = mount(JsonViewer, {
      props: { data: { a: false, b: null } },
    });
    expect(wrapper.html()).toContain("json-false");
    expect(wrapper.html()).toContain("json-null");
  });

  it("renders deep nested JSON", () => {
    const data = { a: { b: { c: { d: "deep" } } } };
    const wrapper = mount(JsonViewer, { props: { data } });
    expect(wrapper.html()).toContain("deep");
    const lines = wrapper.findAll(".json-line");
    expect(lines.length).toBeGreaterThan(5);
  });

  it("renders an array", () => {
    const wrapper = mount(JsonViewer, {
      props: { data: [1, 2, 3] },
    });
    const lines = wrapper.findAll(".json-line");
    expect(lines).toHaveLength(5);
  });

  it("escapes HTML special characters in strings", () => {
    const wrapper = mount(JsonViewer, {
      props: { data: { html: "<script>alert('x')</script>" } },
    });
    expect(wrapper.html()).not.toContain("<script>");
    expect(wrapper.html()).toContain("&lt;script&gt;");
  });

  it("renders a string data value as a quoted string", () => {
    const wrapper = mount(JsonViewer, { props: { data: "just a string" } });
    expect(wrapper.text()).toContain('"just a string"');
  });
});
