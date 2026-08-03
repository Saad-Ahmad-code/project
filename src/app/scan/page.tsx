"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useScan, LocalOCRItem } from "@/hooks/useScan";
import { useCsrf } from "@/hooks/useCsrf";
import { compressImage } from "@/lib/image-compress";
import { DishCard } from "@/components/dishes/DishCard";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { CameraCapture } from "@/components/CameraCapture";
import { SuggestionPanel } from "@/components/SuggestionPanel";

export default function ScanPage() {
  const router = useRouter();
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
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
  } = useScan();
  const csrfToken = useCsrf();

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
  // Barcode Scanner state
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [barcodeResult, setBarcodeResult] = useState<{ name: string; calories?: number; protein_g?: number; fat_g?: number; carbs_g?: number; sugars_g?: number; image_url?: string; nutri_score?: string } | null>(null);
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  // Camera capture state (mobile)
  const [showCamera, setShowCamera] = useState(false);

  useEffect(() => {
    if (resultId && status === "complete") {
      router.push(`/results/${resultId}`);
      toast.success("Menu scanned successfully!");
    }
  }, [resultId, status, router]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  useEffect(() => {
    if (suggestionsError) toast.error(suggestionsError);
  }, [suggestionsError]);

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
        headers: { "Content-Type": "application/json", ...(csrfToken ? { "x-csrf-token": csrfToken } : {}) },
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

  // Compress (if beneficial) then start the scan — keeps uploads small
  // and server-side OCR fast. Original file is kept for the preview.
  const startScanCompressed = useCallback(async (file: File, mode: "ai" | "offline") => {
    const toSend = await compressImage(file);
    if (mode === "ai") await startScan(toSend);
    else await startLocalScan(toSend);
  }, [startScan, startLocalScan]);

  const handleScan = async () => {
    if (!image) return;
    await startScanCompressed(image, "ai");
  };

  const handleLocalScan = async () => {
    if (!image) return;
    await startScanCompressed(image, "offline");
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleScanAnother = () => {
    if (preview) URL.revokeObjectURL(preview);
    setImage(null);
    setPreview(null);
    reset();
    // Clear AI suggestions & translation & barcode state
    setSuggestions(null);
    setSuggestionsLoading(false);
    setSuggestionsError(null);
    setShowSuggestions(false);
    setTranslatedText(null);
    setShowTranslated(false);
    setBarcodeResult(null);
    setBarcodeError(null);
    setShowBarcodeScanner(false);
    setShowCamera(false);
  };

  const translateMenu = async () => {
    if (localItems.length === 0 || targetLang === "english") return;
    setTranslating(true);
    setTranslatedText(null);
    try {
      const menuText = localItems.map((item) => `${item.name} - $${item.price?.toFixed(2) || 'N/A'}${item.description ? `: ${item.description}` : ''}`).join('\n');
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(csrfToken ? { "x-csrf-token": csrfToken } : {}) },
        body: JSON.stringify({ text: menuText, target_language: targetLang }),
      });
      const data = await res.json();
      if (data.translation?.translated_text) {
        setTranslatedText(data.translation.translated_text);
        setShowTranslated(true);
      }
    } catch {
      toast.error("Translation failed");
    } finally {
      setTranslating(false);
    }
  };

  const isScanning = status === "uploading" || status === "scanning" || status === "local_scanning";

  const handleBarcodeDetected = useCallback(async (barcode: string) => {
    setShowBarcodeScanner(false);
    setBarcodeLoading(true);
    setBarcodeError(null);
    setBarcodeResult(null);
    try {
      const res = await fetch("/api/nutrition", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(csrfToken ? { "x-csrf-token": csrfToken } : {}) },
        body: JSON.stringify({ barcode }),
      });
      const data = await res.json();
      if (data.error || !data.results?.length) {
        setBarcodeError(data.error || "Product not found");
      } else {
        setBarcodeResult(data.results[0]);
      }
    } catch {
      setBarcodeError("Failed to look up barcode");
    } finally {
      setBarcodeLoading(false);
    }
  }, []);

  return (
    <main className="max-w-2xl mx-auto p-8 min-h-screen">
      <h1 className="text-2xl font-bold mb-4">Scan a Menu</h1>

      {!image && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-border rounded-xl p-12 text-center mb-4 cursor-pointer bg-surface"
        >
          <p className="text-muted-foreground mb-4">Drop a menu image here, or click to select</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              variant="outline"
              className="sm:w-auto w-full"
            >
              Choose File
            </Button>
            {/* Camera button — visible on mobile (touch devices) only */}
            <Button
              onClick={() => setShowCamera(true)}
              variant="outline"
              className="sm:w-auto w-full mobile-only"
            >
              Use Camera
            </Button>
          </div>
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
            className="w-full mt-3 text-muted-foreground"
          >
            Choose different image
          </Button>
        </motion.div>
      )}

      {(isScanning || status === "complete") && (
        <div className="mb-4">
          <Progress value={progress} className="h-2 mb-2" />
          <p className="text-sm text-muted-foreground">
            {status === "local_scanning"
              ? "Running local OCR (this may take a minute)..."
              : statusMessage || status}
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
              className="block mt-3 px-4 py-2 rounded-lg bg-surface text-sm text-muted-foreground border border-border cursor-pointer"
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
              <p className="text-sm text-muted-foreground">{localItems.length} dishes found (offline)</p>
            </div>
            <Button onClick={handleScanAnother} variant="outline" size="sm">
              New Scan
            </Button>
          </div>

          {/* AI Food Expert */}
          <SuggestionPanel
            suggestions={suggestions}
            loading={suggestionsLoading}
            error={suggestionsError}
            onRegenerate={getSuggestions}
            onHide={() => setShowSuggestions(false)}
          />

          {/* Translation */}
          <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-surface border border-border">
            <select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              className="flex-1 bg-transparent border border-border rounded-md px-2 py-1.5 text-sm text-muted-foreground cursor-pointer"
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
              {translating ? "Translating..." : showTranslated ? "Show Original" : "Translate"}
            </Button>
            {showTranslated && translatedText && (
              <button
                onClick={() => setShowTranslated(false)}
                className="text-xs text-muted-foreground bg-transparent border-none cursor-pointer whitespace-nowrap"
              >
                Hide
              </button>
            )}
          </div>

          {showTranslated && translatedText && (
            <div className="mb-4 p-3 rounded-lg bg-surface border border-border text-sm text-muted-foreground whitespace-pre-line">
              {translatedText}
            </div>
          )}

          {/* Barcode Scanner */}
          <div className="mb-6">
            {!showBarcodeScanner && (
              <Button
                onClick={() => setShowBarcodeScanner(true)}
                variant="outline"
                className="w-full"
              >
                Scan Barcode (Packaged Foods)
              </Button>
            )}

            {showBarcodeScanner && (
              <BarcodeScanner
                onScan={handleBarcodeDetected}
                onClose={() => setShowBarcodeScanner(false)}
              />
            )}

            {barcodeLoading && (
              <div className="mt-3 p-4 bg-surface rounded-lg text-center">
                <Progress value={60} className="h-1.5 mb-2" />
                <p className="text-sm text-muted-foreground">Looking up product...</p>
              </div>
            )}

            {barcodeError && (
              <div className="mt-3 p-3 rounded-lg bg-red-950 border border-red-800">
                <p className="text-sm text-red-400">{barcodeError}</p>
              </div>
            )}

            {barcodeResult && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 p-4 rounded-lg border border-emerald-700 bg-surface"
              >
                <div className="flex items-start gap-4">
                  {barcodeResult.image_url && (
                    <img
                      src={barcodeResult.image_url}
                      alt={barcodeResult.name}
                      className="w-16 h-16 rounded-lg object-cover shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-sm">{barcodeResult.name}</h3>
                      {barcodeResult.nutri_score && (
                        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[0.6rem] font-bold text-white ${
                          barcodeResult.nutri_score === 'A' ? 'bg-green-600' :
                          barcodeResult.nutri_score === 'B' ? 'bg-lime-600' :
                          barcodeResult.nutri_score === 'C' ? 'bg-yellow-500' :
                          barcodeResult.nutri_score === 'D' ? 'bg-orange-500' :
                          'bg-red-600'
                        }`}>
                          {barcodeResult.nutri_score}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {barcodeResult.calories !== undefined && <span>{barcodeResult.calories} kcal</span>}
                      {barcodeResult.protein_g !== undefined && <span>{barcodeResult.protein_g}g protein</span>}
                      {barcodeResult.fat_g !== undefined && <span>{barcodeResult.fat_g}g fat</span>}
                      {barcodeResult.carbs_g !== undefined && <span>{barcodeResult.carbs_g}g carbs</span>}
                      {barcodeResult.sugars_g !== undefined && <span>{barcodeResult.sugars_g}g sugars</span>}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setBarcodeResult(null)}
                  className="mt-2 text-xs text-muted-foreground hover:text-white bg-transparent border-none cursor-pointer"
                >
                  Dismiss
                </button>
              </motion.div>
            )}
          </div>

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
    {showCamera && (
      <CameraCapture
        onCapture={(file) => {
          setShowCamera(false);
          handleFile(file);
        }}
        onClose={() => setShowCamera(false)}
      />
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
        <p className="text-xs text-muted-foreground mt-1.5">Tap to see more photos</p>
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

              {loadingImages && <p className="text-sm text-muted-foreground">Loading photos...</p>}

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {moreImages.map((img) => (
                  <img key={img.url} src={img.url} alt={item.name} className="w-full rounded-lg" />
                ))}
              </div>

              {!loadingImages && moreImages.length === 0 && (
                <p className="text-sm text-muted-foreground">No photos found for this dish.</p>
              )}
            </motion.div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
