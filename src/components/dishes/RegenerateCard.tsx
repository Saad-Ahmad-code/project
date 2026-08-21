"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

interface RegenerateCardProps {
  onRegenerateAll: () => Promise<void>;
  onRegenerateOne?: (id: string) => void;
  itemCount: number;
}

export function RegenerateCard({ onRegenerateAll, onRegenerateOne, itemCount }: RegenerateCardProps) {
  const [regenerating, setRegenerating] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleRegenerateAll = async () => {
    setRegenerating(true);
    try {
      await onRegenerateAll();
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <Card className="relative overflow-hidden border border-primary/20 bg-gradient-to-br from-primary/5 via-primary/10 to-primary/5">
      {/* Decorative glow */}
      <div className="absolute -top-12 -right-12 w-32 h-32 bg-primary/10 rounded-full blur-2xl" />
      <div className="absolute -bottom-8 -left-8 w-24 h-24 bg-primary/8 rounded-full blur-xl" />

      <div className="relative p-5">
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className="shrink-0 w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center">
            <motion.svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-primary"
              animate={regenerating ? { rotate: 360 } : {}}
              transition={regenerating ? { duration: 1, repeat: Infinity, ease: "linear" } : {}}
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M21 21v-5h-5" />
            </motion.svg>
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground">
              {regenerating ? "Regenerating descriptions..." : "AI Descriptions"}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {regenerating
                ? `Updating ${itemCount} dishes with fresh AI insights`
                : `Generate or refresh AI-powered descriptions for ${itemCount} dishes`}
            </p>
          </div>

          {/* Main action */}
          <Button
            onClick={handleRegenerateAll}
            disabled={regenerating}
            size="sm"
            className="shrink-0 h-9 px-4 rounded-lg font-medium text-xs bg-primary hover:bg-primary/90 disabled:opacity-60"
          >
            {regenerating ? (
              <span className="flex items-center gap-1.5">
                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Regenerating
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                  <path d="M21 21v-5h-5" />
                </svg>
                Regenerate All
              </span>
            )}
          </Button>
        </div>

        {/* Expandable per-dish section */}
        {onRegenerateOne && (
          <>
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-3 text-[0.7rem] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform ${expanded ? "rotate-180" : ""}`}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
              {expanded ? "Hide" : "Regenerate individual dishes"}
            </button>

            <AnimatePresence>
              {expanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 pt-3 border-t border-border/50">
                    <p className="text-[0.65rem] text-muted-foreground mb-2">
                      Click any dish to regenerate only its description
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </Card>
  );
}
