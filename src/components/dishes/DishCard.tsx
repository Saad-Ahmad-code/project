"use client";

import { useState } from "react";
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
}

export function DishCard({ id, name, description, price, category, image_url, confidence, dietary_tags, ai_description }: DishCardProps) {
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
        <h3 className="text-base font-semibold">{name}</h3>
        {description && <p className="text-sm text-muted">{description}</p>}
        {ai_description && <p className="text-xs text-muted/70">{ai_description}</p>}
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
          <span className="text-xs text-muted">{(confidence * 100).toFixed(0)}% match</span>
        </div>
      </div>
    </Card>
  );
}
