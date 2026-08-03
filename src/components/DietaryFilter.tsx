"use client";

/**
 * Shared dietary preference filter (results page).
 *
 * Renders the filter toggle + pill buttons and reports how many dishes
 * match the active prefs. The parent supplies `totalCount`/`filteredCount`
 * (computed from its own `filteredItems` memo) and owns the `dietPrefs`
 * state via `onToggle` — filtering logic stays in the page because it needs
 * the items themselves.
 */
import { useState } from "react";

export const DIET_PREFS = ["vegetarian", "vegan", "gluten-free", "halal", "low-carb", "keto"] as const;
export type DietPref = (typeof DIET_PREFS)[number];

interface DietaryFilterProps {
  dietPrefs: string[];
  onToggle: (pref: string) => void;
  totalCount: number;
  filteredCount: number;
}

export function DietaryFilter({ dietPrefs, onToggle, totalCount, filteredCount }: DietaryFilterProps) {
  const [showPrefs, setShowPrefs] = useState(false);

  return (
    <div className="mb-4">
      <button
        onClick={() => setShowPrefs(!showPrefs)}
        className="text-sm text-muted-foreground hover:text-white transition-colors bg-transparent border border-border rounded-md px-3 py-1.5 cursor-pointer"
      >
        {showPrefs ? "Hide Filters" : `Dietary Filters${dietPrefs.length > 0 ? ` (${dietPrefs.length})` : ""}`}
      </button>
      {showPrefs && (
        <div className="flex gap-2 mt-2 flex-wrap">
          {DIET_PREFS.map((pref) => (
            <button
              key={pref}
              onClick={() => onToggle(pref)}
              className={`text-xs px-3 py-1 rounded-full border cursor-pointer transition-colors ${
                dietPrefs.includes(pref)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-surface text-muted-foreground border-border hover:text-white"
              }`}
            >
              {pref === "gluten-free" ? "Gluten-Free" : pref.charAt(0).toUpperCase() + pref.slice(1)}
            </button>
          ))}
        </div>
      )}
      {dietPrefs.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          {filteredCount} of {totalCount} dishes match your preferences
        </p>
      )}
    </div>
  );
}
