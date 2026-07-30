"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useScan, LocalOCRItem } from "@/hooks/useScan";
import { DishCard } from "@/components/dishes/DishCard";

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
    <main style={{ maxWidth: 600, margin: "0 auto", padding: "2rem" }}>
      <h1 style={{ marginBottom: "1rem" }}>Scan a Menu</h1>

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
        <div style={{ marginBottom: "1rem" }}>
          <img src={preview!} alt="Menu preview" style={{ maxWidth: "100%", maxHeight: 300, borderRadius: 8, marginBottom: "1rem" }} />
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button
              onClick={handleScan}
              style={{
                flex: 1,
                padding: "0.75rem",
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: "1rem",
                cursor: "pointer",
              }}
            >
              Scan with AI
            </button>
            <button
              onClick={handleLocalScan}
              style={{
                flex: 1,
                padding: "0.75rem",
                background: "#1f2937",
                color: "#e0e0e0",
                border: "1px solid #444",
                borderRadius: 8,
                fontSize: "1rem",
                cursor: "pointer",
              }}
            >
              Scan Offline
            </button>
          </div>
          <button
            onClick={handleScanAnother}
            style={{
              marginTop: "0.75rem",
              width: "100%",
              padding: "0.5rem",
              background: "transparent",
              color: "#666",
              border: "none",
              borderRadius: 8,
              fontSize: "0.9rem",
              cursor: "pointer",
            }}
          >
            Choose different image
          </button>
        </div>
      )}

      {(isScanning || status === "complete") && (
        <div style={{ marginBottom: "1rem" }}>
          <div style={{ height: 8, background: "#222", borderRadius: 4, overflow: "hidden", marginBottom: "0.5rem" }}>
            <div style={{ height: "100%", width: `${progress}%`, background: "#2563eb", transition: "width 0.3s" }} />
          </div>
          <p style={{ color: "#999", fontSize: "0.9rem" }}>
            {status === "local_scanning" ? "Running local OCR (this may take a minute)..." : status}
          </p>
        </div>
      )}

      {error && (
        <div style={{ marginBottom: "1rem", padding: "0.75rem", background: "#2d1b1b", border: "1px solid #5c2a2a", borderRadius: 8, color: "#f87171" }}>
          {error}
          {status === "error" && image && (
            <button
              onClick={handleLocalScan}
              style={{ display: "block", marginTop: "0.75rem", padding: "0.5rem 1rem", background: "#1f2937", color: "#e0e0e0", border: "1px solid #444", borderRadius: 6, cursor: "pointer" }}
            >
              Retry with Local OCR
            </button>
          )}
        </div>
      )}

      {status === "complete" && localItems.length > 0 && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div>
              <h2 style={{ margin: 0 }}>{localMenuName}</h2>
              <p style={{ color: "#999", fontSize: "0.9rem", margin: 0 }}>{localItems.length} dishes found (offline)</p>
            </div>
            <button
              onClick={handleScanAnother}
              style={{ padding: "0.5rem 1rem", background: "#333", color: "#e0e0e0", border: "none", borderRadius: 6, cursor: "pointer" }}
            >
              New Scan
            </button>
          </div>

          {/* AI Food Expert Button */}
          {!suggestionsLoading && !showSuggestions && (
            <button
              onClick={getSuggestions}
              style={{
                width: "100%", padding: "0.75rem", marginBottom: "1.5rem",
                background: "linear-gradient(135deg, #059669, #047857)",
                color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem",
                cursor: "pointer", fontWeight: "bold",
              }}
            >
              🤖 Ask AI Food Expert
            </button>
          )}

          {suggestionsLoading && (
            <div style={{ marginBottom: "1.5rem", padding: "1rem", background: "#111", borderRadius: 8, textAlign: "center" }}>
              <div style={{ height: 6, background: "#222", borderRadius: 3, overflow: "hidden", marginBottom: "0.5rem" }}>
                <div style={{ height: "100%", width: "60%", background: "#059669", borderRadius: 3, animation: "pulse 1.5s infinite" }} />
              </div>
              <p style={{ color: "#999", fontSize: "0.9rem" }}>🍽️ AI Food Expert is analyzing your menu...</p>
              <style>{`@keyframes pulse { 50% { opacity: 0.5; } }`}</style>
            </div>
          )}

          {suggestionsError && !suggestionsLoading && (
            <div style={{ marginBottom: "1rem", padding: "0.75rem", background: "#2d1b1b", border: "1px solid #5c2a2a", borderRadius: 8, color: "#f87171" }}>
              {suggestionsError}
            </div>
          )}

          {/* AI Food Expert Suggestions Panel */}
          {showSuggestions && suggestions && (
            <div style={{ marginBottom: "1.5rem", background: "linear-gradient(135deg, #064e3b, #065f46)", borderRadius: 12, padding: "1.25rem", border: "1px solid #059669" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                <h2 style={{ margin: 0, fontSize: "1.2rem" }}>🤖 AI Food Expert</h2>
                <button onClick={() => setShowSuggestions(false)} style={{ background: "transparent", color: "#999", border: "none", cursor: "pointer", fontSize: "0.9rem" }}>Hide</button>
              </div>

              {suggestions.overview && (
                <p style={{ color: "#d1fae5", fontSize: "0.95rem", marginBottom: "1rem", lineHeight: 1.5 }}>{suggestions.overview}</p>
              )}

              {suggestions.must_try && (
                <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: 8, padding: "0.75rem", marginBottom: "1rem" }}>
                  <span style={{ color: "#fcd34d", fontWeight: "bold", fontSize: "0.85rem", display: "block", marginBottom: "0.25rem" }}>⭐ MUST TRY</span>
                  <span style={{ color: "#fff", fontSize: "1.1rem", fontWeight: "bold" }}>{suggestions.must_try}</span>
                </div>
              )}

              {suggestions.top_picks && suggestions.top_picks.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  <p style={{ color: "#a7f3d0", fontWeight: "bold", marginBottom: "0.5rem", fontSize: "0.9rem" }}>🏆 TOP PICKS</p>
                  {suggestions.top_picks.map((pick: any, i: number) => (
                    <div key={i} style={{ background: "rgba(255,255,255,0.05)", borderRadius: 6, padding: "0.6rem", marginBottom: "0.4rem" }}>
                      <p style={{ color: "#fff", fontWeight: "bold", marginBottom: "0.2rem" }}>{pick.name}</p>
                      <p style={{ color: "#d1fae5", fontSize: "0.85rem", marginBottom: pick.pairing ? "0.15rem" : 0 }}>{pick.reason}</p>
                      {pick.pairing && <p style={{ color: "#fcd34d", fontSize: "0.8rem" }}>🍷 {pick.pairing}</p>}
                    </div>
                  ))}
                </div>
              )}

              {suggestions.tips && suggestions.tips.length > 0 && (
                <div>
                  <p style={{ color: "#a7f3d0", fontWeight: "bold", marginBottom: "0.5rem", fontSize: "0.9rem" }}>💡 TIPS</p>
                  {suggestions.tips.map((tip: string, i: number) => (
                    <p key={i} style={{ color: "#d1fae5", fontSize: "0.85rem", marginBottom: "0.3rem", paddingLeft: "1rem" }}>• {tip}</p>
                  ))}
                </div>
              )}

              <button
                onClick={getSuggestions}
                style={{ marginTop: "0.75rem", width: "100%", padding: "0.5rem", background: "rgba(255,255,255,0.1)", color: "#d1fae5", border: "1px solid #059669", borderRadius: 6, cursor: "pointer", fontSize: "0.85rem" }}
              >
                🔄 Regenerate Suggestions
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

      {showImages && (
        <div
          onClick={() => setShowImages(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 50,
            display: "flex", justifyContent: "center", alignItems: "center", padding: "2rem",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#111", borderRadius: 12, padding: "1.5rem", maxWidth: 600, width: "100%", maxHeight: "80vh", overflowY: "auto" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ margin: 0 }}>{item.name}</h2>
              <button onClick={() => setShowImages(false)} style={{ background: "#333", color: "#fff", border: "none", padding: "0.4rem 0.9rem", borderRadius: 6, cursor: "pointer" }}>Close</button>
            </div>

            {loadingImages && <p style={{ color: "#666" }}>Loading photos...</p>}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.75rem" }}>
              {moreImages.map((img) => (
                <img key={img.url} src={img.url} alt={item.name} style={{ width: "100%", borderRadius: 8 }} />
              ))}
            </div>

            {!loadingImages && moreImages.length === 0 && (
              <p style={{ color: "#666" }}>No photos found for this dish.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
