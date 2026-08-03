"use client";

/**
 * CameraCapture — mobile-friendly camera viewfinder that captures a photo
 * as a File, compatible with the existing useScan hook (startScan / startLocalScan).
 *
 * Only the environment-facing camera is requested (facingMode: "environment")
 * since that's what users point at a menu. Shows a permission error when the
 * camera can't be accessed. The "Capture" button is centered at the bottom
 * for thumb-friendly operation on mobile.
 *
 * Handles cross-browser compatibility:
 * - Modern browsers: navigator.mediaDevices.getUserMedia
 * - WebKit/Safari (older): navigator.webkitGetUserMedia (callback-based)
 * - Firefox (older): navigator.mozGetUserMedia (callback-based)
 *
 * If no JS camera API is available, falls back to the native <input capture>
 * which on mobile opens the camera app directly.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";

interface CameraCaptureProps {
  onCapture: (file: File) => void;
  onClose: () => void;
}

export function CameraCapture({ onCapture, onClose }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [useNativeInput, setUseNativeInput] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        let stream: MediaStream | null = null;

        // Try standard API first
        const mediaDevices = navigator.mediaDevices;
        if (mediaDevices && typeof mediaDevices.getUserMedia === "function") {
          try {
            stream = await mediaDevices.getUserMedia({
              video: { facingMode: { ideal: "environment" } },
            });
          } catch (e: any) {
            // If it throws for facingMode constraints, try without
            if (e?.name === "OverconstrainedError" || e?.name === "ConstraintError") {
              stream = await mediaDevices.getUserMedia({ video: true });
            } else {
              throw e;
            }
          }
        } else {
          // Fallback for older browsers with vendor-prefixed APIs
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const nav = navigator as any;
          const wGet = nav.webkitGetUserMedia;
          const mGet = nav.mozGetUserMedia;

          if (wGet || mGet) {
            const constraints = { video: { facingMode: { ideal: "environment" } } };
            stream = await new Promise<MediaStream>((resolve, reject) => {
              const cb = (s: MediaStream) => resolve(s);
              const eb = (e: any) => reject(e);
              if (wGet) {
                wGet.call(nav, constraints, cb, eb);
              } else if (mGet) {
                mGet.call(nav, constraints, cb, eb);
              } else {
                reject(new Error("Unknown getUserMedia API"));
              }
            });
          }
        }

        if (!stream) {
          // No JS camera API available — fall back to native <input capture>
          if (!cancelled) setUseNativeInput(true);
          return;
        }

        streamRef.current = stream;
        if (!cancelled && videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => setReady(true);
        }
      } catch (err: any) {
        if (!cancelled) {
          const name = err?.name || "";
          if (name === "NotAllowedError") {
            setError("Camera permission denied. Please allow camera access in your browser settings.");
          } else if (name === "NotFoundError") {
            setError("No camera found. Please ensure a camera is connected and available.");
          } else {
            setError(err?.message || "Could not access camera. Ensure the page has camera permission.");
          }
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          const file = new File([blob], `menu-${Date.now()}.jpg`, {
            type: "image/jpeg",
          });
          onCapture(file);
        }
      },
      "image/jpeg",
      0.9
    );
  }, [onCapture]);

  // Auto-trigger native file input when fallback is shown
  useEffect(() => {
    if (useNativeInput && inputRef.current) {
      // Small delay to ensure the DOM is painted before opening the picker
      const t = setTimeout(() => inputRef.current?.click(), 200);
      return () => clearTimeout(t);
    }
  }, [useNativeInput]);

  // Native input fallback UI
  if (useNativeInput) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center p-4">
        <p className="text-white text-center mb-6">
          Opening your device's camera...
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onCapture(file);
          }}
          className="hidden"
        />
        <Button variant="ghost" size="sm" onClick={onClose} className="text-white">
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Camera viewfinder */}
      <div className="flex-1 relative flex items-center justify-center">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
        />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <svg className="animate-spin h-8 w-8 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
            </svg>
          </div>
        )}

        {/* Viewfinder overlay — dashed box to indicate capture area */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="w-4/5 h-4/5 border-2 border-white/50 rounded-xl" />
        </div>
      </div>

      {/* Capture controls */}
      <div className="p-4 flex items-center justify-center gap-6 bg-black/80 backdrop-blur">
        <Button variant="ghost" size="sm" onClick={onClose} className="text-white">
          Cancel
        </Button>

        {error ? null : (
          <button
            onClick={capture}
            disabled={!ready}
            className="w-16 h-16 rounded-full bg-white border-4 border-white/30 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black"
            aria-label="Capture photo"
          />
        )}

        {error && (
          <Button variant="ghost" size="sm" onClick={() => window.location.reload()} className="text-white text-xs">
            Retry
          </Button>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {error && (
        <div className="p-3 bg-red-900/50 text-center text-sm text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
