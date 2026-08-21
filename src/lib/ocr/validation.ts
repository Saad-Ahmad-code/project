import { CATEGORY_KEYWORDS } from "./data/category-keywords";
import { isFoodRelated } from "./data/food-words";
export { isFoodRelated };
import { REAL_WORD_RE, ANY_LETTER_RE } from "./data/real-word-re";
import { CURRENCY_SYMBOLS } from "./price";

export function isNoiseLine(text: string): boolean {
  const t = text.trim();
  if (t.length < 3) return true;

  const lower = t.toLowerCase();

  if (/^(tax|tip|total|subtotal|balance|gratuity|service\s*charge)/i.test(lower)) return true;
  if (/^(phone|tel|fax|email|address|hours|open|closed)/i.test(lower)) return true;
  if (/^(order online|delivery|pickup|catering|reservation|booking|gift)/i.test(lower)) return true;
  if (/^(www\.|https?:\/\/|@)/i.test(lower)) return true;
  if (/^\d{3,}[.\-\s]?\d{3,}[.\-\s]?\d{4,}$/.test(lower)) return true;
  if (/^(mon|tue|wed|thu|fri|sat|sun)\b/i.test(lower)) return true;
  if (/^(visa|mastercard|amex|cash|credit|debit|discover)/i.test(lower)) return true;
  if (/^(wifi|password|internet)/i.test(lower)) return true;
  if (/^(minimum|minimum delivery|min order)/i.test(lower)) return true;
  if (/^(follow us|find us|connect|like us)/i.test(lower)) return true;
  if (/^(powered by|copyright|all rights|page \d+ (of|\/))/i.test(lower)) return true;

  if (/[a-z0-9][a-z0-9.-]*\.(com|org|net|io|app|me|us|co|uk|ca)(?:\/[^\s]*)?(?:\s|$)/i.test(t)) return true;

  if (/(\d{3}[.\-\s]\d{3}[.\-\s]\d{4})/.test(t)) return true;
  if (/@[a-z0-9.-]+\.[a-z]{2,}/i.test(t)) return true;

  if (/(?:follow|find|visit|connect)\s+us/i.test(t)) return true;
  if (/(?:order online|delivery|pickup|catering|delivery\s*available)/i.test(t)) return true;

  if (/^(please|thank|thanks|enjoy|welcome|ask|inquire)/i.test(lower)) return true;
  if (/(?:pay at|pay upon|counter|cashier|reception)/i.test(lower)) return true;
  if (/(?:allergen|nutrition|ingredients|contains)/i.test(lower)) return true;
  if (/^hotel\b/i.test(lower)) return true;
  // Venue taglines: "Delicious + Healthy", "Taste the Difference",
  // "Fresh & Authentic" — short non-food phrases with no price.
  if (/^(delicious|healthy|fresh|authentic|tasty|yummy|quality|premium|best|great|good)\b/i.test(lower) &&
      !/\d/.test(t) && !/[$€£¥₹₨৳]/.test(t)) return true;
  // Venue subtitle: "Gastro Pub · Est. 2011", "Since 1998", "Est. 1923".
  // Mirrors cleaner.ts SUBTITLE+VENUE_WORDS so the positional parser also
  // drops it (the cleaner only guards the text-based parsers).
  if (/(est\.?\s*\d{3,4}|since\s*\d{3,4}|(?:19|20)\d{2})/i.test(t) &&
      /(pub|bistro|grill|grille|caf[eé]|restaurant|kitchen|tavern|eatery|diner|brewery|est\.|establish|house|fine dining|bar\s*&|bar\s*and)/i.test(t)) return true;

  // Venue taglines: "COFFEE HOUSE: Good Coffee, Great Vibes", "Tog Jv:
  // Chicken Steak" — a Title-case line with a colon and no digits is a
  // venue/slogan, not a dish. Lines WITH a price ("Pizza: $10") survive
  // (the colon is part of the dish + price layout).
  if (/^[A-Za-z][^:\d]{2,40}:\s+[A-Z][a-z]/.test(t)) return true;
  if (/(good coffee|great vibes|coffee house|family restaurant|home of|taste the|best in town|since\s+\d{3,4})/i.test(t)) return true;

  if (/^(menu|menus)$/i.test(t.trim())) return true;

  if (/^(restaurant|cafe|café|bistro|grill|grille|lounge|bar|truck|house|deli)$/i.test(t.trim())) return true;

  if (/^www[a-z0-9]+(com|org|net|io|us|uk|ca)?$/i.test(t.trim()) && t.includes(".")) return false;
  if (/^www[a-z]/i.test(t.trim()) && !t.includes(".")) return true;

  const words = t.split(/\s+/);
  // Single-word Title-case items ≤3 chars are usually OCR junk ("The",
  // "And", "Est") — but never drop real food words ("Tea", "Egg", "Pie").
  if (words.length === 1 && words[0].length <= 3 && /^[A-Z][a-z]*$/.test(words[0]) && !isFoodRelated(words[0])) return true;

  if (/^[^\p{L}\p{N}]+$/u.test(t)) return true;

  const digitRatio = (t.match(/\d/g) || []).length / t.length;
  if (digitRatio > 0.5) return true;

  return false;
}

