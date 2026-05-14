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

export interface TraceError {
  message: string;
  stack?: string;
}

export interface TraceRecord {
  id: number;
  purpose: string;
  requestAt: string;
  responseAt: string;
  request: TraceRequest;
  response: TraceResponse | null;
  error: TraceError | null;
  requestSentAt?: number;
  firstTokenAt?: number;
  lastTokenAt?: number;
}
