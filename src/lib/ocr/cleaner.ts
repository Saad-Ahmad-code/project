// ═══════════════════════════════════════════════════════════════════
//  OCR TEXT CLEANER — deterministic pre-parser
//
//  Analyzes raw OCR text line by line, classifies each line
//  (dish / price / header / noise), removes useless text (venue titles,
//  subtitles, addresses, phone numbers, hours, delivery spam, legal
//  boilerplate), merges split prices back onto their dish names
//  ("Smoked Brisket\n$18.50" → "Smoked Brisket $18.50"), and returns the
//  cleaned, ordered text. The parsers in local.ts then see a tidy menu
//  instead of raw OCR garbage.
//
//  Conservative by design: a line is only dropped when it is
//  unambiguous noise. Headers (all-caps or category keywords) are always
//  kept — they set dish categories downstream. Everything the parsers
//  could legitimately use survives cleaning.
//
//  Self-contained (no imports from local.ts) so it can also be used
//  standalone and in tests.
// ═══════════════════════════════════════════════════════════════════

export type CleanLineKind = "dish" | "price" | "header" | "noise";

export interface CleanLine {
  text: string;
  kind: CleanLineKind;
}

export interface CleanResult {
  /** Cleaned, ordered menu text (lines joined with \n). */
  text: string;
  /** Classified lines that survived cleaning. */
  lines: CleanLine[];
  /** Lines that were dropped as noise. */
  dropped: string[];
  /** Count of split-price merges performed. */
  merged: number;
}

const PRICE_ONLY = /^[$€£¥]?\s*\d{1,4}(?:[.,]\d{1,2})?[\s.]*$/;
const HAS_PRICE = /[$€£¥]\s*\d|\b\d{1,3}[.,]\d{1,2}\b/;

// ── Noise detectors (a line matching ANY of these is dropped) ──

/** Venue subtitle: "Gastro Pub · Est. 2011", "Since 1998", "Est. 1923". */
const SUBTITLE = /(est\.?\s*\d{3,4}|since\s*\d{3,4}|(?:19|20)\d{2})/i;
/** Venue/restaurant words that make a title-case line a subtitle, not a dish. */
const VENUE_WORDS =
  /(pub|bistro|grill|grille|caf[eé]|restaurant|kitchen|tavern|eatery|diner|brewery|est\.|establish|house|fine dining|bar\s*&|bar\s*and)/i;
/** Street address: "123 Main Street", "45 Oak Ave". */
const ADDRESS =
  /\b\d{1,5}\s+[A-Za-z]+\s+(st|ave|rd|blvd|ln|dr|way|road|street|boulevard|avenue|place|ct)\.?\b|\b\d{5}(?:-\d{4})?\b/i;
