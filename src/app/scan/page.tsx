"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useScan, LocalOCRItem } from "@/hooks/useScan";
import { DishCard } from "@/components/dishes/DishCard";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

export default function ScanPage() {
  const router = useRouter();
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    progress,
    status,
    resultId,
    error,
    localItems,
    localMenuName,
    startScan,
    startLocalScan,
    reset,
  } = useScan();

  // AI Food Expert state
  const [suggestions, setSuggestions] = useState<any>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  useEffect(() => {
    if (resultId && status === "complete" && localItems.length === 0) {
      router.push(`/results/${resultId}`);
    }
  }, [resultId, status, localItems.length, router]);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, []);

  const getSuggestions = async () => {
    if (localItems.length === 0) return;
    setSuggestionsLoading(true);
    setSuggestionsError(null);
    setSuggestions(null);
    try {
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dishes: localItems.map((i) => i.name) }),
      });
      const data = await res.json();
      if (data.error) {
        setSuggestionsError(data.error);
      } else if (data.suggestions) {
        setSuggestions(data.suggestions);
        setShowSuggestions(true);
      } else {
        setSuggestionsError("Could not parse suggestions");
      }
    } catch (err: any) {
      setSuggestionsError(err.message || "Failed to get suggestions");
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    if (preview) URL.revokeObjectURL(preview);
    setImage(file);
    setPreview(URL.createObjectURL(file));
    reset();
  }, [reset, preview]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleScan = async () => {
    if (!image) return;
    await startScan(image);
  };

  const handleLocalScan = async () => {
    if (!image) return;
    await startLocalScan(image);
  };

  const handleScanAnother = () => {
    if (preview) URL.revokeObjectURL(preview);
    setImage(null);
    setPreview(null);
    reset();
  };

  const isScanning = status === "uploading" || status === "scanning" || status === "local_scanning";

  return (
    <main className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Scan a Menu</h1>

      {!image && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: "2px dashed #444",
            borderRadius: 12,
            padding: "3rem 2rem",
            textAlign: "center",
            cursor: "pointer",
            marginBottom: "1rem",
            background: preview ? "transparent" : "#111",
          }}
        >
          {preview ? (
            <img src={preview} alt="Menu preview" style={{ maxWidth: "100%", maxHeight: 300, borderRadius: 8 }} />
          ) : (
            <p style={{ color: "#666" }}>Drop a menu image here, or click to select</p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </div>
      )}

      {image && !isScanning && status !== "complete" && (
        <div className="mb-4">
          <img src={preview!} alt="Menu preview" className="w-full max-h-[300px] rounded-lg mb-4 object-contain" />
          <div className="flex gap-3">
            <Button onClick={handleScan} className="flex-1">
              Scan with AI
            </Button>
            <Button onClick={handleLocalScan} variant="outline" className="flex-1">
              Scan Offline
            </Button>
          </div>
          <Button
            onClick={handleScanAnother}
            variant="ghost"
            className="w-full mt-3 text-muted"
          >
            Choose different image
          </Button>
        </div>
      )}

      {(isScanning || status === "complete") && (
        <div className="mb-4">
          <Progress value={progress} className="h-2 mb-2" />
          <p className="text-sm text-muted">
            {status === "local_scanning" ? "Running local OCR (this may take a minute)..." : status}
          </p>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-950 border border-red-800 text-red-400 text-sm">
          {error}
          {status === "error" && image && (
            <button
              onClick={handleLocalScan}
              className="block mt-3 px-4 py-2 rounded-lg bg-surface text-sm text-muted border border-border cursor-pointer"
            >
              Retry with Local OCR
            </button>
          )}
        </div>
      )}

      {status === "complete" && localItems.length > 0 && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-xl font-semibold">{localMenuName}</h2>
              <p className="text-sm text-muted">{localItems.length} dishes found (offline)</p>
            </div>
            <Button onClick={handleScanAnother} variant="outline" size="sm">
              New Scan
            </Button>
          </div>

          {/* AI Food Expert Button */}
          {!suggestionsLoading && !showSuggestions && (
            <Button
              onClick={getSuggestions}
              className="w-full mb-6 font-bold"
              style={{ background: "linear-gradient(135deg, #059669, #047857)" }}
            >
              Ask AI Food Expert
            </Button>
          )}

          {suggestionsLoading && (
            <div className="mb-6 p-4 bg-surface rounded-lg text-center">
              <Progress value={60} className="h-1.5 mb-2" />
              <p className="text-sm text-muted">AI Food Expert is analyzing your menu...</p>
            </div>
          )}

          {suggestionsError && !suggestionsLoading && (
            <div className="mb-4 p-3 rounded-lg bg-red-950 border border-red-800 text-red-400 text-sm">
              {suggestionsError}
            </div>
          )}

          {/* AI Food Expert Suggestions Panel */}
          {showSuggestions && suggestions && (
            <div className="mb-6 rounded-xl p-5 border border-primary" style={{ background: "linear-gradient(135deg, #064e3b, #065f46)" }}>
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-lg font-semibold text-white">AI Food Expert</h2>
                <button onClick={() => setShowSuggestions(false)} className="text-sm text-muted bg-transparent border-none cursor-pointer">Hide</button>
              </div>

              {suggestions.overview && (
                <p style={{ color: "#d1fae5", fontSize: "0.95rem", marginBottom: "1rem", lineHeight: 1.5 }}>{suggestions.overview}</p>
              )}

              {suggestions.must_try && (
                <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: 8, padding: "0.75rem", marginBottom: "1rem" }}>
                  <span style={{ color: "#fcd34d", fontWeight: "bold", fontSize: "0.85rem", display: "block", marginBottom: "0.25rem" }}>MUST TRY</span>
                  <span style={{ color: "#fff", fontSize: "1.1rem", fontWeight: "bold" }}>{suggestions.must_try}</span>
                </div>
              )}

              {suggestions.top_picks && suggestions.top_picks.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  <p style={{ color: "#a7f3d0", fontWeight: "bold", marginBottom: "0.5rem", fontSize: "0.9rem" }}>TOP PICKS</p>
                  {suggestions.top_picks.map((pick: any, i: number) => (
                    <div key={i} style={{ background: "rgba(255,255,255,0.05)", borderRadius: 6, padding: "0.6rem", marginBottom: "0.4rem" }}>
                      <p style={{ color: "#fff", fontWeight: "bold", marginBottom: "0.2rem" }}>{pick.name}</p>
                      <p style={{ color: "#d1fae5", fontSize: "0.85rem", marginBottom: pick.pairing ? "0.15rem" : 0 }}>{pick.reason}</p>
                      {pick.pairing && <p style={{ color: "#fcd34d", fontSize: "0.8rem" }}>{pick.pairing}</p>}
                    </div>
                  ))}
                </div>
              )}

              {suggestions.tips && suggestions.tips.length > 0 && (
                <div>
                  <p style={{ color: "#a7f3d0", fontWeight: "bold", marginBottom: "0.5rem", fontSize: "0.9rem" }}>TIPS</p>
                  {suggestions.tips.map((tip: string, i: number) => (
                    <p key={i} style={{ color: "#d1fae5", fontSize: "0.85rem", marginBottom: "0.3rem", paddingLeft: "1rem" }}>• {tip}</p>
                  ))}
                </div>
              )}

              <button
                onClick={getSuggestions}
                style={{ marginTop: "0.75rem", width: "100%", padding: "0.5rem", background: "rgba(255,255,255,0.1)", color: "#d1fae5", border: "1px solid #059669", borderRadius: 6, cursor: "pointer", fontSize: "0.85rem" }}
              >
                Regenerate Suggestions
              </button>
            </div>
          )}

          <div style={{ display: "grid", gap: "1rem" }}>
            {localItems.map((item) => (
              <LocalDishItem key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

function LocalDishItem({ item }: { item: LocalOCRItem }) {
  const [moreImages, setMoreImages] = useState<{ url: string; source: string }[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [showImages, setShowImages] = useState(false);

  const loadImages = async () => {
    setShowImages(true);
    setMoreImages([]);
    setLoadingImages(true);
    try {
      const res = await fetch(`/api/images/${encodeURIComponent(item.name)}`);
      const data = await res.json();
      setMoreImages(data.images || []);
    } catch {
      setMoreImages([]);
    } finally {
      setLoadingImages(false);
    }
  };

  return (
    <>
      <div
        onClick={() => loadImages()}
        style={{ cursor: "pointer" }}
      >
        <DishCard
          id={item.id}
          name={item.name}
          description={item.description}
          price={item.price}
          category={item.category}
          image_url={item.image_url}
          confidence={item.confidence}
        />
        <p style={{ color: "#555", fontSize: "0.8rem", marginTop: "0.4rem" }}>Tap to see more photos</p>
      </div>

      <Dialog open={showImages} onOpenChange={(open) => { if (!open) setShowImages(false); }}>
        <DialogContent
          className="sm:max-w-2xl max-h-[80vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <DialogTitle className="text-lg font-semibold mb-2">{item.name}</DialogTitle>

          {loadingImages && <p className="text-sm text-muted">Loading photos...</p>}

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {moreImages.map((img) => (
              <img key={img.url} src={img.url} alt={item.name} className="w-full rounded-lg" />
            ))}
          </div>

          {!loadingImages && moreImages.length === 0 && (
            <p className="text-sm text-muted">No photos found for this dish.</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
