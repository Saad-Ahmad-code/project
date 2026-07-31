#!/usr/bin/env python
"""RapidOCR scan — PaddleOCR PP-OCRv5 models on ONNX Runtime.

Usage: rapidocr_scan.py <image_path>
Prints JSON to stdout:
    {"raw_text": "...", "lines": [{"text": "...", "conf": 0.98, "box": [x0, y0, x1, y1]}]}

Part of the MenuLens offline OCR stack. Called from src/lib/ocr/local.ts as an
additional candidate engine alongside Tesseract.js (multi-PSM). Models are
downloaded automatically on first run (RapidOCR caches them). Failures are
reported as JSON {"error": ...} with a non-zero exit code — the TS caller
degrades gracefully to the Tesseract.js results.
"""

import json
import sys
import traceback


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: rapidocr_scan.py <image_path>"}))
        return 1

    image_path = sys.argv[1]

    try:
        from rapidocr import RapidOCR
    except Exception as exc:  # module missing — caller falls back to Tesseract
        print(json.dumps({"error": f"rapidocr import failed: {exc}"}))
        return 2

    try:
        engine = RapidOCR()
        out = engine(image_path)  # RapidOCROutput with .to_json() / .txts / .boxes / .scores
        result = out.to_json() if hasattr(out, "to_json") else out
    except Exception:
        traceback.print_exc()
        return 3

    lines = []
    if result:
        for item in result:
            box = item.get("box") or []
            text = item.get("txt") or ""
            conf = item.get("score")
            if not text or not text.strip() or len(box) < 4:
                continue
            xs = [p[0] for p in box]
            ys = [p[1] for p in box]
            lines.append({
                "text": text.strip(),
                "conf": float(conf) if conf is not None else 0.0,
                "box": [min(xs), min(ys), max(xs), max(ys)],
            })

    # Reading order: row bands (top→bottom), then left→right within a band.
    lines.sort(key=lambda l: (round(l["box"][1] / 24), l["box"][0]))

    raw_text = "\n".join(l["text"] for l in lines)
    print(json.dumps({"raw_text": raw_text, "lines": lines}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
