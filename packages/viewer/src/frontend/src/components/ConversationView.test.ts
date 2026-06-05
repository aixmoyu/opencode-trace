import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ConversationView from "./ConversationView.vue";
import type { Block } from "../utils/block-defs";

describe("ConversationView", () => {
  it("renders empty state when there is no content", () => {
    const wrapper = mount(ConversationView, {
      props: { parsed: {} },
    });
    expect(wrapper.find(".empty-state").exists()).toBe(true);
    expect(wrapper.html()).toContain("No conversation data");
  });

  it("renders the system prompt section when sys blocks are present", () => {
    const wrapper = mount(ConversationView, {
      props: {
        parsed: {
          sys: { blocks: [{ type: "text", text: "You are a helper" } as Block] },
        },
      },
    });
    expect(wrapper.html()).toContain("SYSTEM PROMPT");
    expect(wrapper.html()).toContain("You are a helper");
    expect(wrapper.findAll(".cat-tag.sys")).toHaveLength(1);
  });

  it("renders tool definitions section with count badge", () => {
    const wrapper = mount(ConversationView, {
      props: {
        parsed: {
          tool: {
            blocks: [
              { type: "td", name: "search" } as Block,
              { type: "td", name: "lookup" } as Block,
            ],
          },
        },
      },
    });
    expect(wrapper.html()).toContain("TOOL DEFINITIONS");
    expect(wrapper.html()).toContain("2 tools");
  });

  it("filters tool blocks to only td type", () => {
    const wrapper = mount(ConversationView, {
      props: {
        parsed: {
          tool: {
            blocks: [
              { type: "td", name: "tool1" } as Block,
              { type: "tc", name: "call1" } as Block,
            ],
          },
        },
      },
    });
    expect(wrapper.html()).toContain("1 tools");
  });

  it("renders messages with role tags and blocks", () => {
    const wrapper = mount(ConversationView, {
      props: {
        parsed: {
          msgs: [
            {
              role: "user",
              blocks: [{ type: "text", text: "Hello" } as Block],
            },
            {
              role: "assistant",
              blocks: [
                { type: "text", text: "Hi there" } as Block,
                { type: "thinking", thinking: "thinking..." } as Block,
              ],
            },
          ],
        },
      },
    });
    expect(wrapper.html()).toContain("MESSAGES");
    expect(wrapper.html()).toContain("user");
    expect(wrapper.html()).toContain("assistant");
    expect(wrapper.html()).toContain("Hello");
    expect(wrapper.html()).toContain("Hi there");
  });

  it("collapses a section when its title is clicked", async () => {
    const wrapper = mount(ConversationView, {
      props: {
        parsed: {
          msgs: [
            { role: "user", blocks: [{ type: "text", text: "Hi" } as Block] },
          ],
        },
      },
    });
    const title = wrapper.find(".section-title");
    expect(title.classes()).toContain("expanded");
    await title.trigger("click");
    expect(title.classes()).not.toContain("expanded");
  });
});
