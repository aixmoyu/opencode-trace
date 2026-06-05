import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ConfirmDialog from "./ConfirmDialog.vue";

function mountDialog(overrides: { title?: string; message?: string } = {}) {
  return mount(ConfirmDialog, {
    props: {
      title: overrides.title ?? "Delete Session",
      message: overrides.message ?? "Are you sure?",
    },
    global: { stubs: { Teleport: true } },
    attachTo: document.body,
  });
}

describe("ConfirmDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("renders title and message", () => {
    const wrapper = mountDialog({
      title: "Delete File",
      message: "This cannot be undone",
    });
    expect(wrapper.find(".confirm-title").text()).toBe("Delete File");
    expect(wrapper.find(".confirm-message").text()).toBe(
      "This cannot be undone",
    );
  });

  it("renders cancel and danger buttons", () => {
    const wrapper = mountDialog();
    const buttons = wrapper.findAll(".confirm-btn");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].text()).toBe("Cancel");
    expect(buttons[0].classes()).toContain("cancel");
    expect(buttons[1].text()).toBe("Delete");
    expect(buttons[1].classes()).toContain("danger");
  });

  it("emits confirm when danger button is clicked", async () => {
    const wrapper = mountDialog();
    const confirmBtn = wrapper.findAll(".confirm-btn")[1];
    await confirmBtn.trigger("click");
    expect(wrapper.emitted("confirm")).toBeTruthy();
  });

  it("emits cancel when cancel button is clicked", async () => {
    const wrapper = mountDialog();
    const cancelBtn = wrapper.findAll(".confirm-btn")[0];
    await cancelBtn.trigger("click");
    expect(wrapper.emitted("cancel")).toBeTruthy();
  });

  it("uses the proper ARIA attributes", () => {
    const wrapper = mountDialog();
    const overlay = wrapper.find(".confirm-overlay");
    expect(overlay.attributes("role")).toBe("alertdialog");
    expect(overlay.attributes("aria-modal")).toBe("true");
    const title = wrapper.find(".confirm-title");
    const message = wrapper.find(".confirm-message");
    expect(overlay.attributes("aria-labelledby")).toBe(title.attributes("id"));
    expect(overlay.attributes("aria-describedby")).toBe(
      message.attributes("id"),
    );
  });
});
