"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { DishCard } from "@/components/dishes/DishCard";
import { NutritionPanel } from "@/components/NutritionPanel";
import { RecipePanel } from "@/components/RecipePanel";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useCsrf } from "@/hooks/useCsrf";
import { useDebounce } from "@/hooks/useDebounce";
import { SuggestionPanel, type FoodExpertSuggestion } from "@/components/SuggestionPanel";
import { DietaryFilter } from "@/components/DietaryFilter";
import type { MenuItem } from "@/types/menu";

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
  const [suggestions, setSuggestions] = useState<FoodExpertSuggestion | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  // Dietary preferences
  const [dietPrefs, setDietPrefs] = useState<string[]>([]);

  useEffect(() => {
    if (!params.id) return;
    fetch(`/api/scan/${encodeURIComponent(params.id as string)}`)
      .then((r) => r.json())
      .then((data) => {
        setScan(data.scan);
        setItems(data.items || []);
      })
      .catch((err) => {
        setError(err.message);
        toast.error(err.message);
      })
      .finally(() => setLoading(false));
  }, [params.id]);

  const openDishImages = async (dish: MenuItem) => {
    setSelectedDish(dish);
    setMoreImages([]);
    setLoadingImages(true);
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

  // Debounce the active filter set so a rapid burst of pill toggles settles
  // into ONE filteredItems recomputation instead of one per click.
  const debouncedPrefs = useDebounce(dietPrefs, 150);

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
            transition={{ duration: 0.25, delay: index * 0.05 }}
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
            />
            <NutritionPanel dishName={item.name} />
            <RecipePanel dishName={item.name} />
            <p className="text-xs text-muted-foreground mt-1.5">Tap to see more photos</p>
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

              {selectedDish.description && <p className="text-sm text-muted-foreground mb-4">{selectedDish.description}</p>}

              <h3 className="text-sm font-medium mb-2">Photos</h3>

              {loadingImages && <p className="text-sm text-muted-foreground">Loading more photos...</p>}

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {selectedDish.image_url && !moreImages.some((img) => img.url === selectedDish.image_url) && (
                  <img key="primary" src={selectedDish.image_url} alt={selectedDish.name} className="w-full rounded-lg" />
                )}
                {moreImages.map((img) => (
                  <img key={img.url} src={img.url} alt={selectedDish.name} loading="lazy" className="w-full rounded-lg" />
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
