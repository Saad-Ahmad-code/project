import { OCR_CORRECTIONS } from "./data/ocr-corrections";

export function cleanDishName(raw: string): string {
  let name = raw.trim();

  name = name.replace(/^[★☆⭐●◆▪▸▹►→▪•¶※✓✗✘✔✖✝✙✦✧⬟⬡⌾⭑✪✫✬✭✮✯✰✱✲✳✴✵✶✷✸✹✺✻✼✽✾✿❀]+/, "").trim();

  name = name
    .replace(/^(NEW!?|CHEF'?S?\s*SPECIAL|SIGNATURE|HOTEL|RESTAURANT|CAFE|CAFÉ|BAR|LOUNGE|GRILL|GRILLE|BISTRO|MENU|MENU:)\s+/i, "")
    .trim();

  // Leading bullets / ampersands from OCR ("& Chocolate Caramel").
  name = name.replace(/^[&*+]+/, "").trim();

  name = name.replace(/^\s*\[.*?\]\s*/, "").trim();
  name = name.replace(/\s*\[.*?\]\s*$/, "").trim();
  name = name.replace(/^\s*\(.*?\)\s*/, "").trim();
  name = name.replace(/\s*\(.*?\)\s*$/, "").trim();

  name = name.replace(/^\d+[.)\s]+/, "").trim();

  name = name.replace(/^[$€£¥RsSs.]*\s*\d{1,3}(?:[.,]\s?\d{1,2}|\s+\d{2})\s+/, "").trim();

  name = name.replace(/[;,]+$/, "").trim();

  name = name.replace(/_/g, " ").replace(/\s+/g, " ").trim();

  name = name.replace(/^[-–—]+/, "").trim();
  name = name.replace(/[-–—]+$/, "").trim();
  name = name.replace(/[-–—]{2,}/g, " ").replace(/\s+/g, " ").trim();
  name = name.replace(/\s+[-–—]+\s+/g, " ").trim();
  name = name.replace(/^[-–—]+\s+/, "").trim();

  name = name.replace(/(\d+)\s*\/\s*(\d+)/g, "$1\u2044$2");
  name = name.replace(/[*>{<}%]/g, " ").replace(/\s+/g, " ").trim();
  name = name.replace(/[|`~^\\]/g, " ").replace(/\s+/g, " ").trim();
  name = name.replace(/\u2044/g, "/");

  name = name.replace(/[(){}[\]]/g, " ").replace(/\s+/g, " ").trim();

  name = name.replace(/\.{2,}/g, " ").replace(/\s+/g, " ").trim();
  name = name.replace(/^\s*\.\s*/, "").trim();
  name = name.replace(/\s*\.\s*$/, "").trim();
  name = name.replace(/\s+\.\s+/g, " ").trim();
  name = name.replace(/\./g, " ").replace(/\s+/g, " ").trim();

  name = name.replace(/\s+(NEW|SPICY|HOT|MILD|CHEF'?S?\s*SPECIAL|SIGNATURE)$/i, "").trim();

  // Trailing OCR/venue junk: "Chicken Strips SOWOW", "Espresso 13K ANY",
  // "ICE MILK DESIGNED BY <name>" (designer credit fused onto the dish).
  name = name.replace(/\s+(?:SOWOW|ANY)\s*$/i, "").trim();
  name = name.replace(/\s+DESIGNED\s+BY\b.*$/i, "").trim();

  // Mid-name K-price tokens ("HOT COLD Caramel Milk 21K 23K" → "HOT COLD
  // Caramel Milk"); the trailing one is already extracted as a price.
  name = name.replace(/\b\d{1,4}\s*[Kk]\b/g, " ").replace(/\s+/g, " ").trim();

  // Residual OCR-misread-rupee tokens ("き250", "S250") that survived price
  // extraction — strip the symbol so it never pollutes the dish name.
  name = name.replace(/(?:き|キ)\s*\d{2,4}\b/g, " ").replace(/\s+/g, " ").trim();
  name = name.replace(/\s+S\d{2,4}\b/g, " ").replace(/\s+/g, " ").trim();

  if (name.length > 3) {
    name = name.replace(/\s+S$/, "").trim();
  }

  name = name.replace(/\s+(?:V|VG|GF|DF|N)\s*$/i, "").trim();

  let prev = name;
  while (name.length > 3) {
    const next = name.replace(/\s+\S{1,2}$/, "").trim();
    if (next === name) break;
    name = next;
  }
  if (name.length < 3) name = prev;

  name = name.replace(/\s+/g, " ").trim();

  if (name.length < 3 || /^[^\p{L}]+$/u.test(name)) return raw.trim();

  return name;
}