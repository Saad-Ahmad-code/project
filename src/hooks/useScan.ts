import { useState, useCallback, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { runLocalOCR } from "@/lib/ocr/local";

export interface LocalOCRItem {
  id: string;
  name: string;
  description?: string;
  price?: number;
  category?: string;
  image_url: string;
  confidence: number;
}

export function useScan() {
  const router = useRouter();
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<"idle" | "uploading" | "scanning" | "complete" | "error" | "local_scanning">("idle");
  const [resultId, setResultId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localItems, setLocalItems] = useState<LocalOCRItem[]>([]);
  const [localMenuName, setLocalMenuName] = useState<string>("");

  const startScan = useCallback(async (file: File) => {
    setStatus("uploading");
    setProgress(0);
    setError(null);
    setResultId(null);
    setLocalItems([]);

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/scan/new", { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || "Upload failed");
      }

      setStatus("scanning");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      const { createParser } = await import("eventsource-parser");
      const parser = createParser({
        onEvent: (event) => {
          try {
            const eventType = event.event;
            const data = JSON.parse(event.data || "{}");

            if (eventType === "status") {
              setProgress(Number(data?.progress ?? 0));
              if (typeof data?.message === "string") setStatus(data.message);
            } else if (eventType === "complete") {
              const id = data?.scan?.id ?? data?.id ?? null;
              setResultId(id);
              setStatus("complete");
            } else if (eventType === "error") {
              setError(typeof data?.message === "string" ? data.message : "Scan failed");
              setStatus("error");
            }
          } catch {
            // ignore malformed events
          }
        },
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
      setStatus("error");
    }
  }, []);

  const startLocalScan = useCallback(async (file: File) => {
    setStatus("local_scanning");
    setProgress(10);
    setError(null);
    setResultId(null);
    setLocalItems([]);

    try {
      setProgress(30);
      const result = await runLocalOCR(file);

      setProgress(70);
      setLocalMenuName("Local Scan Result");
      setLocalItems(
        result.items.map((item, index) => ({
          ...item,
          id: `local-${Date.now()}-${index}`,
          image_url: "",
          confidence: 0.75,
        }))
      );

      setProgress(100);
      setStatus("complete");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Local OCR failed");
      setStatus("error");
    }
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setProgress(0);
    setResultId(null);
    setError(null);
    setLocalItems([]);
    setLocalMenuName("");
  }, []);

  return {
    progress,
    status,
    resultId,
    error,
    localItems,
    localMenuName,
    startScan,
    startLocalScan,
    reset,
  };
}
