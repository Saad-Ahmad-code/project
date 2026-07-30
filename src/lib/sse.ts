import { createParser } from "eventsource-parser";
import type { EventSourceMessage } from "eventsource-parser";

export interface ScanEvent {
  type: "progress" | "result" | "error" | "complete";
  data: Record<string, unknown>;
}

export async function subscribeToScan(
  url: string,
  onEvent: (event: ScanEvent) => void
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    onEvent({ type: "error", data: { message: `HTTP ${response.status}` } });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  const parser = createParser({
    onEvent: (event: EventSourceMessage) => {
      try {
        const parsed = JSON.parse(event.data);
        onEvent(parsed as ScanEvent);
      } catch {
        // ignore malformed events
      }
    },
  });

  const pump = async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      parser.feed(chunk);
    }
  };

  pump().catch(() => {});
}
