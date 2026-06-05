import winston from "winston";
import { join } from "node:path";
import { getTraceDir } from "./paths.js";

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
  }),
);

type LogMode = "file" | "console" | "off";

function resolveMode(): LogMode {
  const raw = (process.env.OPENTRACE_LOG ?? "file").toLowerCase();
  if (raw === "off" || raw === "silent" || raw === "none") return "off";
  if (raw === "console" || raw === "stderr") return "console";
  return "file";
}

function resolveTransports(mode: LogMode): winston.transport[] {
  if (mode === "off") return [];
  if (mode === "console") {
    return [
      new winston.transports.Console({
        stderrLevels: ["error", "warn", "info", "debug"],
      }),
    ];
  }
  const file = process.env.OPENTRACE_LOG_FILE ?? join(getTraceDir(), "plugin.log");
  return [
    new winston.transports.File({
      filename: file,
      maxsize: 5 * 1024 * 1024,
      maxFiles: 2,
    }),
  ];
}

const mode = resolveMode();

export const logger = winston.createLogger({
  level: process.env.OPENTRACE_LOG_LEVEL || "info",
  format: logFormat,
  transports: resolveTransports(mode),
});

export const __testing = { resolveMode, resolveTransports };
