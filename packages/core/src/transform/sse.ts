export interface SSEEvent {
  id?: string;
  event?: string;
  data: string;
}

export function parseSSE(raw: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  const lines = raw.split("\n");
  let current: Partial<SSEEvent> = {};

  for (const line of lines) {
    if (line === "") {
      if (current.data !== undefined) {
        events.push({
          id: current.id,
          event: current.event,
          data: current.data,
        });
      }
      current = {};
      continue;
    }

    if (line.startsWith(":")) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      const field = line.trim();
      if (field === "data" && current.data === undefined) {
        current.data = "";
      }
      continue;
    }

    const field = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trimStart();

    switch (field) {
      case "event":
        current.event = value;
        break;
      case "id":
        current.id = value;
        break;
      case "data":
        current.data = (current.data ?? "") + (current.data !== undefined ? "\n" : "") + value;
        break;
    }
  }

  if (current.data !== undefined) {
    events.push({
      id: current.id,
      event: current.event,
      data: current.data,
    });
  }

  return events;
}

export function isSSEData(data: string): boolean {
  return data.startsWith("data:");
}
