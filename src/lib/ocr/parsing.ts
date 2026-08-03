import { CATEGORY_KEYWORDS } from "./data/category-keywords";
import { isFoodRelated } from "./data/food-words";
import { isNoiseLine, isHeaderLike, isDescriptionLine, hasSufficientRealWords, nameTableEntry, classifyMenu, classifyMenuText, computeConfidence, dynamicThreshold, guessCategory, isHeaderToken, isHeaderCategoryLike, categoryFromHeader } from "./validation";
import { findPriceInText, findPriceInWord, PriceResult } from "./price";
import { cleanDishName } from "./name-cleanup";
import { correctOCRErrors } from "./data/ocr-corrections";
import { detectColumns, isCentered } from "./columns";
import { splitMultiPriceRow, DISH_PREFIX_WORDS } from "./merged-split";
import { cleanOCRText } from "./cleaner";

interface WordPos {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
}

interface TextLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  words: WordPos[];
  hasPrice: boolean;
  price?: number;
  priceEndX: number;
  isCentered: boolean;
  isAllCaps: boolean;
  isHeader: boolean;
}

interface Column {
  lines: TextLine[];
  xMin: number;
  xMax: number;
}

interface ParagraphInfo {
  text: string;
  words: WordPos[];
  lines: TextLine[];
}

interface ParsedDish {
  name: string;
  description?: string;
  price?: number;
  category?: string;
  confidence: number;
  sourceIndex: number;
}

export interface LocalOCRItem {
  name: string;
  description?: string;
  price?: number;
  category?: string;
}

interface TesseractPara {
  text?: string;
  lines?: Array<{ text?: string; words?: Array<{ text?: string; bbox?: { x0: number; y0: number; x1: number; y1: number }; confidence?: number }> }>;
  words?: Array<{ text?: string; bbox?: { x0: number; y0: number; x1: number; y1: number }; confidence?: number }>;
}

export function groupIntoLines(words: WordPos[]): TextLine[] {
  if (words.length === 0) return [];

  const sorted = [...words].sort((a, b) => {
    const yDiff = a.y - b.y;
    if (Math.abs(yDiff) > 8) return yDiff;
    return a.x - b.x;
  });

  const lineGroups: WordPos[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (Math.abs(curr.y - prev.y) <= 10) {
      lineGroups[lineGroups.length - 1].push(curr);
    } else {
      lineGroups.push([curr]);
    }
  }

  const lines: TextLine[] = [];
  const imgWidth = Math.max(...words.map(w => w.x + w.w), 1);

  for (const group of lineGroups) {
    if (group.length === 0) continue;

    const splitIdx: number[] = [];
    for (let i = 0; i < group.length - 1; i++) {
      const gap = group[i + 1].x - (group[i].x + group[i].w);
      if (gap > Math.max(imgWidth * 0.15, 80) && isHeaderToken(group[i].text) && isHeaderToken(group[i + 1].text)) {
        splitIdx.push(i + 1);
      }
    }
    const segments: WordPos[][] = [];
    let segStart = 0;
    for (const idx of [...splitIdx, group.length]) {
      segments.push(group.slice(segStart, idx));
      segStart = idx;
    }

    for (const seg of segments) {
      if (seg.length === 0) continue;
      const subSegments = splitMultiPriceRow(seg, imgWidth);
      for (const subSeg of subSegments) {
        if (subSeg.length === 0) continue;
        const text = subSeg.map(w => w.text).join(" ").trim();
        if (!text) continue;

        const minX = Math.min(...subSeg.map(w => w.x));
        const minY = Math.min(...subSeg.map(w => w.y));
        const maxX = Math.max(...subSeg.map(w => w.x + w.w));
        const maxY = Math.max(...subSeg.map(w => w.y + w.h));

        let hasPrice = false;
        let price: number | undefined;
        let priceEndX = 0;

        for (let w = subSeg.length - 1; w >= Math.max(0, subSeg.length - 3); w--) {
          const pr = findPriceInWord(subSeg[w].text);
          if (pr) {
            hasPrice = true;
            price = pr.price;
            priceEndX = subSeg[w].x + subSeg[w].w;
            break;
          }
        }

        if (!hasPrice) {
          const pr = findPriceInText(text);
          if (pr && pr.position === "trailing") {
            hasPrice = true;
            price = pr.price;
            priceEndX = maxX;
          }
        }

        const lineWords = text.split(/\s+/);
        const midX = minX + (maxX - minX) / 2;
        const isCenteredVal = isCentered(minX, maxX, imgWidth);
        const isAllCaps = text === text.toUpperCase() && /[A-Z]{4,}/.test(text);

        lines.push({
          text,
          x: minX,
          y: minY,
          w: maxX - minX,
          h: maxY - minY,
          words: subSeg,
          hasPrice,
          price,
          priceEndX,
          isCentered: isCenteredVal,
          isAllCaps,
          isHeader: isHeaderLike(text, hasPrice, isCenteredVal, lineWords),
        });
      }
    }
  }

  return lines;
}

