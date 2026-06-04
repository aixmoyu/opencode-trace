import { record } from "@opencode-trace/core";
import { parseFlags, GLOBAL_TRACE_DIR, LOCAL_TRACE_DIR } from "../utils.js";

export async function cmdStatus(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);

  const hasGlobal = flags.global === true;
  const hasLocal = flags.local === true;
  const hasSession = flags.session === true;
  const anyScope = hasGlobal || hasLocal || hasSession;

  const status: Record<string, unknown> = {};

  if (hasGlobal || !anyScope) {
    await record.initStateManager(GLOBAL_TRACE_DIR);
    status.global = {
      enabled: record.getGlobalTraceEnabled(GLOBAL_TRACE_DIR),
      storage: record.getStoragePreference(GLOBAL_TRACE_DIR),
    };
  }

  if (hasLocal) {
    await record.initStateManager(LOCAL_TRACE_DIR);
    status.local = {
      enabled: record.getGlobalTraceEnabled(LOCAL_TRACE_DIR),
    };
  }

  if (hasSession) {
    const sessionId = positional[0];
    if (!sessionId) {
      console.error("Error: session-id is required when using -s");
      process.exit(1);
    }
    await record.initStateManager(GLOBAL_TRACE_DIR);
    status.session = {
      id: sessionId,
      enabled: record.getSessionEnabled(sessionId, GLOBAL_TRACE_DIR),
      storage: record.getSessionStoragePreference(sessionId, GLOBAL_TRACE_DIR),
    };
  }

  console.log(JSON.stringify(status, null, 2));
}
