const SENSITIVE_HEADERS = [
  "authorization",
  "api-key",
  "x-api-key",
  "apikey",
  "x-apikey",
  "token",
  "x-token",
  "access-token",
  "x-access-token",
  "secret",
  "x-secret",
  "cookie",
];

function isSensitiveHeader(key: string): boolean {
  return SENSITIVE_HEADERS.includes(key.toLowerCase());
}

export function redactHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const disabled = process.env.OPENCODE_TRACE_REDACT === "false";
  if (disabled) {
    return headers;
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (isSensitiveHeader(key)) {
      const lowerValue = value.toLowerCase();
      if (lowerValue.startsWith("bearer ")) {
        result[key] = "Bearer [REDACTED]";
      } else {
        result[key] = "[REDACTED]";
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}