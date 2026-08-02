import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";

export interface LocalOCRItem {
  id: string;
  name: string;
  description?: string;
  price?: number;
  category?: string;
  image_url: string;
  confidence: number;
}

async function processSSEStream(
  res: Response,
  onError: (message: string) => void,
  onStatus: (data: any) => void,
  onComplete: (data: any) => void,
  timeoutMs?: number
) {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response stream");

  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  const decoder = new TextDecoder();
  const { createParser } = await import("eventsource-parser");
  const parser = createParser({
    onEvent: (event) => {
      try {
        const eventType = event.event;
        const data = JSON.parse(event.data || "{}");

        if (eventType === "status") {
          onStatus(data);
        } else if (eventType === "complete") {
          onComplete(data);
        } else if (eventType === "error") {
          onError(typeof data?.message === "string" ? data.message : "Scan failed");
        }
      } catch {
        // ignore malformed events
      }
    },
  });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function useScan() {
  const router = useRouter();
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<"idle" | "uploading" | "scanning" | "complete" | "error" | "local_scanning">("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localItems, setLocalItems] = useState<LocalOCRItem[]>([]);
  const [localMenuName, setLocalMenuName] = useState<string>("");

  const handleStatus = useCallback((data: any) => {
    setProgress(Number(data?.progress ?? 0));
    if (typeof data?.message === "string") {
      setStatusMessage(data.message);
    }
  }, []);

  const handleComplete = useCallback((data: any, menuName?: string) => {
    const id = data?.scan_id ?? data?.scan?.id ?? data?.id ?? null;
    const items = data?.items ?? [];
    setResultId(id);
    setLocalItems(items);
    setLocalMenuName(menuName ?? data?.menu_name ?? "");
    setStatus("complete");
    setStatusMessage(null);
  }, []);

  const handleError = useCallback((message: string) => {
    setError(message);
    setStatus("error");
    setStatusMessage(null);
  }, []);

  const startScan = useCallback(async (file: File) => {
    setStatus("uploading");
    setProgress(0);
    setError(null);
    setResultId(null);
    setLocalItems([]);
    setStatusMessage(null);

    const form = new FormData();
    form.append("image", file);

    try {
      const res = await fetch("/api/scan/new", { method: "POST", body: form });
      if (!res.ok) {
        const text = await res.text();
        const sseMatch = text.match(/data:\s*(\{[\s\S]*?\})/);
        if (sseMatch) {
          try {
            const parsed = JSON.parse(sseMatch[1]);
            throw new Error(parsed.message || `HTTP ${res.status}`);
          } catch (e) {
            if (e instanceof Error) throw e;
          }
        }
        throw new Error(`HTTP ${res.status}`);
      }

      setStatus("scanning");
      await processSSEStream(res, handleError, handleStatus, handleComplete, 120000);
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      setError(aborted ? "Scan timed out. Try again or use a smaller image." : err instanceof Error ? err.message : "Scan failed");
      setStatus("error");
      setStatusMessage(null);
    }
  }, [handleStatus, handleComplete, handleError]);

  const startLocalScan = useCallback(async (file: File) => {
    setStatus("local_scanning");
    setProgress(10);
    setError(null);
    setResultId(null);
    setLocalItems([]);
    setStatusMessage(null);

    try {
      setProgress(30);
      const form = new FormData();
      form.append("image", file);

      const res = await fetch("/api/scan/new?mode=offline", { method: "POST", body: form });
      if (!res.ok) {
        const text = await res.text();
        const sseMatch = text.match(/data:\s*(\{[\s\S]*?\})/);
        if (sseMatch) {
          try {
            const parsed = JSON.parse(sseMatch[1]);
            throw new Error(parsed.message || `HTTP ${res.status}`);
          } catch (e) {
            if (e instanceof Error) throw e;
          }
        }
        throw new Error(`HTTP ${res.status}`);
      }

      setProgress(50);
      setStatus("scanning");
      await processSSEStream(res, handleError, handleStatus, (data) => {
        handleComplete(data, data?.menu_name || "Local Scan Result");
      }, 120000);
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      setError(aborted ? "Scan timed out. Try again or use a smaller image." : err instanceof Error ? err.message : "Local OCR failed");
      setStatus("error");
      setStatusMessage(null);
    }
  }, [handleStatus, handleComplete, handleError]);

  const reset = useCallback(() => {
    setStatus("idle");
    setProgress(0);
    setResultId(null);
    setError(null);
    setLocalItems([]);
    setLocalMenuName("");
    setStatusMessage(null);
  }, []);

  return {
    progress,
    status,
    statusMessage,
    resultId,
    error,
    localItems,
    localMenuName,
    startScan,
    startLocalScan,
    reset,
  };
}