/** Phone number: "(555) 123-4567", "555-123-4567", "555.123.4567". */
const PHONE = /(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/;
/** Hours of operation. */
const HOURS =
  /\b(open|closed|daily|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|weekdays|weekends)\b/i;
const HOURS_TIME = /\b(\d{1,2}(:\d{2})?\s*(am|pm)|(?:19|20)\d{2})\b/i;
/** Delivery / ordering spam. */
const DELIVERY =
  /(uber eats|doordash|grubhub|order online|online order|delivery|take[- ]?out|curbside|pick[- ]?up|reservation|book a table|to[- ]?go|gift card|gift certificate)/i;
/** Legal / allergy boilerplate. */
const LEGAL =
  /(all rights reserved|may contain|allergen|please inform|for allergy|gluten[- ]free option|consuming raw|undercooked|copyright)/i;
/** Page markers. */
const PAGE = /\bpage\s*\d+\s*(of|\/|-)\s*\d+\b|^\s*p\.?\s*\d+\s*$/i;
/** Social media / web. */
const SOCIAL = /(@[a-z0-9_.]+|facebook\.com|instagram\.com|twitter\.com|tiktok\.com|www\.\S+|https?:\/\/\S+)/i;
/** Copyright / trademark lines: "© 2024 The Golden Fork". */
const COPYRIGHT = /[©®™]|copyright\s*\d{0,4}/i;
/** Bare "menu" filler lines. */
const MENU_FILLER = /^menu$/i;

/** Symbols-only lines: "•••", "~~~", rows of dots. */
const SYMBOLS_ONLY = /^[\W_\s]+$/;

// ── Category headers ──

const CATEGORY_KEYWORDS = new Set([
  "appetizers", "starters", "entrees", "mains", "main course", "main courses",
  "desserts", "dessert", "drinks", "beverages", "salads", "soups", "sandwiches",
  "pizza", "pasta", "tacos", "burgers", "sides", "breakfast", "lunch", "dinner",
  "brunch", "kids", "kids menu", "combos", "specials", "cocktails", "wine",
  "beer", "small plates", "sharables", "for the table", "house specialties",
  "signatures", "grill", "smoker", "raw bar", "happy hour", "sweets",
]);

function isAllCaps(text: string): boolean {
  const letters = text.replace(/[^a-zA-Z]/g, "");
  return letters.length >= 3 && text === text.toUpperCase();
}

function isCategoryHeader(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (CATEGORY_KEYWORDS.has(t)) return true;
  if (CATEGORY_KEYWORDS.has(t.replace(/s$/, ""))) return true;
  return isAllCaps(text);
}

/**
 * Classify a single trimmed line. Never throws; every line falls into
 * exactly one bucket.
 */
export function classifyLine(text: string): CleanLineKind {
  const t = text.trim();
  if (!t || SYMBOLS_ONLY.test(t)) return "noise";
  if (PRICE_ONLY.test(t)) return "price";
  if (isCategoryHeader(t)) return "header";

  // Noise detectors — checked after price/header so a priced line or an
  // all-caps section header can never be dropped.
  if (
    (SUBTITLE.test(t) && VENUE_WORDS.test(t)) ||
    ADDRESS.test(t) ||
    PHONE.test(t) ||
    (HOURS.test(t) && HOURS_TIME.test(t)) ||
    DELIVERY.test(t) ||
    LEGAL.test(t) ||
    PAGE.test(t) ||
    SOCIAL.test(t) ||
    COPYRIGHT.test(t) ||
    MENU_FILLER.test(t)
  ) {
    return "noise";
  }

  // All-caps lines that are not category headers: keep them as dishes
  // (e.g. "BURRATA", "RIB EYE") — the parser's header gate decides.
  return "dish";
}

/** True when a line is a plausible dish name to attach a split price to. */
function isAttachableName(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 3) return false;
  if (PRICE_ONLY.test(t)) return false;
  if (HAS_PRICE.test(t)) return false; // already priced — never absorb another price
  if (isAllCaps(t)) return false; // headers/venue titles must not absorb prices
  if (!/[a-zA-Z]{3,}/.test(t)) return false;
  return classifyLine(t) !== "noise";
}

/**
 * Clean raw OCR text: classify → drop noise → merge split prices →
 * rejoin in reading order.
 */
export function cleanOCRText(rawText: string): CleanResult {
  const rawLines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const dropped: string[] = [];
  const classified: Array<CleanLine & { _origIndex: number }> = [];
  const isFirstLineAllCapsVenue =
    rawLines.length >= 2 && isAllCaps(rawLines[0]) && SUBTITLE.test(rawLines[1]);

  rawLines.forEach((text, i) => {
    // All-caps venue title ("STEEL & OAK" with "Gastro Pub · Est. 2011"
    // below) is the restaurant name, not a header or dish.
    if (i === 0 && isFirstLineAllCapsVenue) {
      dropped.push(text);
      return;
    }
    const kind = classifyLine(text);
    if (kind === "noise") {
      dropped.push(text);
      return;
    }
    classified.push({ text, kind, _origIndex: i });
  });

  // Merge split prices: a price-only line directly after a dish-name line
  // becomes part of that line ("Smoked Brisket" + "$18.50" → one line).
  let merged = 0;
  const mergedLines: Array<CleanLine & { _origIndex: number }> = [];
  for (const line of classified) {
    if (line.kind === "price" && mergedLines.length > 0) {
      const prev = mergedLines[mergedLines.length - 1];
      if (prev.kind === "dish" && isAttachableName(prev.text)) {
        prev.text = `${prev.text} ${line.text}`;
        merged++;
        continue;
      }
    }
    mergedLines.push({ ...line });
  }

  // Reading order: the OCR text is already in reading order; keep it.
  const lines: CleanLine[] = mergedLines
    .sort((a, b) => a._origIndex - b._origIndex)
    .map(({ text, kind }) => ({ text, kind }));

  return {
    text: lines.map((l) => l.text).join("\n"),
    lines,
    dropped,
    merged,
  };
}