export function isHeaderLike(text: string, hasPrice: boolean, isCentered: boolean, lineWords: string[]): boolean {
  const t = text.trim().toLowerCase();
  if (hasPrice) return false;
  if (t.length < 2 || t.length > 80) return false;

  if (CATEGORY_KEYWORDS.has(t) || CATEGORY_KEYWORDS.has(t.replace(/s$/, ""))) return true;

  if (new RegExp(`[${CURRENCY_SYMBOLS}]\\s*\\d|\\b\\d+[.,]\\d`).test(t)) return false;

  const firstWord = lineWords[0]?.toLowerCase();
  const lastWord = lineWords[lineWords.length - 1]?.toLowerCase();

  // A multi-word Title-case line whose words are ALL food-related is a DISH,
  // not a header — "Orange Juice", "Iced Tea", "Chicken Curry" are menu
  // items even though "juice"/"tea" are also category keywords. This does NOT
  // apply to all-caps venue titles ("STEEL & OAK") which must stay headers.
  const isTitleCase = text.trim() !== text.trim().toUpperCase() && /^[A-Z][a-z]/.test(text.trim());
  const allFoodRelated = isTitleCase && lineWords.length >= 2 && lineWords.every(w => isFoodRelated(w.toLowerCase()));
  if (allFoodRelated) return false;

  if (firstWord && CATEGORY_KEYWORDS.has(firstWord)) return true;
  if (lastWord && CATEGORY_KEYWORDS.has(lastWord)) return true;

  if (lineWords.length >= 2 && lineWords.length <= 5) {
    const allCategory = lineWords.every(w => CATEGORY_KEYWORDS.has(w.toLowerCase()));
    if (allCategory) return true;
  }

  if (!hasPrice && lineWords.length <= 3 && text.trim() === text.trim().toUpperCase() &&
      !lineWords.some(w => isFoodRelated(w))) {
    return true;
  }

  if (isCentered && lineWords.length <= 4 && !/\d/.test(t) && /^[A-Z]/.test(text.trim()) &&
      !lineWords.some(w => isFoodRelated(w))) return true;

  return false;
}

export function isHeaderToken(word: string): boolean {
  return /^[A-Z]{2,}$/.test(word) || CATEGORY_KEYWORDS.has(word.toLowerCase());
}

export function isHeaderCategoryLike(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    CATEGORY_KEYWORDS.has(t) ||
    CATEGORY_KEYWORDS.has(t.replace(/s$/, "")) ||
    text.trim() === text.trim().toUpperCase()
  );
}

