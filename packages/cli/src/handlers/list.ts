import { store } from "@opencode-trace/core";
import { GLOBAL_TRACE_DIR, LOCAL_TRACE_DIR } from "../utils.js";

export function cmdList(args: string[]): void {
  const localSessions = store.listSessions({ traceDir: LOCAL_TRACE_DIR });
  const globalSessions = store.listSessions({ traceDir: GLOBAL_TRACE_DIR });

  const all = [
    ...localSessions.map((s) => ({ ...s, scope: "local" })),
    ...globalSessions.map((s) => ({ ...s, scope: "global" })),
  ];

  if (all.length === 0) {
    console.log("No sessions found.");
    return;
  }

  for (const s of all) {
    console.log(
      `${s.id}  title:${s.title ?? "?"}  created:${s.createdAt ?? "?"}  updated:${s.updatedAt ?? "?"}`
    );
  }
}