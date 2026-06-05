import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import FabButtons from "./FabButtons.vue";

describe("FabButtons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("renders the floating action container with two scroll buttons", () => {
    const wrapper = mount(FabButtons);
    expect(wrapper.find(".fab-container").exists()).toBe(true);
    const buttons = wrapper.findAll("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].attributes("aria-label")).toBe("Scroll to top");
    expect(buttons[1].attributes("aria-label")).toBe("Scroll to bottom");
  });

  it("calls scrollTo on <main> when scroll-to-top is clicked", async () => {
    const main = document.createElement("main");
    const scrollToSpy = vi.fn();
    main.scrollTo = scrollToSpy;
    document.body.appendChild(main);

    const wrapper = mount(FabButtons, { attachTo: document.body });
    const buttons = wrapper.findAll("button");
    await buttons[0].trigger("click");
    expect(scrollToSpy).toHaveBeenCalledWith({
      top: 0,
      behavior: "smooth",
    });
  });

  it("calls scrollTo to bottom on <main> when scroll-to-bottom is clicked", async () => {
    const main = document.createElement("main");
    Object.defineProperty(main, "scrollHeight", { value: 2000, configurable: true });
    const scrollToSpy = vi.fn();
    main.scrollTo = scrollToSpy;
    document.body.appendChild(main);

    const wrapper = mount(FabButtons, { attachTo: document.body });
    const buttons = wrapper.findAll("button");
    await buttons[1].trigger("click");
    expect(scrollToSpy).toHaveBeenCalledWith({
      top: 2000,
      behavior: "smooth",
    });
  });

  it("does not throw if there is no <main> element", async () => {
    const wrapper = mount(FabButtons, { attachTo: document.body });
    const buttons = wrapper.findAll("button");
    await expect(buttons[0].trigger("click")).resolves.not.toThrow();
    await expect(buttons[1].trigger("click")).resolves.not.toThrow();
  });
});
