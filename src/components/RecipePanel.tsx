"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { RecipeResult } from "@/app/api/recipes/route";

interface RecipePanelProps {
  dishName: string;
}

export function RecipePanel({ dishName }: RecipePanelProps) {
  const [loading, setLoading] = useState(false);
  const [recipe, setRecipe] = useState<RecipeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const fetchRecipe = async () => {
    setLoading(true);
    setError(null);
    setRecipe(null);
    try {
      const res = await fetch(`/api/recipes?dish=${encodeURIComponent(dishName)}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else if (data.recipes && data.recipes.length > 0) {
        setRecipe(data.recipes[0]);
        setOpen(true);
      } else {
        setError("No recipe found for this dish.");
      }
    } catch {
      setError("Failed to fetch recipe");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        onClick={fetchRecipe}
        disabled={loading}
        variant="ghost"
        size="sm"
        className="text-xs text-muted-foreground hover:text-white"
      >
        {loading ? "Searching..." : "Recipe"}
      </Button>

      <Dialog open={open} onOpenChange={(o) => { if (!o) setOpen(false); }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          {recipe && (
            <div>
              <DialogTitle className="text-xl font-bold mb-1">{recipe.name}</DialogTitle>
              <div className="flex gap-2 text-xs text-muted-foreground mb-4">
                {recipe.category && <span>{recipe.category}</span>}
                {recipe.area && <span>&middot; {recipe.area}</span>}
                {recipe.tags && recipe.tags.length > 0 && (
                  <span>&middot; {recipe.tags.join(", ")}</span>
                )}
              </div>

              {recipe.image_url && (
                <img
                  src={recipe.image_url}
                  alt={recipe.name}
                  className="w-full max-h-[300px] object-cover rounded-lg mb-4"
                />
              )}

              <div className="mb-4">
                <h3 className="text-sm font-semibold mb-2">Ingredients</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {recipe.ingredients.map((ing, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-muted-foreground">&bull;</span>
                      <span>{ing.measure ? `${ing.measure} ${ing.name}` : ing.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-2">Instructions</h3>
                <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                  {recipe.instructions}
                </p>
              </div>

              {recipe.source && (
                <a
                  href={recipe.source}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-4 text-xs text-primary hover:text-primary/80"
                >
                  View original recipe &rarr;
                </a>
              )}
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-red-950 border border-red-800">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
