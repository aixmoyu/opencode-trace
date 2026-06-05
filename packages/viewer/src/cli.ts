#!/usr/bin/env node
import { createViewer } from "./server.js";

const USAGE = [
  "Usage: opencode-trace-viewer [options]",
  "",
  "Options:",
  "  -p, --port <num>       Specify port (default 3210)",
  "  -d, --trace-dir <path> Read trace data from custom path instead of ~/.opencode-trace",
  "  -n, --no-open          Don't open browser automatically",
].join("\n");

const rawArgs = process.argv.slice(2);

let traceDir: string | undefined;
let openBrowser = true;
let port = 3210;

for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === "-p" || a === "--port") {
    const next = rawArgs[++i];
    if (next === undefined) {
      console.error("Error: -p/--port requires a port number");
      console.error(USAGE);
      process.exit(1);
    }
    const parsed = parseInt(next, 10);
    if (isNaN(parsed)) {
      console.error(`Error: invalid port: ${next}`);
      console.error(USAGE);
      process.exit(1);
    }
    port = parsed;
  } else if (a === "-d" || a === "--trace-dir") {
    const next = rawArgs[++i];
    if (next === undefined) {
      console.error("Error: -d/--trace-dir requires a path");
      console.error(USAGE);
      process.exit(1);
    }
    traceDir = next;
  } else if (a === "-n" || a === "--no-open") {
    openBrowser = false;
  } else {
    console.error(`Error: unknown argument: ${a}`);
    console.error(USAGE);
    process.exit(1);
  }
}

createViewer({ port, open: openBrowser, traceDir }).then((instance) => {
  console.log(`opencode-trace viewer running at ${instance.url}`);
  console.log("Press Ctrl+C to stop");

  process.on("SIGINT", () => {
    instance.close();
    process.exit(0);
  });
});
