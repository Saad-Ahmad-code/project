import Tesseract from "tesseract.js";

export interface LocalOCRItem {
  name: string;
  description?: string;
  price?: number;
  category?: string;
}

export async function runLocalOCR(file: File): Promise<{ raw_text: string; items: LocalOCRItem[] }> {
  const result = await Tesseract.recognize(file, "eng", {
    logger: (m) => {
      if (m.status === "recognizing text") {
        // progress can be used if needed
      }
    },
  });

  const raw_text = result.data.text || "";
  const items = extractDishesFromText(raw_text);

  return { raw_text, items };
}

function extractDishesFromText(raw_text: string): LocalOCRItem[] {
  const lines = raw_text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 1);

  const items: LocalOCRItem[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const cleaned = line.replace(/[|]/g, " ").replace(/\s+/g, " ").trim();
    const priceMatch = cleaned.match(/(?:\$\s*)?(\d{1,2}(?:\.\d{1,2})?)\s*$/);
    const hasLetters = /[a-zA-Z]/.test(cleaned);
    const wordCount = cleaned.split(/\s+/).length;

    if (
      hasLetters &&
      wordCount >= 2 &&
      wordCount <= 25 &&
      !isNoiseLine(cleaned) &&
      !isSectionHeader(cleaned) &&
      !isFooterLine(cleaned)
    ) {
      const name = priceMatch ? cleaned.slice(0, priceMatch.index).trim() : cleaned;
      const normalized = name.toLowerCase();

      if (normalized.length < 3 || seen.has(normalized)) continue;
      if (!/[a-zA-Z]{3,}/.test(name)) continue;

      seen.add(normalized);

      items.push({
        name: name.slice(0, 200),
        description: "",
        price: priceMatch ? parseFloat(priceMatch[1]) : undefined,
        category: guessCategory(name),
      });
    }
  }

  return items.slice(0, 50);
}

function isNoiseLine(line: string): boolean {
  const noisePatterns = [
    /^(tax|tip|total|subtotal|balance|gratuity)\b/i,
    /^(phone|tel|fax|email|address|hours|open|closed)\b/i,
    /^(order|delivery|pickup|catering|reservation|booking|gift)\b/i,
    /^(www\.|https?:\/\/|@)/i,
    /^\d{3,}[.\-\s]?\d{3,}[.\-\s]?\d{4,}$/,
    /^(mon|tue|wed|thu|fri|sat|sun)\b/i,
    /^(visa|mastercard|amex|cash|credit|debit)/i,
    /^(wifi|password|internet)/i,
    /^(minimum|minimum delivery)/i,
    /^follow us|^find us|^connect/i,
    /^powered by|^copyright|^all rights|^page \d+ (of|\/)/i,
    /(?:^|\s)(?:www\.|[a-z0-9.-]+\.(?:com|org|net|io|app|me|us|co|uk|ca)\b)/i,
  ];

  if (noisePatterns.some((p) => p.test(line))) return true;

  const words = line.split(/\s+/);
  const garbageWords = ["page", "menu", "our", "the", "and", "with", "for", "from"];
  const garbageHits = words.filter((w) => garbageWords.includes(w.toLowerCase())).length;
  if (garbageHits > words.length * 0.6 && words.length <= 3) return true;

  // Reject lines containing a common domain pattern anywhere (e.g. "Visit menulens.com")
  if (/[a-z0-9][a-z0-9.-]*\.(com|org|net|io|app|me|us|co|uk|ca)(?:\/[^\s]*)?(?:\s|$)/i.test(line)) return true;

  // Reject short lines that look like proper branding (capitalized, no price)
  if (words.length <= 2 && !/\d/.test(line) && /^[A-Z][a-z]+('s?[A-Z][a-z]+)*$/.test(line.trim())) return true;

  return false;
}

function isSectionHeader(line: string): boolean {
  const sectionKeywords = [
    "appetizers", "starters", "soups", "salads", "entrees", "mains",
    "main course", "desserts", "drinks", "beverages", "specials", "combos",
    "sides", "children", "kids", "lunch", "dinner", "breakfast", "brunch",
    "pizza", "pasta", "wraps", "sandwiches", "burgers",
  ];
  const lower = line.toLowerCase();
  if (sectionKeywords.some((kw) => lower === kw || lower.startsWith(kw + " ") || lower.endsWith(" " + kw))) {
    return true;
  }
  return false;
}

function isFooterLine(line: string): boolean {
  return (
    /(\d{3}[.\-\s]\d{3}[.\-\s]\d{4})/.test(line) ||
    /@[a-z0-9.-]+\.[a-z]{2,}/i.test(line) ||
    /(?:follow|find|visit|connect)\s+us/i.test(line) ||
    /(?:order online|delivery|pickup|catering|delivery\s+available)/i.test(line)
  );
}

function guessCategory(name: string): string {
  const lower = name.toLowerCase();
  if (/\b(pizza|pasta|spaghetti|lasagna|ravioli|penne|fettuccine)\b/.test(lower)) return "pasta";
  if (/\b(salad|caesar|greek|garden)\b/.test(lower)) return "salad";
  if (/\b(soup|chowder|bisque|stew)\b/.test(lower)) return "soup";
  if (/\b(burger|sandwich|wrap|sub|hoagie)\b/.test(lower)) return "sandwich";
  if (/\b(steak|rib|chop|wings|tenders)\b/.test(lower)) return "entree";
  if (/\b(cake|pie|ice cream|sundae|tiramisu|pudding)\b/.test(lower)) return "dessert";
  if (/\b(water|soda|juice|coffee|tea|milk|shake|smoothie|beer|wine|cocktail)\b/.test(lower)) return "drink";
  return "other";
}
