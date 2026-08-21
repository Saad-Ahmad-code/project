"use client";

import { memo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
  onRegenerate?: (id: string) => void;
}

export const DishCard = memo(function DishCard({ id, name, description, price, category, image_url, confidence, dietary_tags, ai_description, onRegenerate }: DishCardProps) {
  const [imageError, setImageError] = useState(false);

  return (
    <Card className="flex flex-row gap-4 p-4">
      {image_url && !imageError && (
        <img
          src={image_url}
          alt={name}
          loading="lazy"
          onError={() => setImageError(true)}
          className="w-[120px] h-[120px] object-cover rounded-lg shrink-0"
        />
      )}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base font-semibold">{name}</h3>
          {onRegenerate && (
            <button
              onClick={(e) => { e.stopPropagation(); onRegenerate(id); }}
              className="shrink-0 w-7 h-7 rounded-lg bg-primary/10 hover:bg-primary/20 flex items-center justify-center transition-colors group"
              title="Regenerate description"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-primary/60 group-hover:text-primary transition-colors"
              >
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M21 21v-5h-5" />
              </svg>
            </button>
          )}
        </div>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        {ai_description && <p className="text-xs text-muted-foreground/70">{ai_description}</p>}
        <div className="flex gap-2 items-center flex-wrap">
          {price !== undefined && (
            <span className="text-accent font-bold text-sm">${price.toFixed(2)}</span>
          )}
          {category && (
            <Badge variant="outline" className="text-xs">{category}</Badge>
          )}
          {dietary_tags?.length ? dietary_tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
          )) : null}
          <span className="text-xs text-muted-foreground">{(confidence * 100).toFixed(0)}% match</span>
        </div>
      </div>
    </Card>
  );
});