export function parseColumn(column: Column): ParsedDish[] {
  const lines = column.lines;
  const dishes: ParsedDish[] = [];
  let currentCategory = "";
  let pendingDish: ParsedDish | null = null;
  let nextIndex = 0;
  let categoryLineIndex = -1;
  let seenCategoryHeader = false;
  let pendingPrice: number | undefined = undefined;

  const layout = classifyMenu(lines);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^[$€£¥]?\s*\d+(?:[.,]\d{1,2})?\s*\.*\s*$/.test(line.text.trim()) && line.price !== undefined) {
      pendingPrice = line.price;
      continue;
    }
    if (isNoiseLine(line.text)) continue;

    if (line.hasPrice) {
      pendingPrice = undefined;
    }

    if (line.isHeader) {
      const catText = line.text.trim();
      if (pendingPrice === undefined && seenCategoryHeader && catText !== catText.toUpperCase() && i + 1 < lines.length) {
        const nxt = lines[i + 1];
        if (nxt.hasPrice && nxt.price !== undefined && nxt.y - line.y < 60) {
          const cleaned = cleanDishName(catText);
          if (cleaned.length >= 3 && !isNoiseLine(cleaned) && hasSufficientRealWords(cleaned)) {
            pendingDish = {
              name: correctOCRErrors(cleaned).slice(0, 200),
              price: nxt.price,
              category: currentCategory || undefined,
              confidence: 0.6,
              sourceIndex: nextIndex++,
            };
            i += 1;
            continue;
          }
        }
      }
      if (pendingDish) { dishes.push(pendingDish); pendingDish = null; }

      if (pendingPrice !== undefined && catText !== catText.toUpperCase()) {
        const cleaned = cleanDishName(catText);
        if (cleaned.length >= 3 && !isNoiseLine(cleaned) && hasSufficientRealWords(cleaned)) {
          pendingDish = {
            name: correctOCRErrors(cleaned).slice(0, 200),
            price: pendingPrice,
            category: currentCategory || undefined,
            confidence: 0.6,
            sourceIndex: nextIndex++,
          };
        }
        pendingPrice = undefined;
        continue;
      }
      pendingPrice = undefined;

      if (!seenCategoryHeader) {
        if (!isHeaderCategoryLike(catText)) continue;
        const nxt = lines[i + 1];
        const subtitleLike =
          !!nxt && !nxt.hasPrice && !nxt.isHeader &&
          nxt.text !== nxt.text.toUpperCase() &&
          /(est\.?\s*\d{3,4}|since\s*\d{3,4}|(?:19|20)\d{2})/i.test(nxt.text);
        if (subtitleLike) continue;
      }
      seenCategoryHeader = true;
      currentCategory = categoryFromHeader(catText);
      categoryLineIndex = i;
      continue;
    }

    if (!line.hasPrice && /\d/.test(line.text)) {
      const capsKeyword = line.text
        .trim()
        .split(/\s+/)
        .find(w => w.length >= 3 && w === w.toUpperCase() && CATEGORY_KEYWORDS.has(w.toLowerCase()));
      if (capsKeyword) {
        if (pendingDish) { dishes.push(pendingDish); pendingDish = null; }
        pendingPrice = undefined;
        seenCategoryHeader = true;
        currentCategory = capsKeyword;
        categoryLineIndex = i;
        continue;
      }
    }

    if (currentCategory && i - categoryLineIndex > 15) {
      currentCategory = "";
    }

    if (/^\d+(?:\.\d+)?$/.test(line.text.trim())) continue;

    const nameText = line.text.trim();
    const words = nameText.split(/\s+/).length;

    if (/(Small|Regular|Single|Large|Double|Medium)\s+[$€£¥]?\s*\d/.test(nameText)) {
      if (pendingDish) { dishes.push(pendingDish); pendingDish = null; }

      const baseName = nameText
        .replace(/(Small|Regular|Single|Large|Double|Medium|Kids?)\s+[$€£¥]?\s*\d+(?:[.,]\d+)?\s*\/?\s*/g, "")
        .trim();
      if (baseName && baseName.length > 3) {
        const prices = [...nameText.matchAll(/(\d+(?:[.,]\d{1,2})?)/g)].map(m => parseFloat(m[1].replace(",", ".")));
        const entryPrice = prices.length > 0 ? prices[0] : undefined;
        const conf = computeConfidence(true, baseName, currentCategory, line.isCentered, line.isAllCaps, layout);

        dishes.push({
          name: baseName,
          category: currentCategory || undefined,
          price: entryPrice,
          confidence: conf,
          sourceIndex: nextIndex++,
        });
      }
      continue;
    }

    if (!line.hasPrice && pendingPrice !== undefined) {
      const cleaned = cleanDishName(nameText);
      if (cleaned.length >= 3 && !isNoiseLine(cleaned) && hasSufficientRealWords(cleaned)) {
        if (pendingDish) { dishes.push(pendingDish); pendingDish = null; }
        const conf = computeConfidence(true, cleaned, currentCategory, line.isCentered, line.isAllCaps, layout);
        dishes.push({
          name: correctOCRErrors(cleaned).slice(0, 200),
          price: pendingPrice,
          category: currentCategory || undefined,
          confidence: conf,
          sourceIndex: nextIndex++,
        });
      }
      pendingPrice = undefined;
      continue;
    }

    if (!line.hasPrice && pendingPrice === undefined && i + 1 < lines.length) {
      const nxt = lines[i + 1];
      if (nxt.hasPrice && nxt.price !== undefined && nxt.y - line.y < 60 &&
          /^[$€£¥]?\s*\d+(?:[.,]\d{1,2})?[\s.]*$/.test(nxt.text.trim())) {
        const cleanedName = cleanDishName(nameText);
        if (cleanedName.length >= 3 && hasSufficientRealWords(cleanedName)) {
          if (pendingDish) { dishes.push(pendingDish); pendingDish = null; }
          const conf = computeConfidence(true, cleanedName, currentCategory, line.isCentered, line.isAllCaps, layout);
          dishes.push({
            name: correctOCRErrors(cleanedName).slice(0, 200),
            price: nxt.price,
            category: currentCategory || undefined,
            confidence: conf,
            sourceIndex: nextIndex++,
          });
          i += 1;
          continue;
        }
      }
    }

    if (!line.hasPrice && i + 2 < lines.length) {
      const next1 = lines[i + 1];
      const next2 = lines[i + 2];
      if (
        !next1.hasPrice && next2.hasPrice && !next1.isHeader && !isNoiseLine(next1.text) &&
        !line.isCentered && !/\d/.test(line.text) && !next1.isAllCaps
      ) {
        const cleanedName = cleanDishName(nameText);
        const cleanedDesc = next1.text.trim();
        if (cleanedName.length > 3 && cleanedDesc.length > 3) {
          if (pendingDish) { dishes.push(pendingDish); pendingDish = null; }
          const conf = computeConfidence(true, cleanedName, currentCategory, line.isCentered, line.isAllCaps, layout);
          dishes.push({
            name: cleanedName,
            description: cleanedDesc,
            price: next2.price,
            category: currentCategory || undefined,
            confidence: conf,
            sourceIndex: nextIndex++,
          });
          i += 2;
          continue;
        }
      }
    }

    if (line.hasPrice && line.price !== undefined) {
      if (pendingDish) { dishes.push(pendingDish); pendingDish = null; }

      const nameWithoutPrice = nameText.replace(/\s*[$€£¥]?\s*\d+(?:[.,]\d{1,2})?[\s.]*$/, "").trim();
      const cleaned = cleanDishName(nameWithoutPrice);
      if (cleaned.length >= 3 && words >= 1 && !isNoiseLine(cleaned)) {
        const conf = computeConfidence(true, cleaned, currentCategory, line.isCentered, line.isAllCaps, layout);
        pendingDish = {
          name: cleaned,
          price: line.price,
          category: currentCategory || undefined,
          confidence: conf,
          sourceIndex: nextIndex++,
        };
      }
      continue;
    }

    if (words >= 1 && words <= 25 && /[a-zA-Z]{3,}/.test(nameText)) {
      const cleaned = cleanDishName(nameText);
      if (cleaned.length < 3) continue;

      const isDishy = nameTableEntry(cleaned, currentCategory, layout);

      if (isDishy) {
        if (pendingDish) { dishes.push(pendingDish); }
        const conf = computeConfidence(false, cleaned, currentCategory, line.isCentered, line.isAllCaps, layout);
        pendingDish = {
          name: cleaned,
          category: currentCategory || undefined,
          confidence: conf,
          sourceIndex: nextIndex++,
        };
      } else if (pendingDish && !pendingDish.description) {
        if (isDescriptionLine(cleaned)) {
          pendingDish.description = cleaned;
        } else if (words <= 6) {
          pendingDish.name += " " + cleaned;
          pendingDish.confidence = Math.min(pendingDish.confidence + 0.05, 1);
        }
      }
    }
  }

  if (pendingDish) dishes.push(pendingDish);
  return dishes;
}

