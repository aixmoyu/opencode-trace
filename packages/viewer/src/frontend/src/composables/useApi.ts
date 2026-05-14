const API_BASE = "/api";

export async function api<T = any>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}/${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function apiPost<T = any>(path: string, body?: BodyInit): Promise<T> {
  const res = await fetch(`${API_BASE}/${path}`, {
    method: "POST",
    body,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function apiDelete<T = any>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}/${path}`, { method: "POST" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
