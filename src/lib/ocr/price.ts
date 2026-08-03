export interface PriceResult {
  price: number;
  raw: string;
  position: "trailing" | "next_line" | "right_aligned" | "standalone" | "left_side";
}

export function normalizePrice(raw: string): number | null {
  let s = raw.trim();

  s = s.replace(/^[$€£¥Rs.\s]+/i, "");
  s = s.replace(/[$€£¥.\s]+$/i, "");

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

export function findPriceInText(text: string): PriceResult | null {
  const t = text.trim();

  const trailing = t.match(/(?:^|\s)([$€£¥RsSs.]+\s*)?(\d{1,3}(?:[.,]\d{1,2})?|\d{1,3}\s+\d{2})[\s.]*$/);
  if (trailing) {
    const price = normalizePrice(trailing[0]);
    if (price !== null && price < 2000) {
      return { price, raw: trailing[0].trim(), position: "trailing" };
    }
  }

  const leading = t.match(/^[$€£¥Rs.]+\s*(\d{1,3}(?:[.,]\d{1,2})?)\s+/);
  if (leading) {
    const price = normalizePrice(leading[0]);
    if (price !== null && price < 2000) {
      return { price, raw: leading[0].trim(), position: "left_side" };
    }
  }

  return null;
}

export function findPriceInWord(word: string): PriceResult | null {
  const m = word.match(/^[$€£¥Rs.]+\s*(\d{1,3}(?:[.,]\d{1,2})?)$/i);
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
    if (/[$€£¥]\s*\d|\b\d{1,3}[.,]\d{1,2}\b/.test(line)) n++;
  }
  return n;
}