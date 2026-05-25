import { record } from "@opencode-trace/core";
import { parseFlags, GLOBAL_TRACE_DIR, LOCAL_TRACE_DIR } from "../utils.js";

export async function cmdEnable(args: string[]): Promise<void> {
  await cmdSetEnabled(args, true);
}

export async function cmdSetEnabled(args: string[], enable: boolean): Promise<void> {
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

  if (flags.session) {
    const sessionId = positional[0];
    if (!sessionId) {
      console.error(`Error: session-id is required when using -s`);
      process.exit(1);
    }
    record.setSessionEnabled(sessionId, enable, traceDir);
    console.log(`Session ${sessionId} ${enable ? 'enabled' : 'disabled'} in ${mode} mode.`);
  } else {
    record.setGlobalTraceEnabled(enable, traceDir);
    console.log(`Global trace ${enable ? 'enabled' : 'disabled'} in ${mode} mode.`);
  }
}