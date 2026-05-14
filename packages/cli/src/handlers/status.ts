import { record } from "@opencode-trace/core";
import { parseFlags, GLOBAL_TRACE_DIR, LOCAL_TRACE_DIR } from "../utils.js";

export async function cmdStatus(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const traceDir = flags.session ? LOCAL_TRACE_DIR : GLOBAL_TRACE_DIR;

  await record.initStateManager(traceDir);

  const status: {
    globalEnabled?: boolean;
    sessionEnabled?: boolean;
    sessionId?: string;
  } = {};

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