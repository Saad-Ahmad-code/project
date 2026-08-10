export interface PriceResult {
  price: number;
  raw: string;
  position: "trailing" | "next_line" | "right_aligned" | "standalone" | "left_side";
}

/** Currency symbols the price recognizer accepts. Includes the Indian rupee
 *  `₹` (U+20B9) and common OCR misreads of it: `Rs`/`rs`, and the CJK
 *  katakana `き`/`キ` that Tesseract emits when it cannot classify the rupee
 *  glyph. When one of these precedes a number, it is treated as a price. */
const CURRENCY = "$€£¥₹RsSs৳";

export function normalizePrice(raw: string): number | null {
  let s = raw.trim();

  // NOTE: the leading class MUST include "." — script-font OCR emits
  // ".$9,00....." (leading dot + dotted leader), and stripping it is what
  // lets the comma-decimal conversion below see "9,00" instead of ".9,00".
  s = s.replace(new RegExp(`^[${CURRENCY}.\\s]+`, "i"), "");
  s = s.replace(new RegExp(`[${CURRENCY}.\\s]+$`, "i"), "");

  if (/^\d{1,3},\d{1,2}$/.test(s)) {
    s = s.replace(",", ".");
  }

  s = s.replace(/[,]/g, "");
  s = s.replace(/[\/-]\s*$/, "");
  s = s.replace(/[^\d.,]/g, "");

  if (!s) return null;

  if (s.includes(",") && !s.includes(".")) {
    s = s.replace(",", ".");
  }

  if (s.length >= 4 && !s.includes(".")) {
    const num = parseInt(s, 10);
    if (num < 1000) return num;
    const cents = parseInt(s.slice(-2), 10);
    const whole = parseInt(s.slice(0, -2), 10);
    if (cents < 100 && whole < 200 && cents >= 0) {
      return parseFloat(whole + "." + cents.toString().padStart(2, "0"));
    }
    return num;
  }

  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/** K-price token: "13K", "21K", "৳25K" → value × 1000 (South-Asian menus
 *  quote prices in thousands). Returns the numeric value or null. */
function kPriceValue(token: string): number | null {
  const m = token.match(/(\d{1,4})\s*[Kk]/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n > 0 && n < 2000 ? n * 1000 : null;
}

export function findPriceInText(text: string): PriceResult | null {
  const t = text.trim();

  // K-prices matched ANYWHERE — a K-token buried mid-name is still a price
  // token (e.g. "Espresso 13K ANY" → strips to "Espresso"). Trailing K-token
  // reads as the trailing price; mid-name tokens are stripped by cleanup.
  const kToken = t.match(new RegExp(`(?:^|\\s)([${CURRENCY}.]+\\s*)?(\\d{1,4})\\s*[Kk]\\b`));
  if (kToken) {
    const n = kPriceValue(kToken[0]);
    if (n !== null) {
      return { price: n, raw: kToken[0].trim(), position: "trailing" };
    }
  }

  // Trailing price: "Dish ₹250", "Dish S250", "Dish き250", "Dish 250".
  // The `[currency]?` group is optional so a bare trailing number reads too,
  // but the token must START with a digit (never a lone symbol).
  const trailing = t.match(new RegExp(`(?:^|\\s)(?:[${CURRENCY}.]+)?(\\d{1,3}(?:[.,]\\d{1,2})?|\\d{1,3}\\s+\\d{2})[\\s.]*$`));
  if (trailing) {
    const price = normalizePrice(trailing[0]);
    if (price !== null && price < 2000) {
      return { price, raw: trailing[0].trim(), position: "trailing" };
    }
  }

  // Trailing misread-rupee price: "Cheeseburger き200" / "Coffee Z90".
  // Handled separately because き/キ/Z are not in the CURRENCY class.
  const trailingMisread = t.match(/(?:^|\s)(?:[きキZz])(\d{2,4})[\s.]*$/);
  if (trailingMisread) {
    const n = parseInt(trailingMisread[1], 10);
    if (!isNaN(n) && n > 0 && n < 2000) {
      return { price: n, raw: trailingMisread[0].trim(), position: "trailing" };
    }
  }

  // Trailing 4-digit price (rupee-misread): "Nuggets 2300", "Fruit Salad 0012".
  // BUT a 4-digit year after Est./Since/© is a venue subtitle, not a price —
  // "Gastro Pub · Est. 2011" must not become "Gastro Pub" $2011.
  const trailingFour = t.match(/(?:^|\s)(\d{4})[\s.]*$/);
  if (trailingFour && !/(est\.?|since|©|copyright|established)\s*\d{4}/i.test(t)) {
    const n = parseInt(trailingFour[1], 10);
    if (!isNaN(n) && n > 0) {
      return { price: n, raw: trailingFour[0].trim(), position: "trailing" };
    }
  }

  const leading = t.match(new RegExp(`^[${CURRENCY}.]+(\\d{1,3}(?:[.,]\\d{1,2})?)\\s+`));
  if (leading) {
    const price = normalizePrice(leading[0]);
    if (price !== null && price < 2000) {
      return { price, raw: leading[0].trim(), position: "left_side" };
    }
  }

  return null;
}

export function findPriceInWord(word: string): PriceResult | null {
  // K-prices: "13K", "21K"
  const k = word.match(new RegExp(`^[${CURRENCY}.]*(\\d{1,4})[Kk]$`, "i"));
  if (k) {
    const n = kPriceValue(k[0]);
    if (n !== null) return { price: n, raw: k[0].trim(), position: "standalone" };
  }

  // OCR-misread-rupee token: "き250" (katakana for the ₹ glyph), "Z100"
  // (Tesseract's 1-char guess for ₹). The symbol is not in CURRENCY, so it
  // needs an explicit branch — a [symbol][digits] token with no letters is a
  // price, never a dish name.
  const misread = word.match(/^(?:[きキ]|[Zz])(\d{2,4})$/);
  if (misread) {
    const n = parseInt(misread[1], 10);
    if (!isNaN(n) && n > 0 && n < 2000) {
      return { price: n, raw: word.trim(), position: "standalone" };
    }
  }

  // 4-digit rupee-misread token: "2300", "0012", "き2300" — OCR digit
  // misreads of ₹300/₹120 (the leading digit is often wrong). These are
  // real prices on rupee menus; the <2000 guard is relaxed for them so the
  // merged-row splitter can separate the dishes. The value is approximate
  // but the split is what matters. EXCLUDES 19xx/20xx — those are years
  // (venue subtitles "Est. 2011"), not prices.
  const fourDigit = word.match(/^(?:[きキ]|[Zz]|[$€£¥₹]|Rs\.?)?(\d{4})$/i);
  if (fourDigit) {
    const n = parseInt(fourDigit[1], 10);
    const isYear = /^(19|20)\d{2}$/.test(fourDigit[1]);
    if (!isNaN(n) && n > 0 && !isYear) {
      return { price: n, raw: word.trim(), position: "standalone" };
    }
  }

  const m = word.match(new RegExp(`^[${CURRENCY}.]+(\\d{1,3}(?:[.,]\\d{1,2})?)$`, "i"));
  if (m) {
    const price = normalizePrice(m[0]);
    if (price !== null && price < 2000) {
      return { price, raw: m[0].trim(), position: "standalone" };
    }
  }
  return null;
}

export function countPriceLines(text: string): number {
  if (!text) return 0;
  let n = 0;
  for (const line of text.split("\n")) {
    if (new RegExp(`[${CURRENCY}]\\s*\\d|\\b\\d{1,3}[.,]\\d{1,2}\\b`).test(line)) n++;
  }
  return n;
}
