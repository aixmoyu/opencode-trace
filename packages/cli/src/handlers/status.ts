import { record } from "@opencode-trace/core";
import { parseFlags, GLOBAL_TRACE_DIR, LOCAL_TRACE_DIR } from "../utils.js";

export async function cmdStatus(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);

  let traceDir: string;
  let mode: string;

  if (flags.local) {
    traceDir = LOCAL_TRACE_DIR;
    mode = "local";
  } else {
    traceDir = GLOBAL_TRACE_DIR;
    mode = "global";
  }

  await record.initStateManager(traceDir);

  const status: {
    mode?: string;
    globalEnabled?: boolean;
    sessionEnabled?: boolean;
    sessionId?: string;
  } = { mode };

  if (flags.session) {
    const sessionId = positional[0];
    if (!sessionId) {
      console.error("Error: session-id is required when using -s");
      process.exit(1);
    }
    status.globalEnabled = record.getGlobalTraceEnabled(traceDir);
    status.sessionEnabled = record.getSessionEnabled(sessionId, traceDir);
    status.sessionId = sessionId;
  } else {
    status.globalEnabled = record.getGlobalTraceEnabled(traceDir);
  }

  console.log(JSON.stringify(status, null, 2));
}
