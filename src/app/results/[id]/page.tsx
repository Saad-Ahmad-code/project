"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { DishCard } from "@/components/dishes/DishCard";
import { NutritionPanel } from "@/components/NutritionPanel";
import { RecipePanel } from "@/components/RecipePanel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import type { MenuItem } from "@/types/menu";

interface FoodExpertSuggestion {
  top_picks?: { name: string; reason: string; pairing?: string; allergens?: string[] }[];
  must_try?: string;
  overview?: string;
  tips?: string[];
}

export default function ResultsPage() {
  const params = useParams();
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
  const [showPrefs, setShowPrefs] = useState(false);

  useEffect(() => {
    if (!params.id) return;
    fetch(`/api/scan/${encodeURIComponent(params.id as string)}`)
      .then((r) => r.json())
      .then((data) => {
        setScan(data.scan);
        setItems(data.items || []);
      })
      .catch((err) => setError(err.message))
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
    } finally {
      setLoadingImages(false);
    }
  };

  const getSuggestions = async () => {
    setSuggestionsLoading(true);
    setSuggestionsError(null);
    setSuggestions(null);
    try {
      const res = await fetch(`/api/scan/${encodeURIComponent(params.id as string)}`, { method: "POST" });
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

  const filteredItems = dietPrefs.length === 0
    ? items
    : items.filter((item) => {
        const tags = (item.dietary_tags || []).map((t) => t.toLowerCase());
        const name = item.name.toLowerCase();
        const desc = (item.description || "").toLowerCase();
        const combined = `${name} ${desc} ${tags.join(" ")}`;
        for (const pref of dietPrefs) {
          if (pref === "vegetarian" && (combined.includes("meat") || combined.includes("chicken") || combined.includes("beef") || combined.includes("fish") || combined.includes("pork"))) return false;
          if (pref === "vegan" && (combined.includes("dairy") || combined.includes("cheese") || combined.includes("cream") || combined.includes("milk") || combined.includes("egg") || combined.includes("meat") || combined.includes("honey"))) return false;
          if (pref === "gluten-free" && (combined.includes("bread") || combined.includes("pasta") || combined.includes("flour") || combined.includes("wheat") || combined.includes("naan") || combined.includes("bun"))) return false;
          if (pref === "halal" && (combined.includes("pork") || combined.includes("alcohol") || combined.includes("wine"))) return false;
          if (pref === "low-carb" && (combined.includes("rice") || combined.includes("pasta") || combined.includes("bread") || combined.includes("naan") || combined.includes("potato") || combined.includes("sugar"))) return false;
          if (pref === "keto" && (combined.includes("rice") || combined.includes("pasta") || combined.includes("bread") || combined.includes("naan") || combined.includes("sugar") || combined.includes("potato") || combined.includes("sweet"))) return false;
        }
        return true;
      });

  if (loading) return <main className="max-w-3xl mx-auto p-8"><p className="text-center text-muted">Loading...</p></main>;
  if (error) return <main className="max-w-3xl mx-auto p-8"><p className="text-center text-red-400">{error}</p></main>;

  return (
    <main className="max-w-3xl mx-auto p-8">
      <div className="flex justify-between mb-4">
        <Link href="/scan" className="text-primary text-sm">&larr; Scan Another</Link>
        <Link href="/history" className="text-primary text-sm">History &rarr;</Link>
      </div>

      <h1 className="text-2xl font-bold mb-2">Scan Results</h1>
      {scan?.agent_summary && (
        <p className="text-sm text-muted mb-6">{scan.agent_summary}</p>
      )}

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
                {suggestions.top_picks.map((pick, i) => (
                  <div key={i} className="bg-white/5 rounded-md p-3 mb-1.5">
                    <p className="text-white font-bold text-sm mb-0.5">{pick.name}</p>
                    <p className="text-emerald-100 text-xs mb-0.5">{pick.reason}</p>
                    {pick.pairing && <p className="text-amber-300 text-xs">{pick.pairing}</p>}
                    {pick.allergens && pick.allergens.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {pick.allergens.map((a) => (
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
                {suggestions.tips.map((tip, i) => (
                  <p key={i} className="text-emerald-100 text-xs mb-1 pl-4">&bull; {tip}</p>
                ))}
              </div>
            )}

            <Button
              onClick={getSuggestions}
              variant="outline"
              size="sm"
              className="w-full mt-3 border-primary text-emerald-100"
            >
              Regenerate Suggestions
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dietary Preference Filter */}
      <div className="mb-4">
        <button
          onClick={() => setShowPrefs(!showPrefs)}
          className="text-sm text-muted hover:text-white transition-colors bg-transparent border border-border rounded-md px-3 py-1.5 cursor-pointer"
        >
          {showPrefs ? "Hide Filters" : `Dietary Filters${dietPrefs.length > 0 ? ` (${dietPrefs.length})` : ""}`}
        </button>
        {showPrefs && (
          <div className="flex gap-2 mt-2 flex-wrap">
            {["vegetarian", "vegan", "gluten-free", "halal", "low-carb", "keto"].map((pref) => (
              <button
                key={pref}
                onClick={() => togglePref(pref)}
                className={`text-xs px-3 py-1 rounded-full border cursor-pointer transition-colors ${
                  dietPrefs.includes(pref)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-surface text-muted border-border hover:text-white"
                }`}
              >
                {pref === 'gluten-free' ? 'Gluten-Free' : pref.charAt(0).toUpperCase() + pref.slice(1)}
              </button>
            ))}
          </div>
        )}
        {dietPrefs.length > 0 && (
          <p className="text-xs text-muted mt-2">
            {filteredItems.length} of {items.length} dishes match your preferences
          </p>
        )}
      </div>

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
            <p className="text-xs text-muted mt-1.5">Tap to see more photos</p>
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

              {selectedDish.description && <p className="text-sm text-muted mb-4">{selectedDish.description}</p>}

              <h3 className="text-sm font-medium mb-2">Photos</h3>

              {loadingImages && <p className="text-sm text-muted">Loading more photos...</p>}

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {selectedDish.image_url && !moreImages.some((img) => img.url === selectedDish.image_url) && (
                  <img key="primary" src={selectedDish.image_url} alt={selectedDish.name} className="w-full rounded-lg" />
                )}
                {moreImages.map((img) => (
                  <img key={img.url} src={img.url} alt={selectedDish.name} className="w-full rounded-lg" />
                ))}
              </div>

              {!loadingImages && moreImages.length === 0 && !selectedDish.image_url && (
                <p className="text-sm text-muted">No additional photos found.</p>
              )}
            </motion.div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
