import type {
  Plugin,
  PluginModule,
  Hooks,
  PluginInput,
  Config as PluginConfig,
} from "@opencode-ai/plugin";
import type { Event, Session, Part } from "@opencode-ai/sdk";
import { join } from "node:path";
import { homedir } from "node:os";
import { logger } from "@opencode-trace/core";
import { ConfigManager } from "@opencode-trace/core/state";
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
          instance
            .getStateManager()!
            .addSubSession(input.sessionID, metadata.session_id);
        }
      }
    },
    config: async (input: PluginConfig) => {
      input.command = input.command ?? {};
      input.command["trace"] = {
        template: "",
        description: "Enable/disable trace recording via /trace <on|off|status>",
      };
    },

    "command.execute.before": async (
      input: { command: string; sessionID: string; arguments: string; },
      output: { parts: Part[]; },
    ) => {
      if (input.command !== "trace") return;
      if (!instance.getStateManager()) return;

      const tokens = input.arguments.split(/\s+/).filter(Boolean);
      const isLocal = tokens.includes("-l");
      const cmd = tokens.filter((t: string) => t !== "-l")[0]?.toLowerCase();

      let result: string;

      try {
        const sm = instance.getStateManager()!;
        const storage = instance.getStorageStatus();

        if (!cmd || cmd === "help") {
          result = [
            "Usage: /trace <on|off> [-l]",
            "",
            "  on         Enable trace recording (global by default)",
            "  off        Disable trace recording (global by default)",
            "  -l         Operate on local storage instead of global",
            "  status     Show current trace status",
            "",
            "If global and local are both enabled, records are saved locally.",
            "",
            "Examples:",
            "  /trace on          Enable trace globally",
            "  /trace on -l       Enable trace locally",
            "  /trace off         Disable trace globally",
            "  /trace off -l      Disable trace locally",
          ].join("\n");
        } else if (cmd === "on" || cmd === "enable") {
          if (isLocal) {
            const localConfig = new ConfigManager(storage.localDir);
            await localConfig.init();
            localConfig.setGlobalState("global_trace_enabled", "true");
            instance.useLocalDir();
            result = "opencode-trace: Trace enabled (local)";
          } else {
            sm.setGlobalState("global_trace_enabled", "true");
            result = "opencode-trace: Trace enabled (global)";
          }
        } else if (cmd === "off" || cmd === "disable") {
          if (isLocal) {
            const localConfig = new ConfigManager(storage.localDir);
            await localConfig.init();
            localConfig.setGlobalState("global_trace_enabled", "false");
            result = "opencode-trace: Trace disabled (local)";
          } else {
            sm.setGlobalState("global_trace_enabled", "false");
            result = "opencode-trace: Trace disabled (global)";
          }
        } else if (cmd === "status") {
          const globalEnabled = sm.getGlobalState("global_trace_enabled") === "true";
          let localEnabled = false;
          try {
            const localConfig = new ConfigManager(storage.localDir);
            await localConfig.init();
            localEnabled = localConfig.getGlobalState("global_trace_enabled") === "true";
          } catch { /* local dir may not exist */ }
          result = [
            `opencode-trace: global=${globalEnabled ? "ON" : "OFF"}`,
            `opencode-trace: local=${localEnabled ? "ON" : "OFF"}`,
            `opencode-trace: storage=${storage.mode}`,
          ].join("\n");
        } else {
          result = `opencode-trace: Unknown option: ${cmd}`;
        }
      } catch (err) {
        result = `opencode-trace: Error: ${err instanceof Error ? err.message : String(err)}`;
      }

      // Send noreply result (following DCP sendIgnoredMessage pattern)
      try {
        await client.session.prompt({
          path: { id: input.sessionID },
          body: {
            noReply: true,
            parts: [{ type: "text", text: result, ignored: true }],
          },
        });
      } catch (err) {
        // Log but don't block — the command must still be consumed
        logger.error("Failed to send trace command response", { error: String(err) });
      }

      // Clear parts so original command doesn't reach LLM
      output.parts.length = 0;

      // Signal "handled" to stop the command pipeline (DCP pattern)
      throw new Error("__TRACE_HANDLED__");
    },

    tool: {
      trace_enable: {
        description:
          "Enable trace recording for the current session. When global trace is disabled, only enabled sessions will be recorded.",
        args: {},
        execute: async (_, context) => {
          if (!instance.getStateManager()) {
            return "StateManager not initialized";
          }
          instance
            .getStateManager()!
            .setSessionEnabled(context.sessionID, true);
          return `Trace enabled for session ${context.sessionID}`;
        },
      },
      trace_disable: {
        description:
          "Disable trace recording for the current session. This session will not be recorded even if global trace is enabled.",
        args: {},
        execute: async (_, context) => {
          if (!instance.getStateManager()) {
            return "StateManager not initialized";
          }
          instance
            .getStateManager()!
            .setSessionEnabled(context.sessionID, false);
          return `Trace disabled for session ${context.sessionID}`;
        },
      },
      trace_status: {
        description:
          "Check the trace recording status for the current session. Shows both global and session-level status.",
        args: {},
        execute: async (_, context) => {
          if (!instance.getStateManager()) {
            return "StateManager not initialized";
          }
          const globalEnabled =
            instance
              .getStateManager()!
              .getGlobalState("global_trace_enabled") === "true";
          const sessionEnabled = instance
            .getStateManager()!
            .getSessionEnabled(context.sessionID);
          const willRecord = instance
            .getStateManager()!
            .isTraceEnabled(context.sessionID);
          return JSON.stringify(
            {
              globalEnabled,
              sessionEnabled,
              willRecord,
              sessionId: context.sessionID,
            },
            null,
            2,
          );
        },
      },
      trace_use_global: {
        description:
          "Switch to global storage mode. Traces will be saved to ~/.opencode-trace (default).",
        args: {},
        execute: async (_, context) => {
          if (!instance.getStateManager()) {
            return "StateManager not initialized";
          }
          instance.useGlobalDir();
          return `Switched to global mode. Traces will be saved to ~/.opencode-trace`;
        },
      },
      trace_use_local: {
        description:
          "Switch to local storage mode. Traces will be saved to .opencode-trace in the current directory.",
        args: {},
        execute: async (_, context) => {
          if (!instance.getStateManager()) {
            return "StateManager not initialized";
          }
          instance.useLocalDir();
          return `Switched to local mode. Traces will be saved to ./.opencode-trace`;
        },
      },
      trace_storage_status: {
        description:
          "Check current storage mode (global or local) and directories.",
        args: {},
        execute: async (_, context) => {
          const status = instance.getStorageStatus();
          return JSON.stringify(status, null, 2);
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
