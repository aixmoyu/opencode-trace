import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ChangeSummary from "./ChangeSummary.vue";
import type { Block } from "../utils/block-defs";

function text(change: { delta?: unknown } | null) {
  return mount(ChangeSummary, { props: { change } }).text();
}

describe("ChangeSummary", () => {
  it("renders nothing when change is null", () => {
    const wrapper = mount(ChangeSummary, { props: { change: null } });
    expect(wrapper.find("span").exists()).toBe(false);
  });

  it("renders nothing when delta is undefined", () => {
    const wrapper = mount(ChangeSummary, { props: { change: {} } });
    expect(wrapper.find("span").exists()).toBe(false);
  });

  it("renders SYS additions", () => {
    const change = {
      delta: {
        sys: {
          added: [{ type: "text" } as Block],
          removed: [] as Block[],
        },
      },
    };
    expect(text(change)).toContain("SYS");
    expect(text(change)).toContain("TEXT");
    expect(text(change)).toContain("+1");
  });

  it("renders TOOL removals", () => {
    const change = {
      delta: {
        tool: {
          added: [] as Block[],
          removed: [{ type: "tc" } as Block, { type: "tc" } as Block],
        },
      },
    };
    expect(text(change)).toContain("TOOL");
    expect(text(change)).toContain("-2");
  });

  it("renders MSG additions and removals", () => {
    const change = {
      delta: {
        msgs: [
          {
            added: [{ type: "text" } as Block],
            removed: [] as Block[],
          },
          {
            added: [] as Block[],
            removed: [{ type: "tr" } as Block],
          },
        ],
      },
    };
    expect(text(change)).toContain("MSG");
    expect(text(change)).toContain("+1");
    expect(text(change)).toContain("-1");
  });

  it("uses the block type as the category label", () => {
    const change = {
      delta: {
        sys: {
          added: [{ type: "thinking" } as Block],
          removed: [] as Block[],
        },
      },
    };
    expect(text(change)).toContain("THINKING");
  });

  it("skips a category when both added and removed are empty", () => {
    const change = {
      delta: {
        sys: { added: [] as Block[], removed: [] as Block[] },
        tool: {
          added: [{ type: "tc" } as Block],
          removed: [] as Block[],
        },
      },
    };
    expect(text(change)).not.toContain("SYS");
    expect(text(change)).toContain("TOOL");
  });
});
