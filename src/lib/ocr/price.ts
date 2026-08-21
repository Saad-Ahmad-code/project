/** Currency symbols used across the OCR pipeline (no brackets — embed inside a character class).
 *  Covers $ € £ ¥ ₹ ₨ ৳ ₩ ₺ ₽ ¢ plus many more international currency symbols.
 *  `%` is included because OCR commonly misreads ₹/₨/$ as `%` (e.g. "₹320" → "%320"),
 *  and a leading `%` before digits is never legitimate dish text. */
export const CURRENCY_SYMBOLS = "$€£¥₹₨৳₩₺₽¢฿₫₪₦₱₲₴₸₾₼%きか#";

export interface PriceResult {
  price: number;
  raw: string;
  position: "trailing" | "next_line" | "right_aligned" | "standalone" | "left_side";
}

export function normalizePrice(raw: string): number | null {
  let s = raw.trim();

  // NOTE: the class MUST include "." — script-font OCR emits ".$9,00....."
  // (leading dot + dotted leader), and stripping it is what lets the
  // comma-decimal conversion below see "9,00" instead of ".9,00".
  s = s.replace(new RegExp(`^[${CURRENCY_SYMBOLS}Rs.\\s]+`, "i"), "");
  s = s.replace(new RegExp(`[${CURRENCY_SYMBOLS}.\\s]+$`, "i"), "");

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
    if (num < 1000) {
      // Leading zero + small value: likely a currency glyph bled into the
      // digits ("き100" → "0012"). Try stripping the leading 0.
      if (s.startsWith("0") && s.length <= 4 && num < 100) {
        const stripped = normalizePrice(s.slice(1));
        if (stripped !== null && stripped >= 5 && stripped < 2000) return stripped;
      }
      return num;
    }
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

/**
 * Recover a price from a pure-digit token where the currency symbol was
 * OCR-dropped AND leading digits are corrupted by the symbol fusion.
 *
 * Pattern: Tesseract reads "き200" as "200" (symbol dropped cleanly) — that's
 * fine, the normal path handles it. But sometimes the symbol bleeds into
 * digits: "き100" → "0012" (き→0, 1→0, 0→1, 0→2) or "き90" → "092".
 *
 * Heuristic: when a digit-only token is 3-4 chars, starts with 0 (never a
 * real price leader), and the result is < 100 (implausibly small for most
 * menus), retry by stripping the first digit — the leading 0 almost
 * always came from the dropped currency glyph. Returns the recovered value
 * or null (fall through to normal parsing).
 */
function recoverFusedPrice(token: string): number | null {
  if (!/^\d{3,4}$/.test(token)) return null;
  if (!token.startsWith("0")) return null;
  const normal = normalizePrice(token);
  if (normal !== null && normal >= 10) return null; // plausible, don't override
  // Strip one leading 0 (the OCR-buried currency glyph) and retry
  const stripped = token.slice(1);
  const recovered = normalizePrice(stripped);
  if (recovered !== null && recovered >= 5 && recovered < 2000) return recovered;
  return null;
}

export function findPriceInText(text: string): PriceResult | null {
  const t = text.trim();

  // 4-digit trailing price with leading zero: "Fruit Salad 0012" where
  // き100→0012 (symbol fused into 4 digits). The normal trailing regex only
  // matches 1-3 digits, so we handle 4-digit leading-zero tokens specially.
  const trailing4 = t.match(/(?:^|\s)(\d{4})[\s.]*$/);
  if (trailing4) {
    const raw = trailing4[1];
    if (raw.startsWith("0") && raw.length === 4) {
      const n = parseInt(raw, 10);
      if (n > 0 && n < 120) {
        // Likely き100→0012, き90→0092, き50→0052 etc. Try recovering by
        // stripping the leading 0 and taking the last 3 digits as price.
        const stripped = raw.slice(1);
        const candidate = parseInt(stripped, 10);
        if (candidate >= 10 && candidate < 2000) {
          return { price: candidate, raw: raw, position: "trailing" };
        }
      }
    }
  }

  // Currency-digit fusion: OCR misreads a currency symbol as a DIGIT, fusing
  // it onto the price ("₹240" → "3240", "₨450" → "5450"). When a trailing
  // 4-5 digit number is >= 2000 (never a valid menu price) AND its last 3
  // digits form a plausible price (< 2000), the leading digit(s) are the
  // misread symbol — take the last 3 digits as the price.
  // Years (1900-2099) are excluded — "Est. 2011" must never read as price 11.
  const fused = t.match(/(?:^|\s)(\d{1,2})(\d{3})[\s.]*$/);
  if (fused) {
    const full = parseInt(fused[0].trim(), 10);
    const last3 = parseInt(fused[2], 10);
    if (full >= 2000 && last3 > 0 && last3 < 2000 && !(full >= 1900 && full <= 2099)) {
      return { price: last3, raw: fused[1] + fused[2], position: "trailing" };
    }
  }

  // K-prices matched ANYWHERE — a K-token buried mid-name is still a price
  // token (e.g. "Espresso 13K ANY" → strips to "Espresso"). Trailing K-token
  // reads as the trailing price; mid-name tokens are stripped by cleanup.
  const kToken = t.match(new RegExp(`(?:^|\\s)([${CURRENCY_SYMBOLS}RsSs.]+\\s*)?(\\d{1,4})\\s*[Kk]\\b`));
  if (kToken) {
    const n = kPriceValue(kToken[0]);
    if (n !== null) {
      return { price: n, raw: kToken[0].trim(), position: "trailing" };
    }
  }

  const trailing = t.match(new RegExp(`(?:^|\\s)([${CURRENCY_SYMBOLS}RsSs.]+)?(\\d{1,3}(?:[.,]\\d{1,2})?|\\d{1,3}\\s+\\d{2})[\\s.]*$`));
  if (trailing) {
    const price = normalizePrice(trailing[0]);
    if (price !== null && price < 2000) {
      // If a digit-only token (no currency symbol) normalised to a very
      // small number, the currency glyph may have been OCR-buried in front
      // of the digits (e.g. "0012" from き100, "092" from き90). Try recovery.
      if (!/[₹¨%฿៛₦₱₲₴₸₾₼€£¥₨৳₩₺₽]/.test(trailing[0]) && /0\d{2}/.test(trailing[0]) && price < 100) {
        const recovered = recoverFusedPrice(trailing[0].trim().replace(/[^0-9]/g, ""));
        if (recovered !== null) return { price: recovered, raw: trailing[0].trim(), position: "trailing" };
      }
      return { price, raw: trailing[0].trim(), position: "trailing" };
    }
  }

  // Trailing misread-rupee price: "Cheeseburger キ200" / "Coffee Z90".
  // Handled separately because キ/Z are not in CURRENCY_SYMBOLS (き is).
  // The bare-digit fallback in the trailing regex above already reads the
  // digits, but this branch keeps `raw` faithful to what OCR emitted.
  const trailingMisread = t.match(/(?:^|\s)(?:[きキZz])(\d{2,4})[\s.]*$/);
  if (trailingMisread) {
    const n = parseInt(trailingMisread[1], 10);
    if (!isNaN(n) && n > 0 && n < 2000) {
      return { price: n, raw: trailingMisread[0].trim(), position: "trailing" };
    }
  }

  const leading = t.match(new RegExp(`^[${CURRENCY_SYMBOLS}Rs.]+(\\d{1,3}(?:[.,]\\d{1,2})?)\\s+`));
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
  const k = word.match(new RegExp(`^[${CURRENCY_SYMBOLS}RsSs.]*(\\d{1,4})[Kk]$`, "i"));
  if (k) {
    const n = kPriceValue(k[0]);
    if (n !== null) return { price: n, raw: k[0].trim(), position: "standalone" };
  }

  // OCR-misread-rupee token: "キ250" / "Z100" (Tesseract's guesses for the ₹
  // glyph; き is already in CURRENCY_SYMBOLS). A [symbol][digits] token with
  // no letters is a price, never a dish name.
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
  // merged-row splitter can separate the dishes. EXCLUDES 19xx/20xx — those
  // are years ("Est. 2011"), not prices.
  const fourDigit = word.match(/^(?:[きキ]|[Zz]|[$€£¥₹]|Rs\.?)?(\d{4})$/i);
  if (fourDigit) {
    const n = parseInt(fourDigit[1], 10);
    const isYear = /^(19|20)\d{2}$/.test(fourDigit[1]);
    if (!isNaN(n) && n > 0 && !isYear) {
      return { price: n, raw: word.trim(), position: "standalone" };
    }
  }

  const m = word.match(new RegExp(`^[${CURRENCY_SYMBOLS}Rs.]+(\\d{1,3}(?:[.,]\\d{1,2})?)$`, "i"));
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
    if (new RegExp(`[${CURRENCY_SYMBOLS}]\\s*\\d|\\b\\d{1,3}[.,]\\d{1,2}\\b`).test(line)) n++;
  }
  return n;
}