export function smartParse(rawText: string, words: WordPos[]): ParsedDish[] {
  const lines = groupIntoLines(words);
  if (lines.length < 2) return sequentialParse(rawText);

  const columns = detectColumns(lines);
  const allDishes: ParsedDish[] = [];

  for (const column of columns) {
    const columnDishes = parseColumn(column);
    allDishes.push(...columnDishes);
  }

  const threshold = dynamicThreshold(allDishes);
  const seen = new Set<string>();
  const items: ParsedDish[] = [];

  for (const dish of allDishes.sort((a, b) => a.sourceIndex - b.sourceIndex)) {
    const key = dish.name.toLowerCase().trim();
    if (key.length < 3 || seen.has(key)) continue;
    seen.add(key);

    const corrected = correctOCRErrors(dish.name).trim();
    if (corrected.length < 3 || isNoiseLine(corrected + " x")) continue;
    if (!/[\p{L}]{3,}/u.test(corrected)) continue;
    if (!hasSufficientRealWords(corrected)) continue;

    if (dish.confidence < threshold) continue;

    items.push({
      name: corrected.slice(0, 200),
      description: dish.description ? correctOCRErrors(dish.description).trim().slice(0, 500) : "",
      price: dish.price,
      category: dish.category || guessCategory(corrected),
      confidence: dish.confidence,
      sourceIndex: dish.sourceIndex,
    });
  }

  return items;
}

