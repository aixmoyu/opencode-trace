import { store } from "@opencode-trace/core";
import { GLOBAL_TRACE_DIR, LOCAL_TRACE_DIR } from "../utils.js";

export function cmdList(args: string[]): void {
  const sessions = store.listSessionsFromBothDirs({ globalDir: GLOBAL_TRACE_DIR, localDir: LOCAL_TRACE_DIR });

  if (sessions.length === 0) {
    console.log("No sessions found.");
    return;
  }

  for (const s of sessions) {
    const scopeTag = s.scope === "local" ? "[local]" : "[global]";
    console.log(
      `${s.id} ${scopeTag}  title:${s.title ?? "?"}  created:${s.createdAt ?? "?"}  updated:${s.updatedAt ?? "?"}`
    );
  }
}