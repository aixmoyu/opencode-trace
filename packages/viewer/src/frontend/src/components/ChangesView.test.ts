import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ChangesView from "./ChangesView.vue";
import type { Block } from "../utils/block-defs";

describe("ChangesView", () => {
  it("renders empty state when there are no changes", () => {
    const wrapper = mount(ChangesView, { props: { changeData: null } });
    expect(wrapper.find(".empty-state").exists()).toBe(true);
    expect(wrapper.html()).toContain("No change data");
  });

  it("renders empty state when delta is undefined", () => {
    const wrapper = mount(ChangesView, { props: { changeData: {} } });
    expect(wrapper.find(".empty-state").exists()).toBe(true);
  });

  it("renders added/removed sys blocks", () => {
    const wrapper = mount(ChangesView, {
      props: {
        changeData: {
          delta: {
            sys: {
              added: [{ type: "text", text: "new prompt" } as Block],
              removed: [{ type: "text", text: "old prompt" } as Block],
            },
          },
        },
      },
    });
    expect(wrapper.html()).toContain("SYSTEM PROMPT");
    expect(wrapper.html()).toContain("+NEW");
    expect(wrapper.html()).toContain("-DEL");
    expect(wrapper.html()).toContain("new prompt");
    expect(wrapper.html()).toContain("old prompt");
    expect(wrapper.findAll(".change-card.added")).toHaveLength(1);
    expect(wrapper.findAll(".change-card.removed")).toHaveLength(1);
  });

  it("renders added/removed tool blocks", () => {
    const wrapper = mount(ChangesView, {
      props: {
        changeData: {
          delta: {
            tool: {
              added: [{ type: "td", name: "newTool" } as Block],
              removed: [],
            },
          },
        },
      },
    });
    expect(wrapper.html()).toContain("TOOL DEFINITIONS");
    expect(wrapper.html()).toContain("newTool");
  });

  it("aggregates added/removed message blocks across multiple msgs entries", () => {
    const wrapper = mount(ChangesView, {
      props: {
        changeData: {
          delta: {
            msgs: [
              {
                added: [{ type: "text", text: "added1" } as Block],
                removed: [],
              },
              {
                added: [{ type: "text", text: "added2" } as Block],
                removed: [{ type: "text", text: "removed1" } as Block],
              },
            ],
          },
        },
      },
    });
    expect(wrapper.html()).toContain("MESSAGES");
    expect(wrapper.html()).toContain("added1");
    expect(wrapper.html()).toContain("added2");
    expect(wrapper.html()).toContain("removed1");
  });

  it("collapses a section when its title is clicked", async () => {
    const wrapper = mount(ChangesView, {
      props: {
        changeData: {
          delta: {
            sys: {
              added: [{ type: "text", text: "x" } as Block],
              removed: [],
            },
          },
        },
      },
    });
    const title = wrapper.find(".section-title");
    expect(title.classes()).toContain("expanded");
    await title.trigger("click");
    expect(title.classes()).not.toContain("expanded");
  });
});