export function sequentialParse(rawText: string): ParsedDish[] {
  const { priceRatio, avgLineLen } = classifyMenuText(rawText);
  const layout = priceRatio < 0.15 ? "fastfood" : avgLineLen > 45 ? "descriptive" : "compact";

  const blocks = rawText
    .split(/\n\s*\n/)
    .map(b => b.trim())
    .filter(b => b.length > 0);

  if (blocks.length < 2) {
    return basicExtract(rawText);
  }

  const dishes: ParsedDish[] = [];
  let currentCategory = "";
  let headerSeen = false;
  const seen = new Set<string>();
  let sourceIndex = 0;

  const menuHasHeaders = rawText
    .split(/\r?\n/)
    .some(l => {
      const t = l.trim();
      const p = findPriceInText(t);
      return isHeaderLike(t, !!p, false, t.split(/\s+/));
    });

  for (let bi = 0; bi < blocks.length; bi++) {
    const lines = blocks[bi]
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 1);

    if (lines.length === 0) continue;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isNoiseLine(line)) continue;

      const priceOnLine = findPriceInText(line);
      if (isHeaderLike(line, !!priceOnLine, false, line.split(/\s+/))) {
        currentCategory = categoryFromHeader(line.trim());
        headerSeen = true;
        continue;
      }

      if (menuHasHeaders && !headerSeen && !priceOnLine) continue;

      if (/^\d+(?:\.\d{1,2})?$/.test(line.trim())) continue;
      if (!priceOnLine && isDescriptionLine(line)) continue;

      if (/(Small|Regular|Single|Large|Double|Medium)\s+[$€£¥]?\s*\d/.test(line)) {
        const baseName = line
          .replace(/(Small|Regular|Single|Large|Double|Medium|Kids?)\s+[$€£¥]?\s*\d+(?:[.,]\d+)?\s*\/?\s*/g, "")
          .trim();
        if (baseName && baseName.length > 3) {
          const cleaned = cleanDishName(baseName);
          if (!seen.has(cleaned.toLowerCase()) && !isNoiseLine(cleaned)) {
            seen.add(cleaned.toLowerCase());
            const prices = [...line.matchAll(/(\d+(?:[.,]\d{1,2})?)/g)].map(m => parseFloat(m[1].replace(",", ".")));
            const entryPrice = prices.length > 0 ? prices[0] : undefined;
            dishes.push({
              name: correctOCRErrors(cleaned).slice(0, 200),
              category: currentCategory || undefined,
              price: entryPrice,
              confidence: 0.6,
              sourceIndex: sourceIndex++,
            });
          }
        }
        continue;
      }

      let name = line;
      let price = priceOnLine?.price;

      if (priceOnLine && priceOnLine.position === "trailing") {
        name = line.slice(0, line.lastIndexOf(priceOnLine.raw)).trim();
      } else if (priceOnLine && priceOnLine.position === "left_side") {
        name = line.replace(/^[$€£¥Rs.]+\s*\d+(?:[.,]\d+)?\s+/, "").trim();
      }

      if (!priceOnLine && i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        const nextPrice = findPriceInText(nextLine);
        if (nextPrice && nextPrice.position === "trailing") {
          const nextClean = nextLine.replace(nextPrice.raw, "").trim();
          if (nextClean.length === 0 || nextClean.length < 3) {
            price = nextPrice.price;
            i++;
          }
        }
      }

      name = cleanDishName(name);
      const words = name.split(/\s+/);
      if (name.length < 3) continue;
      if (!/[\p{L}]{3,}/u.test(name)) continue;
      if (!hasSufficientRealWords(name)) continue;
      if (isNoiseLine(name)) continue;

      if (layout === "fastfood" && !price) {
        const foodWords = words.filter(w => isFoodRelated(w));
        if (foodWords.length === 0) continue;
      }

      const normalized = name.toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      const confidence = computeConfidence(
        price !== undefined,
        name,
        currentCategory,
        false,
        name === name.toUpperCase(),
        layout
      );

      dishes.push({
        name: correctOCRErrors(name).slice(0, 200),
        category: currentCategory || undefined,
        price,
        confidence,
        sourceIndex: sourceIndex++,
      });
    }
  }

  const threshold = dynamicThreshold(dishes);
  return dishes
    .filter(d => d.confidence >= threshold)
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .map(d => ({
      name: d.name,
      description: d.description || "",
      price: d.price,
      category: d.category || "other",
      confidence: d.confidence,
      sourceIndex: d.sourceIndex,
    }))
    .slice(0, 50);
}

