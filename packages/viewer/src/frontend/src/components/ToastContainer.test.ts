import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import ToastContainer from "./ToastContainer.vue";
import { useToast, toastState } from "../composables/useToast";

async function flush() {
  await nextTick();
  await new Promise((r) => setTimeout(r, 0));
}

describe("ToastContainer", () => {
  beforeEach(() => {
    toastState.value = [];
  });

  it("renders nothing when there are no toasts", () => {
    const wrapper = mount(ToastContainer, {
      global: { stubs: { Teleport: true } },
    });
    expect(wrapper.find(".toast-container").exists()).toBe(false);
  });

  it("renders a single toast with message", () => {
    const { showToast } = useToast();
    showToast("Saved successfully", "success");
    const wrapper = mount(ToastContainer, {
      global: { stubs: { Teleport: true } },
    });
    expect(wrapper.find(".toast").text()).toContain("Saved successfully");
    expect(wrapper.find(".toast").classes()).toContain("success");
  });

  it("renders multiple toasts stacked", () => {
    const { showToast } = useToast();
    showToast("One", "info");
    showToast("Two", "warning");
    showToast("Three", "error");
    const wrapper = mount(ToastContainer, {
      global: { stubs: { Teleport: true } },
    });
    const toasts = wrapper.findAll(".toast");
    expect(toasts).toHaveLength(3);
    expect(toasts[0].classes()).toContain("info");
    expect(toasts[1].classes()).toContain("warning");
    expect(toasts[2].classes()).toContain("error");
  });

  it("renders action button when actionLabel is provided", () => {
    const { showToast } = useToast();
    const onAction = vi.fn();
    showToast("Confirm?", "info", onAction, "Undo");
    const wrapper = mount(ToastContainer, {
      global: { stubs: { Teleport: true } },
    });
    const actionBtn = wrapper.find(".toast-action");
    expect(actionBtn.exists()).toBe(true);
    expect(actionBtn.text()).toBe("Undo");
  });

  it("invokes onAction and dismisses the toast when action clicked", async () => {
    const { showToast } = useToast();
    const onAction = vi.fn();
    showToast("Confirm?", "info", onAction, "OK");
    const wrapper = mount(ToastContainer, {
      global: { stubs: { Teleport: true } },
    });
    await wrapper.find(".toast-action").trigger("click");
    expect(onAction).toHaveBeenCalledOnce();
    expect(toastState.value).toHaveLength(0);
  });

  it("auto-dismisses a toast after the duration", async () => {
    const { showToast } = useToast();
    showToast("Hello", "info", undefined, undefined, 30);
    const wrapper = mount(ToastContainer, {
      global: { stubs: { Teleport: true } },
    });
    expect(wrapper.findAll(".toast")).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 60));
    expect(toastState.value).toHaveLength(0);
  });
});
