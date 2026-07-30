"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  onClose: () => void;
}

export function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let mounted = true;

    const start = async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (!mounted || !containerRef.current) return;

        const scanner = new Html5Qrcode("barcode-scanner-container");
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 150 } },
          (decodedText: string) => {
            // Valid barcode detected
            scanner.stop().catch(() => {});
            if (mounted) {
              setScanning(false);
              onScan(decodedText);
            }
          },
          () => {} // ignore individual frame errors
        );

        if (mounted) setScanning(true);
      } catch (err: any) {
        if (mounted) {
          setError(err?.message || "Camera access denied. Ensure camera permissions are granted.");
        }
      }
    };

    start();

    return () => {
      mounted = false;
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, [onScan]);

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-medium">Barcode Scanner</span>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="p-4">
        <div
          id="barcode-scanner-container"
          ref={containerRef}
          className="w-full aspect-video bg-black rounded-lg overflow-hidden"
        />

        {scanning && (
          <p className="text-xs text-muted mt-2 text-center">
            Point camera at a barcode
          </p>
        )}

        {error && (
          <div className="mt-3 p-3 rounded-lg bg-red-950 border border-red-800">
            <p className="text-sm text-red-400">{error}</p>
            <p className="text-xs text-muted mt-1">
              Try using a USB camera or type the barcode number manually.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