export function basicExtract(rawText: string): ParsedDish[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 1);

  const items: ParsedDish[] = [];
  const seen = new Set<string>();
  let currentCategory = "";

  const firstHeaderIdx = lines.findIndex(l => {
    const p = findPriceInText(l);
    return isHeaderLike(l, !!p, false, l.split(/\s+/));
  });
  const hasHeaders = firstHeaderIdx >= 0;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (isNoiseLine(line)) continue;

    const cleaned = line.replace(/[|]/g, " ").replace(/\s+/g, " ").trim();
    const price = findPriceInText(cleaned);
    const wordCount = cleaned.split(/\s+/).length;

    if (hasHeaders && li < firstHeaderIdx && !price) continue;

    if (!price && isDescriptionLine(cleaned)) continue;

    let name = cleaned;
    if (price && price.position === "trailing") {
      name = cleaned.slice(0, cleaned.lastIndexOf(price.raw)).trim();
    } else if (price && price.position === "left_side") {
      name = cleaned.replace(/^[$€£¥Rs.]+\s*\d+(?:[.,]\d+)?\s+/, "").trim();
    }

    if (!name || wordCount > 25) continue;
    if (!/[\p{L}]{3,}/u.test(name)) continue;
    if (!hasSufficientRealWords(name)) continue;

    if (!price && wordCount <= 4) {
      const nameLower = name.toLowerCase().trim();
      const isCategoryHeader =
        CATEGORY_KEYWORDS.has(nameLower) || CATEGORY_KEYWORDS.has(nameLower.replace(/s$/, ""));
      const nameWords = nameLower.split(/\s+/);
      const hasFoodWord = nameWords.some(w => isFoodRelated(w));
      const isAllCapsHeader = !hasFoodWord && wordCount <= 3 && name === name.toUpperCase();
      if (isCategoryHeader || isAllCapsHeader) {
        currentCategory = categoryFromHeader(name);
        continue;
      }
    }

    name = cleanDishName(name);
    const normalized = name.toLowerCase();
    if (normalized.length < 3 || seen.has(normalized)) continue;
    if (isNoiseLine(name)) continue;

    seen.add(normalized);

    items.push({
      name: correctOCRErrors(name).slice(0, 200),
      description: "",
      price: price?.price,
      category: currentCategory || guessCategory(name),
      confidence: 0.5,
      sourceIndex: li,
    });
  }

  return items.slice(0, 50);
}

