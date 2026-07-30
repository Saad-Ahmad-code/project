"use client";

import { useState } from "react";

interface DishCardProps {
  id: string;
  name: string;
  description?: string;
  price?: number;
  category?: string;
  image_url: string;
  confidence: number;
  dietary_tags?: string[];
  ai_description?: string;
}

export function DishCard({ id, name, description, price, category, image_url, confidence, dietary_tags, ai_description }: DishCardProps) {
  const [imageError, setImageError] = useState(false);

  return (
    <div style={{ background: "#111", borderRadius: 12, padding: "1rem", display: "flex", gap: "1rem" }}>
      {image_url && !imageError && (
        <img
          src={image_url}
          alt={name}
          loading="lazy"
          onError={() => setImageError(true)}
          style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 8, flexShrink: 0 }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ marginBottom: "0.25rem" }}>{name}</h3>
        {description && <p style={{ color: "#999", fontSize: "0.9rem", marginBottom: "0.25rem" }}>{description}</p>}
        {ai_description && <p style={{ color: "#666", fontSize: "0.85rem", marginBottom: "0.25rem" }}>{ai_description}</p>}
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          {price !== undefined && <span style={{ color: "#4ade80", fontWeight: "bold" }}>${price.toFixed(2)}</span>}
          {category && <span style={{ background: "#1f2937", padding: "0.15rem 0.5rem", borderRadius: 4, fontSize: "0.8rem", color: "#999" }}>{category}</span>}
          {dietary_tags?.length ? dietary_tags.map((tag) => (
            <span key={tag} style={{ background: "#1a2e1a", padding: "0.15rem 0.5rem", borderRadius: 4, fontSize: "0.8rem", color: "#4ade80" }}>{tag}</span>
          )) : null}
          <span style={{ fontSize: "0.8rem", color: "#666" }}>{(confidence * 100).toFixed(0)}% match</span>
        </div>
      </div>
    </div>
  );
}
