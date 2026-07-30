#!/usr/bin/env python3
"""
📸 EasyOCR Menu Scanner — Standalone Python Script

Replaces the fragile inline Python Tesseract approach with EasyOCR's
deep-learning OCR engine. 80+ languages, CPU-friendly, much better at
handling complex menu fonts, backgrounds, and layouts.

Usage:
    python easyocr_scan.py <image_path>
Output:
    JSON to stdout with recognized text, layout groups, and structured items.
"""

import json
import re
import sys
from pathlib import Path

try:
    import easyocr
except ImportError:
    print(json.dumps({"error": "easyocr not installed. Run: pip install easyocr"}))
    sys.exit(1)


# ── Constants ──

# Common menu section header keywords (case-insensitive)
SECTION_HEADERS = {
    "appetizer", "appetizers", "starters", "starter", "entree", "entrees",
    "main", "mains", "main course", "main courses", "dessert", "desserts",
    "beverages", "beverage", "drinks", "drink", "cocktails", "cocktail",
    "sides", "side", "soup", "soups", "salad", "salads", "specials",
    "special", "today's special", "chef's special", "kids", "children",
    "breakfast", "lunch", "dinner", "brunch", "combos", "combo",
    "pizza", "pasta", "burgers", "sandwiches", "wraps", "tacos",
    "seafood", "steaks", "grill", "bbq", "vegetarian", "vegan",
    "gluten free", "naan", "curry", "rice", "noodles", "sushi",
}

# Price pattern: $12.99, 12.99, $12, 12, Rs. 99, PKR 150
PRICE_RE = re.compile(r'(?:[\$£€₹₨PKR\s]*)(\d+(?:\.\d{1,2})?)\s*(?:$|(?=\s+(?:USD|PKR|EUR|GBP)))')

# Phone / email / address / URL — filter these out
JUNK_RE = re.compile(
    r'(?:\b\d{3,4}[\s\-.]\d{3}[\s\-.]\d{4}\b)'         # phone
    r'|(?:[\w.]+@[\w.]+)'                                   # email
    r'|(?:https?://\S+)'                                     # URL
    r'|(?:www\.\S+)',                                        # web
    re.IGNORECASE
)

# Time patterns (e.g. "11:00am – 10:00pm")
TIME_RE = re.compile(
    r'\b\d{1,2}:\d{2}\s*[ap]\.?\s*m\.?\b|\b\d{1,2}\s*[ap]\.?\s*m\.?\b',
    re.IGNORECASE
)

# Day-of-week patterns
DAY_RE = re.compile(
    r'\b(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b',
    re.IGNORECASE
)

# Address / footer keywords
FOOTER_KW = {"st", "ave", "rd", "blvd", "dr", "ln", "ste", "suite", "floor",
             "phone", "tel", "fax", "email", "hours", "open", "closed",
             "delivery", "takeout", "dine-in", "reservation"}


def is_junk(text: str) -> bool:
    """Check if text is phone, email, address, or other non-menu content."""
    t = text.strip().lower()
    if not t or len(t) < 2:
        return True
    if JUNK_RE.search(t):
        return True
    if TIME_RE.search(t):
        return True
    if DAY_RE.search(t):
        return True
    # All digits / symbols
    alpha = sum(1 for c in t if c.isalpha())
    if alpha < 2 and len(t) > 3:
        return True
    return False


def extract_price(text: str) -> float | None:
    """Try to extract a price from the end of a text line."""
    # Look for price at end of line
    m = re.search(r'(?:[\$£€₹₨PKR\s]*)(\d+(?:\.\d{1,2})?)\s*$', text.strip())
    if m:
        return float(m.group(1))
    return None


def is_section_header(text: str) -> bool:
    """Check if text looks like a menu section header."""
    t = text.strip().lower().rstrip(":.")
    return t in SECTION_HEADERS


