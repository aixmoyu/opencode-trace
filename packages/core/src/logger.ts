import winston from "winston";

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
  })
);

export const logger = winston.createLogger({
  level: process.env.OPENTRACE_LOG_LEVEL || "info",
  format: logFormat,
  transports: [
    new winston.transports.Console({
      stderrLevels: ["error", "warn", "info", "debug"],
    }),
  ],
});
