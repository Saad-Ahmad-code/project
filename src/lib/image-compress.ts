"use client";

/**
 * Client-side image compression before upload.
 *
 * Mobile photos are typically 3–10MB; resizing to ≤1600px on the long edge
 * at ~0.75 JPEG quality drops them to ~200–600KB with no meaningful OCR
 * quality loss (OCR text needs ~300 DPI equivalent, which 1600px covers for
 * a typical menu page). Result: faster uploads, less memory, quicker
 * server-side preprocessing.
 *
 * Falls back to the original file when compression isn't possible
 * (non-image, decode failure, canvas unavailable).
 */
export async function compressImage(
  file: File,
  opts: { maxDim?: number; quality?: number } = {}
): Promise<File> {
  const { maxDim = 1600, quality = 0.75 } = opts;

  // Only compress raster images; leave others (or tiny files) untouched.
  if (!file.type.startsWith("image/") || file.size < 100 * 1024) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    if (scale >= 1) {
      bitmap.close();
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    if (!blob) return file;

    // Preserve the original name/base but with the compressed size.
    return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}
