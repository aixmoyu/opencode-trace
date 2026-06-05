import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import KeyboardHelp from "./KeyboardHelp.vue";

function mountHelp() {
  return mount(KeyboardHelp, {
    global: { stubs: { Teleport: true } },
    attachTo: document.body,
  });
}

describe("KeyboardHelp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("renders the help dialog with title and shortcuts", () => {
    const wrapper = mountHelp();
    expect(wrapper.find("#keyboard-help-title").text()).toBe(
      "Keyboard Shortcuts",
    );
    const shortcuts = wrapper.findAll(".shortcut");
    expect(shortcuts.length).toBe(4);
    expect(wrapper.html()).toContain("/");
    expect(wrapper.html()).toContain("E");
    expect(wrapper.html()).toContain("?");
    expect(wrapper.html()).toContain("Esc");
  });

  it("emits close when the close button is clicked", async () => {
    const wrapper = mountHelp();
    await wrapper.find(".help-close").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("emits close when the overlay is clicked", async () => {
    const wrapper = mountHelp();
    await wrapper.find(".keyboard-help-overlay").trigger("click.self");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("emits close on Escape key", async () => {
    const wrapper = mountHelp();
    await wrapper.find(".keyboard-help-overlay").trigger("keydown.escape");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("uses the proper ARIA attributes", () => {
    const wrapper = mountHelp();
    const overlay = wrapper.find(".keyboard-help-overlay");
    expect(overlay.attributes("role")).toBe("dialog");
    expect(overlay.attributes("aria-modal")).toBe("true");
  });
});
