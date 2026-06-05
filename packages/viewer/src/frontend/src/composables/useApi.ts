const API_BASE = "/api";

declare global {
  interface Window {
    __TRACE_API_KEY__?: string;
  }
}

function apiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (window.__TRACE_API_KEY__) {
    headers["X-API-Key"] = window.__TRACE_API_KEY__;
  }
  return headers;
}

export async function api<T = any>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}/${path}`, { headers: apiHeaders() });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function apiPost<T = any>(
  path: string,
  body?: BodyInit | Record<string, unknown>,
): Promise<T> {
  const headers = apiHeaders();
  let bodyInit: BodyInit | undefined;

  if (body !== undefined) {
    if (
      typeof body === "string" ||
      body instanceof FormData ||
      body instanceof Blob
    ) {
      bodyInit = body;
    } else {
      headers["Content-Type"] = "application/json";
      bodyInit = JSON.stringify(body);
    }
  }

  const res = await fetch(`${API_BASE}/${path}`, {
    method: "POST",
    headers,
    body: bodyInit,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function apiDelete<T = any>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}/${path}`, {
    method: "POST",
    headers: apiHeaders(),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