export function extractParagraphs(resultData: any): ParagraphInfo[] {
  const paragraphs: ParagraphInfo[] = [];

  const directParas: TesseractPara[] = resultData.paragraphs;
  if (directParas && directParas.length > 0) {
    for (const para of directParas) {
      const paraText = (para.text || "").trim();
      if (!paraText) continue;

      const rawWords = para.words || [];
      const words: WordPos[] = rawWords.map((w: any) => ({
        text: w.text || "",
        x: w.bbox?.x0 ?? 0,
        y: w.bbox?.y0 ?? 0,
        w: (w.bbox?.x1 ?? 0) - (w.bbox?.x0 ?? 0),
        h: (w.bbox?.y1 ?? 0) - (w.bbox?.y0 ?? 0),
        confidence: w.confidence ?? 0,
      }));

      if (words.length > 0) {
        const lines = groupIntoLines(words);
        paragraphs.push({ text: paraText, words, lines });
      }
    }
    if (paragraphs.length > 0) return paragraphs;
  }

  const blocks: Array<{ text?: string; paragraphs?: TesseractPara[] }> = resultData.blocks;
  if (blocks) {
    for (const block of blocks) {
      const blockParas = block.paragraphs;
      if (!blockParas) continue;
      for (const para of blockParas) {
        const paraText = (para.text || "").trim();
        if (!paraText) continue;

        const rawWords = para.words || [];
        const words: WordPos[] = rawWords.map((w: any) => ({
          text: w.text || "",
          x: w.bbox?.x0 ?? 0,
          y: w.bbox?.y0 ?? 0,
          w: (w.bbox?.x1 ?? 0) - (w.bbox?.x0 ?? 0),
          h: (w.bbox?.y1 ?? 0) - (w.bbox?.y0 ?? 0),
          confidence: w.confidence ?? 0,
        }));

        if (words.length > 0) {
          const lines = groupIntoLines(words);
          paragraphs.push({ text: paraText, words, lines });
        }
      }
    }
  }

  return paragraphs;
}

