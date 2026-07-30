"use client";

import { useState } from "react";
import type { NutritionResult } from "@/app/api/nutrition/route";

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
        setResults(data.results || []);
        setExpanded(true);
      }
    } catch (err: any) {
      setError(err.message || "Failed to fetch nutrition data");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: "0.5rem" }}>
      <button
        onClick={fetchNutrition}
        disabled={loading}
        style={{
          background: loading ? "#555" : "#2d6a4f",
          color: "#fff",
          border: "none",
          borderRadius: "6px",
          padding: "6px 14px",
          fontSize: "0.8rem",
          cursor: loading ? "wait" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        {loading ? "🔍 Looking up..." : expanded && results ? "🥗 Hide Nutrition" : "🥗 Nutrition"}
      </button>

      {expanded && results && results.length > 0 && (
        <div style={{
          marginTop: "0.5rem",
          padding: "0.75rem",
          background: "#1a2e1f",
          borderRadius: "8px",
          border: "1px solid #2d6a4f",
          fontSize: "0.85rem",
        }}>
          {results.slice(0, 1).map((r, i) => (
            <div key={i}>
              {r.image_url && (
                <img
                  src={r.image_url}
                  alt={r.name}
                  style={{ float: "right", width: 50, height: 50, borderRadius: 6, objectFit: "cover" }}
                />
              )}
              <div style={{ fontWeight: 600, marginBottom: "0.4rem", color: "#95d5b2" }}>{r.name}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" }}>
                {r.calories !== undefined && (
                  <span>🔥 <strong>{r.calories}</strong> kcal</span>
                )}
                {r.protein_g !== undefined && (
                  <span>🥩 <strong>{r.protein_g}g</strong> protein</span>
                )}
                {r.fat_g !== undefined && (
                  <span>🧈 <strong>{r.fat_g}g</strong> fat</span>
                )}
                {r.carbs_g !== undefined && (
                  <span>🍚 <strong>{r.carbs_g}g</strong> carbs</span>
                )}
                {r.fiber_g !== undefined && (
                  <span>🌾 <strong>{r.fiber_g}g</strong> fiber</span>
                )}
                {r.sugars_g !== undefined && (
                  <span>🍬 <strong>{r.sugars_g}g</strong> sugars</span>
                )}
              </div>
              <div style={{ marginTop: "0.3rem", fontSize: "0.7rem", color: "#888" }}>
                per 100g · via Open Food Facts
                {r.serving_size && ` · serving: ${r.serving_size}`}
              </div>
            </div>
          ))}
          {results.length === 0 && (
            <div style={{ color: "#999" }}>No nutrition data found for &ldquo;{dishName}&rdquo;</div>
          )}
        </div>
      )}

      {error && (
        <div style={{ marginTop: "0.4rem", color: "#e76f51", fontSize: "0.8rem" }}>{error}</div>
      )}
    </div>
  );
}
