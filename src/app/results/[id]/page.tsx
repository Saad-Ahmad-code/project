"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { DishCard } from "@/components/dishes/DishCard";
import { NutritionPanel } from "@/components/NutritionPanel";
import type { MenuItem } from "@/types/menu";

interface FoodExpertSuggestion {
  top_picks?: { name: string; reason: string; pairing?: string }[];
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

  if (loading) return <main style={{ padding: "2rem", textAlign: "center" }}><p>Loading...</p></main>;
  if (error) return <main style={{ padding: "2rem", textAlign: "center" }}><p style={{ color: "red" }}>{error}</p></main>;

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "2rem" }}>
      <div style={{ marginBottom: "1rem", display: "flex", justifyContent: "space-between" }}>
        <Link href="/scan" style={{ color: "#60a5fa" }}>&larr; Scan Another</Link>
        <Link href="/history" style={{ color: "#60a5fa" }}>History &rarr;</Link>
      </div>

      <h1 style={{ marginBottom: "0.5rem" }}>Scan Results</h1>
      {scan?.agent_summary && (
        <p style={{ color: "#999", marginBottom: "1.5rem" }}>{scan.agent_summary}</p>
      )}

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
              {suggestions.top_picks.map((pick, i) => (
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
              {suggestions.tips.map((tip, i) => (
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
        {items.map((item) => (
          <div key={item.id} onClick={() => openDishImages(item)} style={{ cursor: "pointer" }}>
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
            <p style={{ color: "#555", fontSize: "0.8rem", marginTop: "0.4rem" }}>Tap to see more photos</p>
          </div>
        ))}
      </div>

      {selectedDish && (
        <div
          onClick={() => setSelectedDish(null)}
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
              <h2 style={{ margin: 0 }}>{selectedDish.name}</h2>
              <button onClick={() => setSelectedDish(null)} style={{ background: "#333", color: "#fff", border: "none", padding: "0.4rem 0.9rem", borderRadius: 6, cursor: "pointer" }}>Close</button>
            </div>

            {selectedDish.description && <p style={{ color: "#999", marginBottom: "1rem" }}>{selectedDish.description}</p>}

            <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Photos</h3>

            {loadingImages && <p style={{ color: "#666" }}>Loading more photos...</p>}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.75rem" }}>
              {selectedDish.image_url && !moreImages.some((img) => img.url === selectedDish.image_url) && (
                <img key="primary" src={selectedDish.image_url} alt={selectedDish.name} style={{ width: "100%", borderRadius: 8 }} />
              )}
              {moreImages.map((img) => (
                <img key={img.url} src={img.url} alt={selectedDish.name} style={{ width: "100%", borderRadius: 8 }} />
              ))}
            </div>

            {!loadingImages && moreImages.length === 0 && !selectedDish.image_url && (
              <p style={{ color: "#666" }}>No additional photos found.</p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
