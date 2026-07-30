"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
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
  // Translation state
  const [targetLang, setTargetLang] = useState("english");
  const [translating, setTranslating] = useState(false);
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [showTranslated, setShowTranslated] = useState(false);

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

  const translateMenu = async () => {
    if (localItems.length === 0 || targetLang === "english") return;
    setTranslating(true);
    setTranslatedText(null);
    try {
      const menuText = localItems.map((item) => `${item.name} - $${item.price?.toFixed(2) || 'N/A'}${item.description ? `: ${item.description}` : ''}`).join('\n');
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: menuText, target_language: targetLang }),
      });
      const data = await res.json();
      if (data.translation?.translated_text) {
        setTranslatedText(data.translation.translated_text);
        setShowTranslated(true);
      }
    } catch {
      // silently fail — translation is a bonus feature
    } finally {
      setTranslating(false);
    }
  };

  const isScanning = status === "uploading" || status === "scanning" || status === "local_scanning";

  return (
    <main className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Scan a Menu</h1>

      {!image && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-border rounded-xl p-12 text-center mb-4 cursor-pointer bg-surface"
        >
          <p className="text-muted">Drop a menu image here, or click to select</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </motion.div>
      )}

      {image && !isScanning && status !== "complete" && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mb-4"
        >
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
        </motion.div>
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
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2 }}
          className="mb-4 p-3 rounded-lg bg-red-950 border border-red-800 text-red-400 text-sm"
        >
          {error}
          {status === "error" && image && (
            <button
              onClick={handleLocalScan}
              className="block mt-3 px-4 py-2 rounded-lg bg-surface text-sm text-muted border border-border cursor-pointer"
            >
              Retry with Local OCR
            </button>
          )}
        </motion.div>
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
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mb-6 p-4 bg-surface rounded-lg text-center"
            >
              <Progress value={60} className="h-1.5 mb-2" />
              <p className="text-sm text-muted">AI Food Expert is analyzing your menu...</p>
            </motion.div>
          )}

          {suggestionsError && !suggestionsLoading && (
            <div className="mb-4 p-3 rounded-lg bg-red-950 border border-red-800 text-red-400 text-sm">
              {suggestionsError}
            </div>
          )}

          {/* AI Food Expert Suggestions Panel */}
          <AnimatePresence>
            {showSuggestions && suggestions && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="mb-6 rounded-xl p-5 border border-primary overflow-hidden"
                style={{ background: "linear-gradient(135deg, #064e3b, #065f46)" }}
              >
                <div className="flex justify-between items-center mb-3">
                  <h2 className="text-lg font-semibold text-white">AI Food Expert</h2>
                  <button onClick={() => setShowSuggestions(false)} className="text-sm text-muted bg-transparent border-none cursor-pointer">Hide</button>
                </div>

                {suggestions.overview && (
                  <p className="text-emerald-100 text-sm mb-4 leading-relaxed">{suggestions.overview}</p>
                )}

                {suggestions.must_try && (
                  <div className="bg-white/10 rounded-lg p-3 mb-4">
                    <span className="text-amber-300 font-bold text-xs block mb-1">MUST TRY</span>
                    <span className="text-white text-lg font-bold">{suggestions.must_try}</span>
                  </div>
                )}

                {suggestions.top_picks && suggestions.top_picks.length > 0 && (
                  <div className="mb-4">
                    <p className="text-emerald-200 font-bold mb-2 text-sm">TOP PICKS</p>
                    {suggestions.top_picks.map((pick: any, i: number) => (
                      <div key={i} className="bg-white/5 rounded-md p-3 mb-1.5">
                        <p className="text-white font-bold text-sm mb-0.5">{pick.name}</p>
                        <p className="text-emerald-100 text-xs mb-0.5">{pick.reason}</p>
                        {pick.pairing && <p className="text-amber-300 text-xs">{pick.pairing}</p>}
                        {pick.allergens && pick.allergens.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {pick.allergens.map((a: string) => (
                              <span key={a} className="text-[0.65rem] px-1.5 py-0.5 rounded-full bg-red-900/50 text-red-300 border border-red-800">
                                {a}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {suggestions.tips && suggestions.tips.length > 0 && (
                  <div>
                    <p className="text-emerald-200 font-bold mb-2 text-sm">TIPS</p>
                    {suggestions.tips.map((tip: string, i: number) => (
                      <p key={i} className="text-emerald-100 text-xs mb-1 pl-4">&bull; {tip}</p>
                    ))}
                  </div>
                )}

                <button
                  onClick={getSuggestions}
                  className="mt-3 w-full py-2 rounded-md bg-white/10 text-emerald-100 border border-primary text-xs cursor-pointer"
                >
                  Regenerate Suggestions
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Translation */}
          <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-surface border border-border">
            <select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              className="flex-1 bg-transparent border border-border rounded-md px-2 py-1.5 text-sm text-muted cursor-pointer"
            >
              <option value="english">English</option>
              <option value="urdu">Urdu</option>
              <option value="arabic">Arabic</option>
              <option value="chinese">Chinese</option>
              <option value="french">French</option>
              <option value="spanish">Spanish</option>
              <option value="german">German</option>
              <option value="japanese">Japanese</option>
            </select>
            <Button
              onClick={translateMenu}
              disabled={translating || targetLang === "english"}
              variant="outline"
              size="sm"
            >
              {translating ? "Translating..." : showTranslated ? "Translate" : "Translate"}
            </Button>
            {showTranslated && translatedText && (
              <button
                onClick={() => setShowTranslated(false)}
                className="text-xs text-muted bg-transparent border-none cursor-pointer whitespace-nowrap"
              >
                Hide
              </button>
            )}
          </div>

          {showTranslated && translatedText && (
            <div className="mb-4 p-3 rounded-lg bg-surface border border-border text-sm text-muted whitespace-pre-line">
              {translatedText}
            </div>
          )}

          {/* Dish Grid */}
          <div className="grid gap-4">
            {localItems.map((item, index) => (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: index * 0.05 }}
              >
                <LocalDishItem item={item} />
              </motion.div>
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
      <motion.div
        onClick={() => loadImages()}
        className="cursor-pointer"
        whileHover={{ scale: 1.01 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
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
        <p className="text-xs text-muted mt-1.5">Tap to see more photos</p>
      </motion.div>

      <Dialog open={showImages} onOpenChange={(open) => { if (!open) setShowImages(false); }}>
        <DialogContent
          className="sm:max-w-2xl max-h-[80vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {showImages && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
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
            </motion.div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
