"use client";

/**
 * Shared AI Food Expert suggestion panel.
 *
 * Used by the scan page (offline scan results) and the results page — both
 * previously duplicated this panel with minor differences. Props:
 *
 *  - suggestions:  parsed /api/suggest payload (or null)
 *  - loading:      in-flight state (renders the analyzing placeholder)
 *  - error:        fetch/parse error text (or null)
 *  - onRegenerate: re-fetches suggestions
 *  - onHide:       collapses the panel (sets showSuggestions=false)
 */
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export interface FoodExpertSuggestion {
  top_picks?: { name: string; reason: string; pairing?: string; allergens?: string[] }[];
  must_try?: string;
  overview?: string;
  tips?: string[];
}

interface SuggestionPanelProps {
  suggestions: FoodExpertSuggestion | null;
  loading: boolean;
  error: string | null;
  onRegenerate: () => void;
  onHide: () => void;
}

export function SuggestionPanel({ suggestions, loading, error, onRegenerate, onHide }: SuggestionPanelProps) {
  return (
    <>
      {!loading && !suggestions && (
        <Button
          onClick={onRegenerate}
          className="w-full mb-6 font-bold bg-gradient-to-br from-emerald-600 to-emerald-700"
        >
          Ask AI Food Expert
        </Button>
      )}

      {loading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mb-6 p-4 bg-surface rounded-lg text-center"
        >
          <Progress value={60} className="h-1.5 mb-2" />
          <p className="text-sm text-muted-foreground">AI Food Expert is analyzing your menu...</p>
        </motion.div>
      )}

      {error && !loading && (
        <div className="mb-4 p-3 rounded-lg bg-red-950 border border-red-800 text-red-400 text-sm">
          {error}
        </div>
      )}

      <AnimatePresence>
        {suggestions && (
          <motion.div
            key="suggestions"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="mb-6 rounded-xl p-5 border border-primary overflow-hidden bg-gradient-to-br from-emerald-900 to-emerald-800"
          >
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-semibold text-white">AI Food Expert</h2>
              <button onClick={onHide} className="text-sm text-muted-foreground bg-transparent border-none cursor-pointer">
                Hide
              </button>
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
              onClick={onRegenerate}
              variant="outline"
              size="sm"
              className="w-full mt-3 border-primary text-emerald-100"
            >
              Regenerate Suggestions
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
