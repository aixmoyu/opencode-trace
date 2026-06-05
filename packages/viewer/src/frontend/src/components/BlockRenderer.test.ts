import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import BlockRenderer from "./BlockRenderer.vue";
import type { Block } from "../utils/block-defs";

function mountBlock(block: Block) {
  return mount(BlockRenderer, {
    props: { block },
    global: { stubs: { Teleport: true } },
  });
}

describe("BlockRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a text block with the TEXT tag", () => {
    const wrapper = mountBlock({ type: "text", text: "Hello world" });
    expect(wrapper.find(".block-type-tag").text()).toBe("TEXT");
    expect(wrapper.find(".block-type-tag").classes()).toContain("text");
    expect(wrapper.find(".block-content").text()).toContain("Hello world");
  });

  it("renders a thinking block with the THINKING tag", () => {
    const wrapper = mountBlock({
      type: "thinking",
      thinking: "Let me think...",
    });
    expect(wrapper.find(".block-type-tag").text()).toBe("THINKING");
    expect(wrapper.find(".block-type-tag").classes()).toContain("thinking");
    expect(wrapper.html()).toContain("Let me think...");
  });

  it("renders a td (tool definition) block with name in meta", () => {
    const wrapper = mountBlock({
      type: "td",
      name: "search",
      description: "Search the web",
      parameters: { type: "object" },
    });
    expect(wrapper.find(".block-type-tag").text()).toBe("TD");
    expect(wrapper.html()).toContain("search");
    expect(wrapper.html()).toContain("Search the web");
  });

  it("renders a tc (tool call) block with the tool name", () => {
    const wrapper = mountBlock({
      type: "tc",
      name: "lookup",
      arguments: '{"q":"vue"}',
    });
    expect(wrapper.find(".block-type-tag").text()).toBe("TC");
    expect(wrapper.html()).toContain("lookup");
  });

  it("renders a tr (tool result) block with the toolCallId", () => {
    const wrapper = mountBlock({
      type: "tr",
      toolCallId: "call_abc",
      content: "result text",
    });
    expect(wrapper.find(".block-type-tag").text()).toBe("TR");
    expect(wrapper.html()).toContain("call_abc");
  });

  it("renders an image block with muted placeholder", () => {
    const wrapper = mountBlock({ type: "image", data: "base64..." });
    expect(wrapper.find(".block-type-tag").text()).toBe("IMAGE");
    expect(wrapper.html()).toContain("[image]");
  });

  it("toggles between raw and rendered view for text blocks", async () => {
    const wrapper = mountBlock({ type: "text", text: "**bold**" });
    const toggle = wrapper.find(".toggle-btn");
    expect(toggle.exists()).toBe(true);
    expect(toggle.attributes("data-mode")).toBe("raw");
    await toggle.trigger("click");
    expect(toggle.attributes("data-mode")).toBe("rendered");
  });

  it("does not show the toggle button for image blocks", () => {
    const wrapper = mountBlock({ type: "image", data: "" });
    expect(wrapper.find(".toggle-btn").exists()).toBe(false);
  });

  it("hides unknown block types with no content", () => {
    const wrapper = mountBlock({ type: "weird", data: "x" } as Block);
    expect(wrapper.find(".block-item").exists()).toBe(false);
  });

  it("renders nothing for a thinking block with empty content", () => {
    const wrapper = mountBlock({ type: "thinking", thinking: "" });
    expect(wrapper.find(".block-item").exists()).toBe(false);
    expect(wrapper.find(".block-type-tag").exists()).toBe(false);
    expect(wrapper.find(".block-content").exists()).toBe(false);
  });

  it("renders nothing for a text block with empty content", () => {
    const wrapper = mountBlock({ type: "text", text: "" });
    expect(wrapper.find(".block-item").exists()).toBe(false);
    expect(wrapper.find(".block-type-tag").exists()).toBe(false);
  });

  it("renders nothing for an xml block with empty data", () => {
    const wrapper = mountBlock({ type: "xml", data: "" });
    expect(wrapper.find(".block-item").exists()).toBe(false);
  });
});
