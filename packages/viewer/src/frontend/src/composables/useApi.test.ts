import { describe, it, expect, vi, afterEach } from "vitest";
import { api, apiPost, apiDelete } from "./useApi";

function mockResponse(body: unknown, init: { status?: number; ok?: boolean } = {}) {
  const status = init.status ?? 200;
  const ok = init.ok ?? (status >= 200 && status < 300);
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("useApi", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("api()", () => {
    it("fetches a path and returns parsed JSON on success", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(mockResponse({ hello: "world" }));

      const result = await api<{ hello: string }>("sessions");

      expect(fetchSpy).toHaveBeenCalledWith("/api/sessions");
      expect(result).toEqual({ hello: "world" });
    });

    it("throws on non-2xx response with status code in message", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockResponse({ error: "not found" }, { status: 404 }),
      );

      await expect(api("missing")).rejects.toThrow("API error: 404");
    });

    it("propagates network errors from fetch", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

      await expect(api("sessions")).rejects.toThrow("network down");
    });
  });

  describe("apiPost()", () => {
    it("POSTs a JSON body with Content-Type header", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(mockResponse({ ok: true }));

      const result = await apiPost<{ ok: boolean }>("enable", { value: 1 });

      expect(fetchSpy).toHaveBeenCalledWith("/api/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: 1 }),
      });
      expect(result).toEqual({ ok: true });
    });

    it("POSTs a raw string body without forcing Content-Type", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(mockResponse({}));

      await apiPost("raw", "hello=world");

      expect(fetchSpy).toHaveBeenCalledWith("/api/raw", {
        method: "POST",
        headers: {},
        body: "hello=world",
      });
    });

    it("POSTs FormData without forcing Content-Type", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(mockResponse({}));

      const fd = new FormData();
      fd.append("k", "v");

      await apiPost("upload", fd);

      const [, init] = fetchSpy.mock.calls[0];
      expect((init as RequestInit).body).toBe(fd);
      expect((init as RequestInit).headers).toEqual({});
    });

    it("POSTs with no body and no Content-Type when body is undefined", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(mockResponse({}));

      await apiPost("ping");

      expect(fetchSpy).toHaveBeenCalledWith("/api/ping", {
        method: "POST",
        headers: {},
        body: undefined,
      });
    });

    it("throws on non-2xx POST response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockResponse(null, { status: 500 }),
      );

      await expect(apiPost("boom", { a: 1 })).rejects.toThrow("API error: 500");
    });
  });

  describe("apiDelete()", () => {
    it("issues a POST request (as implemented) and parses JSON", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(mockResponse({ deleted: true }));

      const result = await apiDelete<{ deleted: boolean }>("session/abc");

      expect(fetchSpy).toHaveBeenCalledWith("/api/session/abc", {
        method: "POST",
      });
      expect(result).toEqual({ deleted: true });
    });

    it("throws on non-2xx response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockResponse(null, { status: 403 }),
      );

      await expect(apiDelete("forbidden")).rejects.toThrow("API error: 403");
    });
  });
});
