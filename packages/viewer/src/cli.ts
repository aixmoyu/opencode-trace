#!/usr/bin/env node
import { createViewer } from "./server.js";

const args = process.argv.slice(2);
const openBrowser = !args.includes("--no-open");
const portArg = args.find((a) => !a.startsWith("--"));
const port = portArg ? parseInt(portArg, 10) : 3210;

if (isNaN(port)) {
  console.error("Usage: opencode-trace-viewer [port] [--no-open]");
  console.error("Default port: 3210");
  console.error("  --no-open  Don't open browser automatically");
  process.exit(1);
}

createViewer({ port, open: openBrowser }).then((instance) => {
  console.log(`opencode-trace viewer running at ${instance.url}`);
  console.log("Press Ctrl+C to stop");

  process.on("SIGINT", () => {
    instance.close();
    process.exit(0);
  });
});