export function categoryFromHeader(text: string): string {
  const tokens = text.trim().split(/\s+/);
  if (tokens.length >= 3 && tokens.length <= 5) {
    if (tokens.every(t => CATEGORY_KEYWORDS.has(t.toLowerCase()))) return tokens[0];
  }
  return text.trim();
}

export function isDescriptionLine(text: string): boolean {
  const t = text.toLowerCase().trim();

  if (/^(with|in|on|served|topped|drizzled|accompanied|comes|available|choice|side|and|plus|add)\b/i.test(t)) return true;

  if (/\b(gf|v|vg|df|contains|allergen|nut)\b/i.test(t)) return true;

  if (t.length > 100) return true;

  const descMarkers = ["with", "fresh", "sautéed", "roasted", "grilled", "baked", "served",
    "topped", "drizzled", "alongside", "accompanied", "choice", "side", "in", "on", "and", "plus"];
  const words = t.split(/\s+/);
  const markerCount = words.filter(w => descMarkers.includes(w)).length;
  if (markerCount >= 2 && words.length <= 10) return true;

  return false;
}

export function hasSufficientRealWords(name: string): boolean {
  const words = name.split(/\s+/);
  if (words.length === 0) return false;
  const wordLike = words.filter(w => ANY_LETTER_RE.test(w));
  if (wordLike.length === 0) return false;
  const realWords = wordLike.filter(w => REAL_WORD_RE.test(w));
  const threshold = Math.max(1, Math.ceil(wordLike.length * 0.6));
  return realWords.length >= threshold;
}

/**
 * Final junk gate for extracted dish names — catches OCR/parse artifacts that
 * the earlier stages let through (venue taglines, fused rows, K-price
 * leftovers, junk suffixes, all-caps non-food lines). Runs AFTER cleanup,
 * price extraction and merging, so it only sees the "final" name.
 *
 * Returns true when the name should be REJECTED (not a plausible dish).
 */
export function rejectJunkDish(name: string): boolean {
  const t = name.trim();
  if (t.length < 3) return true;

  // Venue tagline / slogan with a colon ("COFFEE HOUSE: Good Coffee, Great
  // Vibes", "Tog Jv: Chicken Steak"). Priced lines survive elsewhere.
  if (/^[A-Za-z][^:\d]{2,40}:\s+[A-Z][a-z]/.test(t)) return true;
  if (/(good coffee|great vibes|coffee house|family restaurant|home of|taste the|best in town)/i.test(t)) return true;
  // Short venue taglines: "Delicious + Healthy", "Fresh & Authentic".
  if (/^(delicious|healthy|fresh|authentic|tasty|yummy|quality|premium)\b/i.test(t) &&
      !/\d/.test(t) && !/[$€£¥₹₨৳]/.test(t)) return true;

  // Leftover K-price token ("Espresso 13K ANY" → "13K" survived cleanup).
  if (/\b\d{1,4}\s*[Kk]\b/.test(t)) return true;

  // Fused prices that survived the splitter ("$6 00", "$4 50").
  if (new RegExp(`[${CURRENCY_SYMBOLS}]\\s*\\d+\\s+\\d{2}\\b`).test(t)) return true;

  // Junk suffix/prefix remnants.
  if (/\s+(SOWOW|ANY)\s*$/i.test(t)) return true;
  if (/\s+DESIGNED\s+BY\b/i.test(t)) return true;
  if (/^&|^[&*+]/.test(t)) return true;

  // All-caps multi-word line with NO food words and no digits. Only 3+ words
  // ("TNEW YORK STRIP" would be caught by other rules; 2-word all-caps like
  // "ICE TEA" / "BEEF STEAK" / "MINERAL WATER" are legit dish names).
  const words = t.split(/\s+/);
  if (words.length >= 3 && t === t.toUpperCase() && !/\d/.test(t)) {
    if (!words.some(w => isFoodRelated(w))) return true;
  }

  // High digit ratio (e.g. "Faluda weer 7ETR" — digits mixed into words).
  const digits = (t.match(/\d/g) || []).length;
  if (digits > 0 && digits / t.length > 0.3) return true;

  return false;
}

