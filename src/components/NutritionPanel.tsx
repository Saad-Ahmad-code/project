"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { NutritionResult } from "@/app/api/nutrition/route";
import { getCached, setCache } from "@/lib/fetch-cache";

interface NutritionPanelProps {
  dishName: string;
}

export function NutritionPanel({ dishName }: NutritionPanelProps) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<NutritionResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchNutrition = async () => {
    if (results) { setExpanded(!expanded); return; }
    const cached = getCached<NutritionResult[]>(dishName);
    if (cached) {
      setResults(cached);
      setExpanded(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/nutrition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dish_name: dishName }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        const nutritionResults = data.results || [];
        setCache(dishName, nutritionResults);
        setResults(nutritionResults);
        setExpanded(true);
      }
    } catch (err: any) {
      setError(err.message || "Failed to fetch nutrition data");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-2">
      <button
        onClick={fetchNutrition}
        disabled={loading}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border-none cursor-pointer text-white disabled:cursor-wait disabled:opacity-50 ${
          loading ? "bg-muted-foreground/30" : "bg-emerald-700 hover:bg-emerald-600"
        }`}
      >
        {loading ? "Looking up..." : expanded && results ? "Hide Nutrition" : "Nutrition"}
      </button>

      <AnimatePresence>
        {expanded && results && results.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-2 p-3 rounded-lg border border-emerald-700 bg-emerald-950/50 overflow-hidden"
          >
            {results.slice(0, 1).map((r, i) => (
              <div key={i}>
                {r.image_url && (
                  <img
                    src={r.image_url}
                    alt={r.name}
                    loading="lazy"
                    className="float-right w-[50px] h-[50px] rounded object-cover"
                  />
                )}
                <div className="font-semibold mb-1.5 text-emerald-300 text-sm flex items-center gap-2">
                  {r.name}
                  {r.nutri_score && (
                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[0.65rem] font-bold text-white ${
                      r.nutri_score === 'A' ? 'bg-green-600' :
                      r.nutri_score === 'B' ? 'bg-lime-600' :
                      r.nutri_score === 'C' ? 'bg-yellow-500' :
                      r.nutri_score === 'D' ? 'bg-orange-500' :
                      'bg-red-600'
                    }`}>
                      {r.nutri_score}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  {r.calories !== undefined && (
                    <span><strong>{r.calories}</strong> kcal</span>
                  )}
                  {r.protein_g !== undefined && (
                    <span><strong>{r.protein_g}g</strong> protein</span>
                  )}
                  {r.fat_g !== undefined && (
                    <span><strong>{r.fat_g}g</strong> fat</span>
                  )}
                  {r.carbs_g !== undefined && (
                    <span><strong>{r.carbs_g}g</strong> carbs</span>
                  )}
                  {r.fiber_g !== undefined && (
                    <span><strong>{r.fiber_g}g</strong> fiber</span>
                  )}
                  {r.sugars_g !== undefined && (
                    <span><strong>{r.sugars_g}g</strong> sugars</span>
                  )}
                </div>
                <div className="mt-1 text-[0.7rem] text-muted-foreground">
                  per 100g &middot; via {r.source === 'usda' ? 'USDA Food Data Central' : 'Open Food Facts'}
                  {r.serving_size && ` \u00b7 serving: ${r.serving_size}`}
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {expanded && results && results.length === 0 && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="mt-2 text-sm text-muted-foreground"
        >
          No nutrition data found for &ldquo;{dishName}&rdquo;
        </motion.div>
      )}

      {error && (
        <div className="mt-1 text-xs text-red-400">{error}</div>
      )}
    </div>
  );
}