def group_into_lines(results, y_tolerance: float = 0.015):
    """
    Group EasyOCR results into text lines based on vertical position.
    y_tolerance = fraction of image height for same-line threshold.
    """
    if not results:
        return []

    # Get image dimensions from the last bounding box corner
    img_height = max(r[0][2][1] for r in results)  # bottom y from any result

    # Sort by y-center
    sorted_items = sorted(results, key=lambda r: (r[0][0][1] + r[0][2][1]) / 2)

    lines = []
    current_line = []
    current_y = None

    for bbox, text, conf in sorted_items:
        y_center = (bbox[0][1] + bbox[2][1]) / 2
        y_normalized = y_center / max(img_height, 1)

        if current_y is None:
            current_y = y_normalized
            current_line = [(text, conf, bbox)]
        elif abs(y_normalized - current_y) < y_tolerance:
            current_line.append((text, conf, bbox))
        else:
            lines.append(current_line)
            current_y = y_normalized
            current_line = [(text, conf, bbox)]

    if current_line:
        lines.append(current_line)

    return lines


def classify_line(text: str) -> str:
    """Classify a text line: 'header', 'item', 'price', or 'junk'."""
    t = text.strip()
    if not t:
        return "junk"
    if is_section_header(t):
        return "header"
    if is_junk(t):
        return "junk"
    # If it has a price-like ending
    price = extract_price(t)
    if price is not None:
        return "item_with_price"
    return "item"


def parse_menu(lines: list) -> dict:
    """
    Parse grouped lines into a structured menu.
    Returns dict with items, menu_name, raw_text, etc.
    """
    items = []
    current_category = "menu"
    raw_lines = []

    for line_group in lines:
        # Sort horizontally within the line
        sorted_group = sorted(line_group, key=lambda x: x[2][0][0])
        line_text = " ".join(t for t, _, _ in sorted_group).strip()
        avg_conf = sum(c for _, c, _ in sorted_group) / max(len(sorted_group), 1)

        raw_lines.append(line_text)

        classification = classify_line(line_text)

        if classification == "header":
            current_category = line_text.strip().lower().rstrip(":.")
            continue

        if classification == "junk":
            continue

        if classification == "item_with_price":
            price = extract_price(line_text)
            # Remove price from name
            name = line_text
            if price is not None:
                name = re.sub(r'[\s]*[\$£€₹₨PKR]*\s*' + re.escape(str(price)) + r'\s*$', '', name).strip()
                # Also try removing with decimal
                if price == int(price):
                    name = re.sub(r'[\s]*[\$£€₹₨PKR]*\s*' + re.escape(str(int(price))) + r'\s*$', '', name).strip()

            # Split name from description if there's a dash or pipe
            description = ""
            for sep in [" — ", " – ", " - ", " | ", " / "]:
                parts = re.split(re.escape(sep), name, maxsplit=1)
                if len(parts) > 1 and len(parts[1]) > 5:
                    name = parts[0].strip()
                    description = parts[1].strip()
                    break

            if name and len(name) > 1:
                items.append({
                    "name": name,
                    "description": description,
                    "price": price,
                    "category": current_category,
                    "confidence": round(avg_conf, 2),
                })
        elif classification == "item":
            items.append({
                "name": line_text,
                "description": "",
                "price": None,
                "category": current_category,
                "confidence": round(avg_conf, 2),
            })

    return {
        "menu_name": "",
        "items": items,
        "raw_text": "\n".join(raw_lines),
        "strategy": "easyocr",
        "avg_confidence": round(
            sum(i["confidence"] for i in items) / max(len(items), 1), 1
        ) if items else 0,
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: easyocr_scan.py <image_path>"}))
        sys.exit(1)

    image_path = sys.argv[1]
    if not Path(image_path).exists():
        print(json.dumps({"error": f"Image not found: {image_path}"}))
        sys.exit(1)

    try:
        # Initialize EasyOCR reader (English only for speed, CPU-friendly)
        reader = easyocr.Reader(["en"], gpu=False)

        # Run OCR with paragraph grouping disabled (we do our own grouping)
        results = reader.readtext(
            image_path,
            paragraph=False,
            width_ths=0.7,
            height_ths=0.5,
            ycenter_ths=0.5,
            text_threshold=0.5,
            low_text=0.3,
            link_threshold=0.3,
        )

        if not results:
            print(json.dumps({
                "menu_name": "",
                "items": [],
                "raw_text": "",
                "strategy": "easyocr",
                "avg_confidence": 0,
                "note": "No text detected",
            }))
            return

        # Group into lines and parse
        lines = group_into_lines(results)
        menu = parse_menu(lines)

        # Filter low-confidence items
        menu["items"] = [i for i in menu["items"] if i["confidence"] >= 0.2]

        print(json.dumps(menu, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
