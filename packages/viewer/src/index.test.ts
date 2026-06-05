import { describe, it, expect } from "vitest";

describe("index (barrel)", () => {
  it("re-exports createViewer from ./server.js", async () => {
    const indexExports = await import("./index.js");
    expect(indexExports.createViewer).toBeDefined();
    expect(typeof indexExports.createViewer).toBe("function");
  });

  it("createViewer reference equals the one exported from server.js", async () => {
    const indexExports = await import("./index.js");
    const serverExports = await import("./server.js");
    expect(indexExports.createViewer).toBe(serverExports.createViewer);
  });

  it("exposes only runtime symbols (types are erased)", async () => {
    const indexExports = await import("./index.js");
    const runtimeKeys = Object.keys(indexExports).sort();
    // ViewerOptions and ViewerInstance are type-only re-exports
    // so only createViewer is present at runtime.
    expect(runtimeKeys).toEqual(["createViewer"]);
  });
});
