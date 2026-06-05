import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import ImportModal from "./ImportModal.vue";

function mockResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function mountModal() {
  return mount(ImportModal, {
    global: { stubs: { Teleport: true } },
  });
}

describe("ImportModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the modal with file input", () => {
    const wrapper = mountModal();
    expect(wrapper.find("#import-modal-title").text()).toBe("Import Session");
    const input = wrapper.find('input[type="file"]');
    expect(input.exists()).toBe(true);
    expect(input.attributes("accept")).toBe(".zip");
  });

  it("emits close when the close button is clicked", async () => {
    const wrapper = mountModal();
    await wrapper.find(".modal-close").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("emits close when the overlay backdrop is clicked", async () => {
    const wrapper = mountModal();
    await wrapper.find(".modal-overlay").trigger("click.self");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("shows success status and emits imported after successful upload", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({ imported: 3 }),
    );
    const wrapper = mountModal();
    const file = new File(["zip-content"], "session.zip", {
      type: "application/zip",
    });
    const input = wrapper.find('input[type="file"]');
    Object.defineProperty(input.element, "files", {
      value: [file],
      writable: false,
    });
    await input.trigger("change");
    await flushPromises();
    expect(wrapper.find(".status-msg").text()).toContain("Imported 3");
    expect(wrapper.find(".status-msg").classes()).toContain("success");
  });

  it("shows conflict panel when server reports conflicts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        conflicts: [
          { id: "sess-1", title: "First" },
          { id: "sess-2", title: "Second" },
        ],
      }),
    );
    const wrapper = mountModal();
    const file = new File(["zip-content"], "session.zip", {
      type: "application/zip",
    });
    const input = wrapper.find('input[type="file"]');
    Object.defineProperty(input.element, "files", {
      value: [file],
      writable: false,
    });
    await input.trigger("change");
    await flushPromises();
    expect(wrapper.find(".conflict-panel").exists()).toBe(true);
    expect(wrapper.findAll(".conflict-item")).toHaveLength(2);
    expect(wrapper.find(".status-msg").classes()).toContain("warning");
  });

  it("resolves conflicts with rename strategy", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockResponse({
          conflicts: [{ id: "sess-1", title: "First" }],
        }),
      )
      .mockResolvedValueOnce(mockResponse({ imported: 1 }));
    const wrapper = mountModal();
    const file = new File(["zip-content"], "session.zip", {
      type: "application/zip",
    });
    const input = wrapper.find('input[type="file"]');
    Object.defineProperty(input.element, "files", {
      value: [file],
      writable: false,
    });
    await input.trigger("change");
    await flushPromises();
    await wrapper.find(".action-rename").trigger("click");
    await flushPromises();
    const secondCall = fetchSpy.mock.calls[1];
    const body = secondCall[1]?.body as FormData;
    expect(body.get("conflictStrategy")).toBe("rename");
    expect(wrapper.find(".status-msg").text()).toContain("Imported 1");
  });

  it("resolves conflicts with skip strategy", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockResponse({
          conflicts: [{ id: "sess-1", title: "First" }],
        }),
      )
      .mockResolvedValueOnce(mockResponse({ imported: 0 }));
    const wrapper = mountModal();
    const file = new File(["zip-content"], "session.zip", {
      type: "application/zip",
    });
    const input = wrapper.find('input[type="file"]');
    Object.defineProperty(input.element, "files", {
      value: [file],
      writable: false,
    });
    await input.trigger("change");
    await flushPromises();
    await wrapper.find(".action-skip").trigger("click");
    await flushPromises();
    const secondCall = fetchSpy.mock.calls[1];
    const body = secondCall[1]?.body as FormData;
    expect(body.get("conflictStrategy")).toBe("skip");
  });

  it("shows error status on upload failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({ error: "Bad zip" }, 400),
    );
    const wrapper = mountModal();
    const file = new File(["bad"], "bad.zip", { type: "application/zip" });
    const input = wrapper.find('input[type="file"]');
    Object.defineProperty(input.element, "files", {
      value: [file],
      writable: false,
    });
    await input.trigger("change");
    await flushPromises();
    expect(wrapper.find(".status-msg").classes()).toContain("error");
  });

  it("handles no file selected gracefully", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const wrapper = mountModal();
    const input = wrapper.find('input[type="file"]');
    Object.defineProperty(input.element, "files", {
      value: [],
      writable: false,
    });
    await input.trigger("change");
    await flushPromises();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
