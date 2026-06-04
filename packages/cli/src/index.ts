#!/usr/bin/env node
import { cmdEnable } from "./handlers/enable.js";
import { cmdDisable } from "./handlers/disable.js";
import { cmdStatus } from "./handlers/status.js";
import { cmdList } from "./handlers/list.js";
import { cmdSync } from "./handlers/sync.js";
import { cmdShow } from "./handlers/show.js";
import { cmdExport } from "./handlers/export.js";
import { cmdViewer } from "./handlers/viewer.js";

function help(): void {
  console.log(`opencode-trace - CLI for managing opencode trace data

Usage:
  opencode-trace <command> [options]

Commands:
  enable [-g] [-l] [-s <id>] [-d global|local]
                                  Enable trace recording
                                  -g, --global: enable global scope (default)
                                  -l, --local:  enable local scope
                                  -s, --session <id>: enable session scope
                                  -d, --dir <global|local>: storage location
  disable [-g] [-l] [-s <id>]     Disable trace recording
                                  -g, --global: disable global scope (default)
                                  -l, --local:  disable local scope
                                  -s, --session <id>: disable session scope
  status [-g] [-l] [-s <id>]      Show trace status
                                  -g, --global: show global scope (default)
                                  -l, --local:  show local scope
                                  -s, --session <id>: show session scope
  list                            List all sessions
                                  Shows: session-id, title, created, updated
  show <session-id> metadata      Show session metadata
  show <session-id> conversation [-r <range>] [--format json/xml] [--compact]
                                  Show conversation (last request by default)
                                  -r: request range, e.g., "1:3" means [1,3)
                                      if single number like "1", means [1,last]
                                      returns {req_id: conversation, ...}
  show <session-id> changes [-r <range>] [--format json/xml] [--compact]
                                  Show changes (all requests by default)
                                  -r: request range, e.g., "1:3" means [1,3)
                                      returns {req_id: delta, ...}
  export <session-id> -t <type> -o <folder> [-r <range>] [--format json/xml]
                                  [--collapse sys,tool,msgs]
                                  [--collapse-blocks <types>]
                                  Export session data to folder
                                  -t: metadata/conversation/changes/raw
                                      raw: export original data as ZIP
                                  -o: output folder path (required)
                                  -r: request range (not for raw)
                                  --collapse: top-level collapse (sys,tool,msgs)
                                  --collapse-blocks: block types (text,thinking,td,tc,tr,image,other)
sync [--repair]                 Sync filesystem indexes
                                   --repair: rebuild corrupted config.json
  viewer [options]                Start web viewer
                                  Options: --port <num>, --no-open
  help                            Show this help message
 `);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.error("Usage: opencode-trace <command> [options]");
    console.error(
      "Commands: enable, disable, status, list, sync, show, export",
    );
    process.exit(1);
  }

  if (command === "--version" || command === "-v") {
    console.error("opencode-trace version 0.0.1");
    process.exit(0);
  }

  if (command === "--help" || command === "-h") {
    console.error("Usage: opencode-trace <command> [options]");
    console.error("Commands:");
    console.error("  enable [-g] [-l] [-s <id>] [-d global|local]  - Enable trace recording");
    console.error("  disable [-g] [-l] [-s <id>]                    - Disable trace recording");
    console.error("  status [-g] [-l] [-s <id>]                     - Show trace status");
    console.error("  list                                            - List all sessions");
    console.error("  sync [--repair]                                 - Sync trace data");
    console.error("  viewer [options]                                - Start web viewer");
    console.error("  show <type> <session>                           - Show trace data");
    console.error("  export <type> <session>                         - Export trace data");
    process.exit(0);
  }

  const handlerArgs = args.slice(1);

  switch (command) {
    case "enable":
      await cmdEnable(handlerArgs);
      break;
    case "disable":
      await cmdDisable(handlerArgs);
      break;
    case "status":
      await cmdStatus(handlerArgs);
      break;
    case "list":
      cmdList(handlerArgs);
      break;
    case "sync":
      await cmdSync(handlerArgs);
      break;
    case "show":
      await cmdShow(handlerArgs);
      break;
    case "export":
      await cmdExport(handlerArgs);
      break;
    case "viewer":
      await cmdViewer(handlerArgs);
      break;
    case "help":
      help();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
