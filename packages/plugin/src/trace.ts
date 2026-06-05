import type {
  Plugin,
  PluginModule,
  Hooks,
  PluginInput,
  Config as PluginConfig,
} from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import type { Event, Session, Part } from "@opencode-ai/sdk";
import { join } from "node:path";
import { homedir } from "node:os";
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

function formatStatus(instance: TracePlugin, sessionId?: string): string {
  const status = instance.getScopeStatus(sessionId);
  const lines = [
    `Trace Status:`,
    `  Global  : ${status.globalEnabled ? "ON" : "OFF"}`,
    `  Local   : ${status.localEnabled ? "ON" : "OFF"}`,
    `  Session : ${status.sessionEnabled === null ? "not set" : status.sessionEnabled ? "ON" : "OFF"}`,
    `  Effective: ${status.effectiveEnabled ? "RECORDING" : "PAUSED"}`,
    `  Storage : ${status.storageLocation} (${status.storageLocation === "global" ? status.globalDir : status.localDir})`,
  ];
  return lines.join("\n");
}

const plugin: Plugin = async (input: PluginInput) => {
  const globalDir = join(homedir(), ".opencode-trace");
  const localDir = join(input.directory, ".opencode-trace");
  const instance = new TracePlugin({ globalDir, localDir });

  instance.installInterceptor();
  await instance.initStateManager();

  if (!instance.getStateManager()) {
    logger.error("StateManager initialization failed");
  }

  testPlugin = instance;

  const client = input.client;

  const hooks: Hooks = {
    event: async ({ event }: { event: Event }) => {
      if (!instance.getStateManager()) return;

      if (
        event.type === "session.created" ||
        event.type === "session.updated"
      ) {
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
          instance
            .getStateManager()!
            .addSubSession(session.parentID, session.id);
        }
      }
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args: unknown },
      output: { title: string; output: string; metadata: unknown },
    ) => {
      if (!instance.getStateManager()) return;

      if (input.tool === "task") {
        const metadata = output.metadata as Record<string, unknown> | undefined;
        if (metadata && typeof metadata.session_id === "string") {
          const sm = instance.getStateManager()!;
          sm.addSubSession(input.sessionID, metadata.session_id);
          sm.updateSessionMetadata(metadata.session_id, {
            parentID: input.sessionID,
          });
        }
      }
    },

    "chat.message": async (
      input: { sessionID: string; agent?: string; messageID?: string; variant?: string },
      _output: { message: import("@opencode-ai/sdk").UserMessage; parts: Part[] },
    ) => {
      if (!instance.getStateManager()) return;
      logger.info("chat.message", {
        sessionID: input.sessionID,
        messageID: input.messageID,
        agent: input.agent,
        variant: input.variant,
      });
    },

    "chat.params": async (
      input: { sessionID: string; agent: string; model: unknown; provider: unknown; message: unknown },
      _output: unknown,
    ) => {
      if (!instance.getStateManager()) return;
      logger.info("chat.params", {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
      });
    },

    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      _output: { args: unknown },
    ) => {
      if (!instance.getStateManager()) return;
      logger.info("tool.execute.before", {
        sessionID: input.sessionID,
        callID: input.callID,
        tool: input.tool,
      });
    },

    config: async (input: PluginConfig) => {
      input.command = input.command ?? {};
      input.command["trace"] = {
        template: "",
        description: "Control trace recording: /trace <on|off|status> [-g] [-l] [-s] [-d global|local]",
      };
    },

    "command.execute.before": async (
      input: { command: string; sessionID: string; arguments: string },
      output: { parts: Part[] },
    ) => {
      if (input.command !== "trace") return;
      if (!instance.getStateManager()) return;

      const tokens = input.arguments.split(/\s+/).filter(Boolean);
      const cmd = tokens[0]?.toLowerCase();

      const hasGlobal = tokens.includes("-g") || tokens.includes("--global");
      const hasLocal = tokens.includes("-l") || tokens.includes("--local");
      const hasSession = tokens.includes("-s") || tokens.includes("--session");
      const dirIdx = tokens.findIndex((t) => t === "-d" || t === "--dir");
      const dir = dirIdx >= 0 ? tokens[dirIdx + 1]?.toLowerCase() : undefined;

      const anyScope = hasGlobal || hasLocal || hasSession;

      let result = "";

      try {
        const sm = instance.getStateManager()!;
        const localCm = instance.getLocalConfigManager();

        if (!cmd || cmd === "help") {
          result = [
            "Usage: /trace <on|off|status> [-g] [-l] [-s] [-d global|local]",
            "",
            "Commands:",
            "  on      Enable trace recording",
            "  off     Disable trace recording",
            "  status  Show current trace status",
            "",
            "Scope flags (can combine multiple):",
            "  -g, --global   Global scope (all projects, all sessions)",
            "  -l, --local    Local scope (this project folder)",
            "  -s, --session  Session scope (current session only)",
            "  (default: -g if no scope flag given)",
            "",
            "Storage flag:",
            "  -d, --dir <global|local>  Where to save traces (default: global)",
            "",
            "Scope resolution (enable):",
            "  global > local > session  (largest scope wins)",
            "  If global is ON, tracing is ON regardless of local/session.",
            "  If global is OFF, check local; if local is OFF, check session.",
            "",
            "Storage resolution (save location):",
            "  session > global  (smallest scope wins)",
            "  If session has a storage preference, use it.",
            "  Otherwise fall back to global preference (default: global).",
            "",
            "Examples:",
            "  /trace on                     Enable globally (default)",
            "  /trace on -l                  Enable locally",
            "  /trace on -s                  Enable for this session",
            "  /trace on -g -l               Enable global + local",
            "  /trace on -d local            Enable globally, save locally",
            "  /trace on -s -d local         Enable session, save locally",
            "  /trace off                    Disable globally",
            "  /trace off -l                 Disable locally",
            "  /trace off -g -l -s           Disable all scopes",
            "  /trace status                 Show status",
          ].join("\n");
        } else if (cmd === "on" || cmd === "enable") {
          const targetDir = dir || "global";
          const enabled: string[] = [];

          if (hasGlobal || !anyScope) {
            sm.setGlobalState("global_trace_enabled", "true");
            sm.setGlobalState("storage_preference", targetDir);
            enabled.push("global");
          }
          if (hasLocal) {
            if (!localCm) {
              result = "Local config not available";
            } else {
              localCm.setGlobalState("global_trace_enabled", "true");
              enabled.push("local");
            }
          }
          if (hasSession) {
            sm.setSessionEnabled(input.sessionID, true);
            if (dir) {
              sm.setSessionStoragePreference(input.sessionID, targetDir as "global" | "local");
            }
            enabled.push("session");
          }

          if (!result) {
            result = `Trace enabled (scope: ${enabled.join(", ")}${dir ? `, storage: ${targetDir}` : ""})`;
          }
        } else if (cmd === "off" || cmd === "disable") {
          const disabled: string[] = [];

          if (hasGlobal || !anyScope) {
            sm.setGlobalState("global_trace_enabled", "false");
            disabled.push("global");
          }
          if (hasLocal) {
            if (!localCm) {
              result = "Local config not available";
            } else {
              localCm.setGlobalState("global_trace_enabled", "false");
              disabled.push("local");
            }
          }
          if (hasSession) {
            sm.setSessionEnabled(input.sessionID, false);
            disabled.push("session");
          }

          if (!result) {
            result = `Trace disabled (scope: ${disabled.join(", ")})`;
          }
        } else if (cmd === "status") {
          result = formatStatus(instance, input.sessionID);
        } else {
          result = `Unknown command: ${cmd}. Use /trace on, /trace off, or /trace status.`;
        }
      } catch (err) {
        result = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }

      try {
        await client.session.prompt({
          path: { id: input.sessionID },
          body: {
            noReply: true,
            parts: [{ type: "text", text: result, ignored: true }],
          },
        });
      } catch (err) {
        logger.error("Failed to send trace command response", { error: String(err) });
      }

      output.parts.length = 0;
      throw new Error("__TRACE_HANDLED__");
    },

    tool: {
      trace_on: tool({
        description:
          "Enable trace recording for the current session.",
        args: {},
        execute: async (_, context) => {
          if (!instance.getStateManager()) {
            return "StateManager not initialized";
          }

          const sm = instance.getStateManager()!;
          sm.setSessionEnabled(context.sessionID, true);
          return `Trace enabled for session ${context.sessionID}`;
        },
      }),

      trace_off: tool({
        description:
          "Disable trace recording for the current session.",
        args: {},
        execute: async (_, context) => {
          if (!instance.getStateManager()) {
            return "StateManager not initialized";
          }

          const sm = instance.getStateManager()!;
          sm.setSessionEnabled(context.sessionID, false);
          return `Trace disabled for session ${context.sessionID}`;
        },
      }),

      trace_status: tool({
        description:
          "Show current trace recording status across all scopes (global, local, session) " +
          "and the effective recording state and storage location.",
        args: {},
        execute: async (_, context) => {
          if (!instance.getStateManager()) {
            return "StateManager not initialized";
          }
          return formatStatus(instance, context.sessionID);
        },
      }),
    },
  };

  return hooks;
};

const entrypoint: PluginModule = {
  id: "ljw1004.opencode-trace",
  server: plugin,
};

export default entrypoint;
