#!/usr/bin/env node
import { createViewer } from "./server.js";

const rawArgs = process.argv.slice(2);

let traceDir: string | undefined;
let openBrowser = true;
let portArg: string | undefined;

for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === "--trace-dir" && i + 1 < rawArgs.length) {
    traceDir = rawArgs[++i];
  } else if (a === "--no-open") {
    openBrowser = false;
  } else if (!a.startsWith("--") && portArg === undefined) {
    portArg = a;
  }
}

const port = portArg ? parseInt(portArg, 10) : 3210;

if (isNaN(port)) {
  console.error("Usage: opencode-trace-viewer [port] [--no-open] [--trace-dir <path>]");
  console.error("Default port: 3210");
  console.error("  --no-open      Don't open browser automatically");
  console.error("  --trace-dir    Read trace data from custom path instead of ~/.opencode-trace");
  process.exit(1);
}

createViewer({ port, open: openBrowser, traceDir }).then((instance) => {
  console.log(`opencode-trace viewer running at ${instance.url}`);
  console.log("Press Ctrl+C to stop");

  process.on("SIGINT", () => {
    instance.close();
    process.exit(0);
  });
});