export function nameTableEntry(nameText: string, category: string, layout: string): boolean {
  const t = nameText.toLowerCase().trim();
  const words = t.split(/\s+/);
  if (words.length < 2 && !isFoodRelated(t)) return false;

  const foodWords = words.filter(w => isFoodRelated(w));

  if (category.toLowerCase().includes("pizza") || category.toLowerCase().includes("dessert")) {
    return foodWords.length >= 1 || words.length >= 2;
  }

  if (layout === "fastfood") return foodWords.length >= 1;

  return foodWords.length > 0;
}

export function classifyMenu(lines: { hasPrice: boolean; text: string }[]): string {
  if (lines.length === 0) return "unknown";

  const priceCount = lines.filter(l => l.hasPrice).length;
  const priceRatio = priceCount / lines.length;
  const avgTextLength = lines.reduce((s, l) => s + l.text.length, 0) / lines.length;

  if (priceRatio < 0.15) return "fastfood";
  if (avgTextLength > 45) return "descriptive";
  if (avgTextLength < 25) return "compact";
  return "unknown";
}

export function classifyMenuText(rawText: string): { priceRatio: number; avgLineLen: number } {
  const lines = rawText.split(/\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { priceRatio: 0, avgLineLen: 0 };

  let priceLines = 0;
  let totalLen = 0;
  for (const line of lines) {
    if (new RegExp(`[${CURRENCY_SYMBOLS}]\\s*\\d`).test(line) || /\d+\.\d{2}/.test(line)) priceLines++;
    totalLen += line.length;
  }

  return { priceRatio: priceLines / lines.length, avgLineLen: totalLen / lines.length };
}

export function computeConfidence(
  hasPrice: boolean,
  nameText: string,
  category: string,
  isCentered: boolean,
  isAllCaps: boolean,
  layout: string
): number {
  let score = 0;

  if (hasPrice) score += 0.4;

  const words = nameText.toLowerCase().split(/\s+/);
  const foodWords = words.filter(w => isFoodRelated(w));
  score += Math.min(foodWords.length * 0.15, 0.35);

  if (category) score += 0.15;

  if (words.length >= 2 && words.length <= 6) score += 0.1;
  else if (words.length > 8) score -= 0.15;

  if (isAllCaps && !hasPrice) score -= 0.15;

  if (/\d/.test(nameText) && !nameText.match(/\d+\.\d{2}/)) score -= 0.1;

  if (nameText.length < 5) score -= 0.1;

  const genericWords = ["the", "and", "with", "for", "our", "all", "your", "from"];
  const genericCount = words.filter(w => genericWords.includes(w)).length;
  if (genericCount > words.length * 0.5) score -= 0.2;

  if (isCentered) score -= 0.1;

  if (layout === "fastfood" && !hasPrice) score -= 0.1;
  if (layout === "descriptive" && words.length <= 3) score += 0.1;

  return Math.max(0, Math.min(1, score));
}

export function dynamicThreshold(dishes: { confidence: number; price?: number }[]): number {
  if (dishes.length === 0) return 0.3;

  const confidences = dishes.map(d => d.confidence).sort((a, b) => a - b);
  const median = confidences[Math.floor(confidences.length / 2)];
  const mean = confidences.reduce((a, b) => a + b, 0) / confidences.length;
  const priceRatio = dishes.filter(d => d.price !== undefined).length / dishes.length;

  if (dishes.length <= 3) return 0.2;
  if (priceRatio > 0.7) return Math.max(0.35, mean * 0.7);
  if (priceRatio < 0.2) return Math.min(0.25, median * 0.8);
  return Math.max(0.2, mean * 0.6);
}

export function guessCategory(name: string): string {
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