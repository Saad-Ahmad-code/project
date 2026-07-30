"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { DishCard } from "@/components/dishes/DishCard";
import type { MenuItem } from "@/types/menu";

export default function ResultsPage() {
  const params = useParams();
  const [scan, setScan] = useState<{ id: string; status: string; items_count: number; agent_summary?: string } | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDish, setSelectedDish] = useState<MenuItem | null>(null);
  const [moreImages, setMoreImages] = useState<{ url: string; source: string }[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);

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

  if (loading) return <main style={{ padding: "2rem", textAlign: "center" }}><p>Loading...</p></main>;
  if (error) return <main style={{ padding: "2rem", textAlign: "center" }}><p style={{ color: "red" }}>{error}</p></main>;

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "2rem" }}>
      <div style={{ marginBottom: "1rem" }}>
        <Link href="/scan" style={{ color: "#60a5fa" }}>&larr; Scan Another</Link>
      </div>

      <h1 style={{ marginBottom: "0.5rem" }}>Scan Results</h1>
      {scan?.agent_summary && (
        <p style={{ color: "#999", marginBottom: "1.5rem" }}>{scan.agent_summary}</p>
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
