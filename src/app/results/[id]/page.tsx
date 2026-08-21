"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { DishCard } from "@/components/dishes/DishCard";
import { RegenerateCard } from "@/components/dishes/RegenerateCard";
import { NutritionPanel } from "@/components/NutritionPanel";
import { RecipePanel } from "@/components/RecipePanel";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ProgressiveImage } from "@/components/ui/progressive-image";
import { useCsrf, fetchWithCsrf } from "@/hooks/useCsrf";
import { useDebounce } from "@/hooks/useDebounce";
import { usePhotoPrefetch } from "@/hooks/usePhotoPrefetch";
import { SuggestionPanel, type FoodExpertSuggestion } from "@/components/SuggestionPanel";
import { DietaryFilter } from "@/components/DietaryFilter";
import type { MenuItem } from "@/types/menu";

/** Shape returned by POST /api/dishes/details (AI food-expert endpoint). */
interface DishDetails {
  detailed_description: string;
  ingredients: string[];
  preparation: string;
  serving_suggestions: string;
  fun_fact: string;
}

export default function ResultsPage() {
  const params = useParams();
  const csrfToken = useCsrf();
  const [scan, setScan] = useState<{ id: string; status: string; items_count: number; agent_summary?: string } | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDish, setSelectedDish] = useState<MenuItem | null>(null);
  const [moreImages, setMoreImages] = useState<{ url: string; source: string }[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  // AI-generated dish details (fetched on click, cached per dish id)
  const [dishDetails, setDishDetails] = useState<DishDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const detailsCache = useRef(new Map<string, DishDetails>());
  const [suggestions, setSuggestions] = useState<FoodExpertSuggestion | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  // Dietary preferences
  const [dietPrefs, setDietPrefs] = useState<string[]>([]);

  useEffect(() => {
    if (!params.id) return;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const fetchScan = async () => {
      try {
        const res = await fetch(`/api/scan/${encodeURIComponent(params.id as string)}`);
        const data = await res.json();
        if (cancelled) return;
        setScan(data.scan);
        setItems(data.items || []);
        // Keep polling while the background enrichment is still running so
        // AI descriptions/images appear as soon as they're written.
        const status = data.scan?.status;
        if ((status === "processing" || status === "queued" || status === "pending") && !pollTimer) {
          pollTimer = setInterval(fetchScan, 4000);
        } else if (status && status !== "processing" && status !== "queued" && status !== "pending" && pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      } catch (err: any) {
        if (cancelled) return;
        setError(err.message);
        toast.error(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchScan();

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [params.id]);

  const openDishImages = async (dish: MenuItem) => {
    setSelectedDish(dish);
    setMoreImages([]);
    setLoadingImages(true);
    loadDishDetails(dish); // fire in parallel with the image fetch
    // Pre-warm the nutrition cache (7d TTL server-side) so the card's
    // Nutrition button is instant when the user clicks it.
    fetchWithCsrf("/api/nutrition", {
      method: "POST",
      body: JSON.stringify({ dish_name: dish.name }),
    }).catch(() => {});
    try {
      const res = await fetch(`/api/images/${encodeURIComponent(dish.name)}`);
      const data = await res.json();
      setMoreImages(data.images || []);
    } catch {
      setMoreImages([]);
      toast.error("Failed to load images");
    } finally {
      setLoadingImages(false);
    }
  };

  /** Generate AI description/ingredients/preparation for a dish (cached per dish id). */
  const loadDishDetails = async (dish: MenuItem) => {
    const cached = detailsCache.current.get(dish.id);
    if (cached) {
      setDishDetails(cached);
      return;
    }
    setLoadingDetails(true);
    setDishDetails(null);
    try {
      const res = await fetchWithCsrf("/api/dishes/details", {
        method: "POST",
        body: JSON.stringify({
          dishName: dish.name,
          id: dish.id,
          category: dish.category,
          origin: dish.origin,
          description: dish.description || dish.ai_description || undefined,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.detailed_description) {
        detailsCache.current.set(dish.id, data as DishDetails);
        setDishDetails(data as DishDetails);
      }
    } catch {
      // Fail soft: fall back to whatever description the dish already has.
      setDishDetails(null);
    } finally {
      setLoadingDetails(false);
    }
  };

  const getSuggestions = async () => {
    setSuggestionsLoading(true);
    setSuggestionsError(null);
    setSuggestions(null);
    try {
      const res = await fetch(`/api/scan/${encodeURIComponent(params.id as string)}`, {
        method: "POST",
        headers: csrfToken ? { "x-csrf-token": csrfToken } : {},
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

  const togglePref = (pref: string) => {
    setDietPrefs((prev) =>
      prev.includes(pref) ? prev.filter((p) => p !== pref) : [...prev, pref]
    );
  };

  /** Regenerate AI descriptions for ALL dishes at once. */
  const regenerateAllDescriptions = async () => {
    let updated = 0;
    for (const item of items) {
      try {
        detailsCache.current.delete(item.id);
        const res = await fetchWithCsrf("/api/dishes/details", {
          method: "POST",
          body: JSON.stringify({
            dishName: item.name,
            id: item.id,
            category: item.category,
            origin: item.origin,
            description: item.description || item.ai_description || undefined,
            regenerate: true,
          }),
        });
        const data = await res.json();
        if (data.detailed_description) {
          detailsCache.current.set(item.id, data as DishDetails);
          setItems((prev) => prev.map((d) =>
            d.id === item.id
              ? { ...d, ai_description: typeof data.detailed_description === "string"
                  ? (data.detailed_description as string).slice(0, 300)
                  : "" }
              : d
          ));
          updated++;
        }
      } catch { /* continue with next dish */ }
    }
    if (updated > 0) {
      toast.success(`Regenerated ${updated} of ${items.length} descriptions`);
    } else {
      toast.error("Failed to regenerate any descriptions");
    }
  };

  // Debounce the active filter set so a rapid burst of pill toggles settles
  // into ONE filteredItems recomputation instead of one per click.
  const debouncedPrefs = useDebounce(dietPrefs, 150);

  // Warm photo galleries for the first dishes as soon as results exist, so
  // tapping a card shows photos instantly instead of a multi-second fan-out.
  const prefetchNames = useMemo(() => items.map((i) => i.name), [items]);
  usePhotoPrefetch(prefetchNames, items.length > 0);

  const filteredItems = useMemo(() => {
    if (debouncedPrefs.length === 0) return items;
    return items.filter((item) => {
      const tags = (item.dietary_tags || []).map((t) => t.toLowerCase());
      const name = item.name.toLowerCase();
      const desc = (item.description || "").toLowerCase();
      const combined = `${name} ${desc} ${tags.join(" ")}`;
      for (const pref of debouncedPrefs) {
        if (pref === "vegetarian" && (combined.includes("meat") || combined.includes("chicken") || combined.includes("beef") || combined.includes("fish") || combined.includes("pork"))) return false;
        if (pref === "vegan" && (combined.includes("dairy") || combined.includes("cheese") || combined.includes("cream") || combined.includes("milk") || combined.includes("egg") || combined.includes("meat") || combined.includes("honey"))) return false;
        if (pref === "gluten-free" && (combined.includes("bread") || combined.includes("pasta") || combined.includes("flour") || combined.includes("wheat") || combined.includes("naan") || combined.includes("bun"))) return false;
        if (pref === "halal" && (combined.includes("pork") || combined.includes("alcohol") || combined.includes("wine"))) return false;
        if (pref === "low-carb" && (combined.includes("rice") || combined.includes("pasta") || combined.includes("bread") || combined.includes("naan") || combined.includes("potato") || combined.includes("sugar"))) return false;
        if (pref === "keto" && (combined.includes("rice") || combined.includes("pasta") || combined.includes("bread") || combined.includes("naan") || combined.includes("sugar") || combined.includes("potato") || combined.includes("sweet"))) return false;
      }
      return true;
    });
  }, [items, debouncedPrefs]);

  if (loading) return (
    <main className="max-w-3xl mx-auto p-8 min-h-screen">
      <div className="flex justify-between mb-4">
        <div className="h-4 w-24 bg-muted rounded animate-pulse" />
        <div className="h-4 w-20 bg-muted rounded animate-pulse" />
      </div>
      <div className="h-8 w-48 bg-muted rounded animate-pulse mb-6" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-surface border border-border rounded-xl p-4">
            <div className="flex gap-4">
              <div className="w-[120px] h-[120px] bg-muted rounded-lg animate-pulse shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-5 w-3/4 bg-muted rounded animate-pulse" />
                <div className="h-4 w-full bg-muted rounded animate-pulse" />
                <div className="h-4 w-1/2 bg-muted rounded animate-pulse" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
  if (error) return <main className="max-w-3xl mx-auto p-8"><p className="text-center text-red-400">{error}</p></main>;

  return (
    <main className="max-w-3xl mx-auto p-8">
      <div className="flex justify-between mb-4">
        <Link href="/scan" className="text-primary text-sm">&larr; Scan Another</Link>
        <Link href="/history" className="text-primary text-sm">History &rarr;</Link>
      </div>

      <h1 className="text-2xl font-bold mb-2">Scan Results</h1>
      {scan?.agent_summary && (
        <p className="text-sm text-muted-foreground mb-6">{scan.agent_summary}</p>
      )}

      {/* AI Food Expert */}
      <SuggestionPanel
        suggestions={suggestions}
        loading={suggestionsLoading}
        error={suggestionsError}
        onRegenerate={getSuggestions}
        onHide={() => setShowSuggestions(false)}
      />

      {/* Regenerate Descriptions Card */}
      <div className="mb-4">
        <RegenerateCard
          onRegenerateAll={regenerateAllDescriptions}
          itemCount={items.length}
        />
      </div>

      {/* Dietary Preference Filter */}
      <DietaryFilter
        dietPrefs={dietPrefs}
        onToggle={togglePref}
        totalCount={items.length}
        filteredCount={filteredItems.length}
      />

      {/* Dish Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredItems.map((item, index) => (
          <motion.div
            key={item.id}
            layout
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: Math.min(index * 0.05, 0.4) }}
            onClick={() => openDishImages(item)}
            className="cursor-pointer"
          >
            <DishCard
              id={item.id}
              name={item.name}
              description={item.description}
              price={item.price}
              category={item.category}
              image_url={item.image_url}
              confidence={item.confidence}
              dietary_tags={item.dietary_tags}
              ai_description={item.ai_description}
              onRegenerate={async () => {
                // Force regenerate: clear cache, call API, update items array
                // so the card shows the new description immediately.
                detailsCache.current.delete(item.id);
                setLoadingDetails(true);
                setDishDetails(null);
                try {
                  const res = await fetchWithCsrf("/api/dishes/details", {
                    method: "POST",
                    body: JSON.stringify({
                      dishName: item.name,
                      id: item.id,
                      category: item.category,
                      origin: item.origin,
                      description: item.description || item.ai_description || undefined,
                      regenerate: true,
                    }),
                  });
                  const data = await res.json();
                  if (data.error) throw new Error(data.error);
                  if (data.detailed_description) {
                    detailsCache.current.set(item.id, data as DishDetails);
                    setDishDetails(data as DishDetails);
                    // Update the items array so the card shows the new ai_description
                    setItems((prev) => prev.map((d) =>
                      d.id === item.id
                        ? { ...d, ai_description: typeof data.detailed_description === "string"
                            ? (data.detailed_description as string).slice(0, 300)
                            : "" }
                        : d
                    ));
                    toast.success("Description regenerated");
                  }
                } catch (err: any) {
                  toast.error(err.message || "Failed to regenerate description");
                } finally {
                  setLoadingDetails(false);
                }
              }}
            />
            <NutritionPanel dishName={item.name} />
            <RecipePanel dishName={item.name} />
            <p className="text-xs text-muted-foreground mt-1.5">Tap for photos & details</p>
          </motion.div>
        ))}
      </div>

      {/* Image Lightbox — shadcn Dialog handles its own animation */}
      <Dialog open={selectedDish !== null} onOpenChange={(open) => { if (!open) setSelectedDish(null); }}>
        <DialogContent
          className="sm:max-w-2xl max-h-[80vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {selectedDish && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
            >
              <DialogTitle className="text-lg font-semibold mb-2">{selectedDish.name}</DialogTitle>

              {/* AI-generated description (generated on click, cached) */}
              <div className="mb-4">
                {loadingDetails && (
                  <p className="text-sm text-muted-foreground animate-pulse">Generating description…</p>
                )}
                {!loadingDetails && dishDetails?.detailed_description && (
                  <div className="space-y-3 text-sm">
                    <p className="text-muted-foreground">{dishDetails.detailed_description}</p>
                    {dishDetails.ingredients?.length > 0 && (
                      <div>
                        <h4 className="font-medium mb-1">Ingredients</h4>
                        <p className="text-muted-foreground">{dishDetails.ingredients.join(", ")}</p>
                      </div>
                    )}
                    {dishDetails.preparation && (
                      <div>
                        <h4 className="font-medium mb-1">Preparation</h4>
                        <p className="text-muted-foreground">{dishDetails.preparation}</p>
                      </div>
                    )}
                    {dishDetails.serving_suggestions && (
                      <div>
                        <h4 className="font-medium mb-1">Serving</h4>
                        <p className="text-muted-foreground">{dishDetails.serving_suggestions}</p>
                      </div>
                    )}
                    {dishDetails.fun_fact && (
                      <div>
                        <h4 className="font-medium mb-1">Fun fact</h4>
                        <p className="text-muted-foreground">{dishDetails.fun_fact}</p>
                      </div>
                    )}
                  </div>
                )}
                {!loadingDetails && !dishDetails && (selectedDish.ai_description || selectedDish.description) && (
                  <p className="text-sm text-muted-foreground">
                    {selectedDish.ai_description || selectedDish.description}
                  </p>
                )}
              </div>

              <h3 className="text-sm font-medium mb-2">Photos</h3>

              {loadingImages && <p className="text-sm text-muted-foreground">Loading more photos...</p>}

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {selectedDish.image_url && !moreImages.some((img) => img.url === selectedDish.image_url) && (
                  <ProgressiveImage key="primary" src={selectedDish.image_url} alt={selectedDish.name} className="w-full rounded-lg" />
                )}
                {moreImages.map((img) => (
                  <ProgressiveImage key={img.url} src={img.url} alt={selectedDish.name} className="w-full rounded-lg" />
                ))}
              </div>

              {!loadingImages && moreImages.length === 0 && !selectedDish.image_url && (
                <p className="text-sm text-muted-foreground">No additional photos found.</p>
              )}
            </motion.div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
