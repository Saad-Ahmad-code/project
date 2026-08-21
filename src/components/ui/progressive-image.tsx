"use client";

import { memo, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ProgressiveImageProps {
  src: string;
  alt: string;
  className?: string;
}

/**
 * Image with a shimmer placeholder that fades out once the photo decodes.
 * Handles the cached-image case (load event fires before React attaches
 * handlers) by checking `complete` on mount and whenever src changes.
 */
export const ProgressiveImage = memo(function ProgressiveImage({ src, alt, className }: ProgressiveImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setLoaded(false);
    setError(false);
    // Cached images can be complete before effects run.
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [src]);

  if (error || !src) return null;

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {!loaded && <div className="absolute inset-0 progressive-image-shimmer" aria-hidden="true" />}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={cn(
          "w-full h-full object-cover transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0"
        )}
      />
    </div>
  );
});