export function paragraphAwareParse(paragraphs: ParagraphInfo[], rawText: string): ParsedDish[] {
  if (paragraphs.length < 2) {
    return smartParse(rawText, paragraphs[0]?.words || []);
  }

  const allDishes: ParsedDish[] = [];
  let sourceIndex = 0;

  for (const para of paragraphs) {
    if (para.lines.length === 0) continue;

    const column: Column = {
      lines: para.lines,
      xMin: Math.min(...para.lines.map(l => l.x)),
      xMax: Math.max(...para.lines.map(l => l.x + l.w)),
    };

    const columnDishes = parseColumn(column);
    for (const dish of columnDishes) {
      dish.sourceIndex = sourceIndex++;
    }
    allDishes.push(...columnDishes);
  }

  const threshold = dynamicThreshold(allDishes);
  const seen = new Set<string>();
  const items: ParsedDish[] = [];

  for (const dish of allDishes.sort((a, b) => a.sourceIndex - b.sourceIndex)) {
    const key = dish.name.toLowerCase().trim();
    if (key.length < 3 || seen.has(key)) continue;
    seen.add(key);

    const corrected = correctOCRErrors(dish.name).trim();
    if (corrected.length < 3 || isNoiseLine(corrected + " x")) continue;
    if (!/[\p{L}]{3,}/u.test(corrected)) continue;
    if (!hasSufficientRealWords(corrected)) continue;
    if (dish.confidence < threshold) continue;

    items.push({
      name: corrected.slice(0, 200),
      description: dish.description ? correctOCRErrors(dish.description).trim().slice(0, 500) : "",
      price: dish.price,
      category: dish.category || guessCategory(corrected),
      confidence: dish.confidence,
      sourceIndex: dish.sourceIndex,
    });
  }

  return items;
}

export function parseResultData(resultData: any): LocalOCRItem[] {
  const raw_text = resultData.text || "";
  const rawWords: any[] = resultData.words || [];

  const cleaned = cleanOCRText(raw_text);
  const parseText = cleaned.text;

  const words: WordPos[] = rawWords
    .filter((w: any) => (w.confidence ?? 0) >= 25)
    .map((w: any) => ({
      text: w.text || "",
      x: w.bbox?.x0 ?? 0,
      y: w.bbox?.y0 ?? 0,
      w: (w.bbox?.x1 ?? 0) - (w.bbox?.x0 ?? 0),
      h: (w.bbox?.y1 ?? 0) - (w.bbox?.y0 ?? 0),
      confidence: w.confidence ?? 0,
    }));

  const paragraphs = extractParagraphs(resultData);

  const hasParaWords = paragraphs.some(p => p.words.length >= 3);
  if (paragraphs.length >= 2 && hasParaWords) {
    return paragraphAwareParse(paragraphs, parseText);
  }
  if (words.length > 3) {
    const hasPositionData = words.some(w => w.x !== 0 || w.y !== 0);
    const hasGoodConfidence = words.filter(w => w.confidence > 50).length >= 3;
    if (hasPositionData && hasGoodConfidence) {
      return smartParse(parseText, words);
    }
    return sequentialParse(parseText);
  }
  if (parseText.split(/\n\s*\n/).length >= 2) {
    return sequentialParse(parseText);
  }
  return basicExtract(parseText);
}

export function crossValidate(items: LocalOCRItem[]): LocalOCRItem[] {
  if (items.length <= 1) return items;

  const prices = items.filter(i => i.price !== undefined).map(i => i.price as number);
  if (prices.length >= 3) {
    const sorted = [...prices].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((s, p) => s + (p - mean) ** 2, 0) / prices.length;
    const stdDev = Math.sqrt(variance);

    const lowerBound = mean - 3 * stdDev;
    const upperBound = mean + 3 * stdDev;
    for (const item of items) {
      if (item.price !== undefined && (item.price < lowerBound || item.price > upperBound)) {
        const idx = items.indexOf(item);
        items[idx] = { ...item, price: undefined };
      }
    }
  }

  const result: LocalOCRItem[] = [];
  const used = new Set<number>();

  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;

    const wordsA = new Set(items[i].name.toLowerCase().split(/\s+/));
    let best = items[i];

    for (let j = i + 1; j < items.length; j++) {
      if (used.has(j)) continue;
      const wordsB = new Set(items[j].name.toLowerCase().split(/\s+/));
      const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
      const union = new Set([...wordsA, ...wordsB]);
      const overlap = intersection.size / union.size;

      if (overlap >= 0.7) {
        if (items[j].name.length < best.name.length) best = items[j];
        used.add(j);
      }
    }

    result.push(best);
    used.add(i);
  }

  return result;
}