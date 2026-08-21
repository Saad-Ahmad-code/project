import { cleanDishName } from "./name-cleanup";
import { correctOCRErrors } from "./data/ocr-corrections";
import { normalizePrice, findPriceInWord, CURRENCY_SYMBOLS } from "./price";
import { isNoiseLine, isDescriptionLine, hasSufficientRealWords, isFoodRelated } from "./validation";

export const DISH_PREFIX_WORDS =
  /^(extra|serves?|for|with|choice|add|plus|and|side|to|feeds?|serving|one|two|three|four|half|full|large|small|medium|regular|double|kids?|choose|ask|please)\b/i;

export function splitMergedDishLine(name: string, trailingPrice?: number): { name: string; price?: number }[] | null {
  const m = name.match(
    new RegExp(`^(.*?)\\s+([${CURRENCY_SYMBOLS}]\\s*\\d+(?:[.,]\\d{1,2}|\\s+\\d{2})?|\\d+[.,]\\d{1,2}|\\d+\\s+\\d{2}|\\d{2,3})\\s+([A-Za-z0-9${CURRENCY_SYMBOLS}][A-Za-z0-9${CURRENCY_SYMBOLS}&'-]*(\\s+[A-Za-z0-9${CURRENCY_SYMBOLS}][A-Za-z0-9${CURRENCY_SYMBOLS}&'-]*)*)$`)
  );
  if (!m) return null;
  const firstRaw = m[1].trim();
  const secondRaw = m[3].trim();
  if (!firstRaw || !secondRaw) return null;

  const first = cleanDishName(firstRaw);
  const second = cleanDishName(secondRaw);
  const midPrice = normalizePrice(m[2].replace(/\s+(\d{2})$/, ".$1"));
  if (midPrice === null || midPrice < 1 || midPrice >= 2000) return null;

  const firstWords = first.split(/\s+/).filter(Boolean);
  const secondWords = second.split(/\s+/).filter(Boolean);
  const firstOk =
    first.length >= 3 &&
    !isNoiseLine(first) &&
    !isDescriptionLine(first) &&
    !DISH_PREFIX_WORDS.test(first) &&
    hasSufficientRealWords(first) &&
    // Any food-related word in the first segment is enough — "Classic Milk
    // Cake" (Cake) or "Smoked Brisket" (Smoked) both qualify; requiring the
    // FIRST word to be food dropped legit rows like "Classic Milk Cake $6 00 …".
    (firstWords.some(isFoodRelated) || first === first.toUpperCase());
  const secondOk =
    second.length >= 3 &&
    !isNoiseLine(second) &&
    !isDescriptionLine(second) &&
    !DISH_PREFIX_WORDS.test(second) &&
    // Relaxed real-word gate for the second segment: short connectors
    // ("Soda IN A Bottle") fail the 60% gate despite being a legit dish, so
    // a food-related word OR sufficient real words is enough.
    (hasSufficientRealWords(second) || secondWords.some(isFoodRelated)) &&
    (secondWords.length >= 2 || isFoodRelated(second) || second === second.toUpperCase());
  if (!firstOk || !secondOk) return null;

  const secondPrice = trailingPrice !== undefined && trailingPrice !== midPrice ? trailingPrice : undefined;
  return [
    { name: correctOCRErrors(first).slice(0, 200), price: midPrice },
    { name: correctOCRErrors(second).slice(0, 200), ...(secondPrice !== undefined ? { price: secondPrice } : {}) },
  ];
}

interface MergedItem {
  name: string;
  price?: number;
  category?: string;
  description?: string;
}

export function splitMergedItemsFallback(items: MergedItem[]): MergedItem[] {
  const out: MergedItem[] = [];
  for (const item of items) {
    let pending: MergedItem[] = [item];
    for (let depth = 0; depth < 3; depth++) {
      const next: MergedItem[] = [];
      let splitThisRound = false;
      for (const p of pending) {
        const split = p.name ? splitMergedDishLine(p.name, p.price) : null;
        if (split) {
          next.push({ ...p, ...split[0] }, { ...p, ...split[1] });
          splitThisRound = true;
        } else {
          next.push(p);
        }
      }
      pending = next;
      if (!splitThisRound) break;
    }
    out.push(...pending);
  }
  return out;
}

export function splitMultiPriceRow(words: { text: string; x: number; y: number; w: number; h: number; confidence: number }[], imgWidth: number): { text: string; x: number; y: number; w: number; h: number; confidence: number }[][] {
  // Price detection must mirror the ORIGINAL pipeline: findPriceInWord handles
  // "$4.50", "$3", "€12,5" etc. A bare /^\d+$/ regex misses decimal prices
  // ("$4.50" → not matched → row with two columns' dishes stays fused).
  const priceIdx = words
    .map((w, i) => (findPriceInWord(w.text) ? i : -1))
    .filter((i) => i >= 0);
  if (priceIdx.length < 2) return [words];

  const text = words.map((w) => w.text).join(" ");
  if (/(Small|Regular|Single|Large|Double|Medium|Kids?)\s+[$€£¥]?\s*\d/.test(text) && text.includes("/")) {
    return [words];
  }

  const cuts = new Set<number>();
  for (let i = 0; i < priceIdx.length - 1; i++) {
    const pi = priceIdx[i];
    const nxt = words[pi + 1];
    const gap = nxt ? nxt.x - (words[pi].x + words[pi].w) : -1;
    if (gap > Math.max(imgWidth * 0.08, 60) && !DISH_PREFIX_WORDS.test(nxt?.text ?? "")) {
      cuts.add(pi + 1);
    }
  }
  if (cuts.size === 0) return [words];

  const segments: { text: string; x: number; y: number; w: number; h: number; confidence: number }[][] = [];
  let start = 0;
  for (let i = 0; i <= words.length; i++) {
    if (i === words.length || cuts.has(i)) {
      segments.push(words.slice(start, i));
      start = i;
    }
  }
  if (segments.length < 2) return [words];
  if (!segments.every((s) => s.length > 0 && /[A-Za-z]/.test(s[0].text))) return [words];
  return segments;
}