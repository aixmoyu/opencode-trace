import type { Plugin, PluginModule, Hooks, PluginInput } from "@opencode-ai/plugin";
import type { Event, Session } from "@opencode-ai/sdk";
import { join } from "node:path";
import { logger } from "@opencode-trace/core";
import { TracePlugin } from "./plugin-instance.js";

export interface TraceRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface TraceResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface TraceRecord {
  id: number;
  purpose: string;
  requestAt: string;
  responseAt: string;
  request: TraceRequest;
  response: TraceResponse | null;
  error: { message: string; stack?: string } | null;
  requestSentAt?: number;
  firstTokenAt?: number;
  lastTokenAt?: number;
}

let testPlugin: TracePlugin | null = null;

export function _resetForTesting(): void {
  if (testPlugin) {
    testPlugin.uninstallInterceptor();
    testPlugin = null;
  }
}

const plugin: Plugin = async (input: PluginInput) => {
  const traceDir = join(input.directory, ".opencode-trace");
  const instance = new TracePlugin(traceDir);

  instance.installInterceptor();
  await instance.initStateManager();

  if (!instance.getStateManager()) {
    logger.error("StateManager initialization failed");
  }

  testPlugin = instance;

  const hooks: Hooks = {
    event: async ({ event }: { event: Event }) => {
      if (!instance.getStateManager()) return;

      if (event.type === "session.created" || event.type === "session.updated") {
        const session = (event.properties as { info: Session }).info;

        const existing = instance.getStateManager()!.getSession(session.id);
        if (!existing) {
          instance.getStateManager()!.startSession(session.id);
        }

        instance.getStateManager()!.updateSessionMetadata(session.id, {
          title: session.title,
          parentID: session.parentID,
          folderPath: session.directory,
        });

        if (session.parentID) {
          instance.getStateManager()!.addSubSession(session.parentID, session.id);
        }
      }
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args: unknown },
      output: { title: string; output: string; metadata: unknown }
    ) => {
      if (!instance.getStateManager()) return;

      if (input.tool === "task") {
        const metadata = output.metadata as Record<string, unknown> | undefined;
        if (metadata && typeof metadata.session_id === "string") {
          instance.getStateManager()!.addSubSession(input.sessionID, metadata.session_id);
        }
      }
    },

    tool: {
      trace_enable: {
        description: "Enable trace recording for the current session. When global trace is disabled, only enabled sessions will be recorded.",
        args: {},
        execute: async (_, context) => {
          if (!instance.getStateManager()) {
            return "StateManager not initialized";
          }
          instance.getStateManager()!.setSessionEnabled(context.sessionID, true);
          return `Trace enabled for session ${context.sessionID}`;
        },
      },
      trace_disable: {
        description: "Disable trace recording for the current session. This session will not be recorded even if global trace is enabled.",
        args: {},
        execute: async (_, context) => {
          if (!instance.getStateManager()) {
            return "StateManager not initialized";
          }
          instance.getStateManager()!.setSessionEnabled(context.sessionID, false);
          return `Trace disabled for session ${context.sessionID}`;
        },
      },
      trace_status: {
        description: "Check the trace recording status for the current session. Shows both global and session-level status.",
        args: {},
        execute: async (_, context) => {
          if (!instance.getStateManager()) {
            return "StateManager not initialized";
          }
          const globalEnabled = instance.getStateManager()!.getGlobalState("global_trace_enabled") === "true";
          const sessionEnabled = instance.getStateManager()!.getSessionEnabled(context.sessionID);
          const willRecord = instance.getStateManager()!.isTraceEnabled(context.sessionID);
          return JSON.stringify({
            globalEnabled,
            sessionEnabled,
            willRecord,
            sessionId: context.sessionID,
          }, null, 2);
        },
      },
    },
  };

  return hooks;
};

const entrypoint: PluginModule = {
  id: "ljw1004.opencode-trace",
  server: plugin,
};

export default entrypoint;