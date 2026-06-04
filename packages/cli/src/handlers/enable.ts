import { record } from "@opencode-trace/core";
import { parseFlags, GLOBAL_TRACE_DIR, LOCAL_TRACE_DIR } from "../utils.js";

export async function cmdEnable(args: string[]): Promise<void> {
  await cmdSetEnabled(args, true);
}

export async function cmdSetEnabled(
  args: string[],
  enable: boolean,
): Promise<void> {
  const { positional, flags } = parseFlags(args);

  const hasGlobal = flags.global === true;
  const hasLocal = flags.local === true;
  const hasSession = flags.session === true;
  const anyScope = hasGlobal || hasLocal || hasSession;
  const dir = typeof flags.dir === "string" ? flags.dir : "global";

  const enabled: string[] = [];

  if (hasGlobal || !anyScope) {
    await record.initStateManager(GLOBAL_TRACE_DIR);
    record.setGlobalTraceEnabled(enable, GLOBAL_TRACE_DIR);
    record.setStoragePreference(dir as "global" | "local", GLOBAL_TRACE_DIR);
    enabled.push("global");
  }

  if (hasLocal) {
    await record.initStateManager(LOCAL_TRACE_DIR);
    record.setGlobalTraceEnabled(enable, LOCAL_TRACE_DIR);
    enabled.push("local");
  }

  if (hasSession) {
    const sessionId = positional[0];
    if (!sessionId) {
      console.error("Error: session-id is required when using -s");
      process.exit(1);
    }
    await record.initStateManager(GLOBAL_TRACE_DIR);
    record.setSessionEnabled(sessionId, enable, GLOBAL_TRACE_DIR);
    if (flags.dir) {
      record.setSessionStoragePreference(sessionId, dir as "global" | "local", GLOBAL_TRACE_DIR);
    }
    enabled.push("session");
  }

  const action = enable ? "enabled" : "disabled";
  const storageInfo = flags.dir ? `, storage: ${dir}` : "";
  console.log(`Trace ${action} (scope: ${enabled.join(", ")}${storageInfo})`);
}
