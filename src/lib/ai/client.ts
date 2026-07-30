import { logger } from "@/lib/logger";
import { providers, getCloudflareBaseURL, VISION_MODELS } from "@/lib/ai/providers";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { createHash } from "crypto";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: string };
}

const OCR_TEMP_DIR = join(tmpdir(), "menulens-ocr");

// ── Python OCR Cache ──
const ocrCache = new Map<string, { result: string; ts: number }>();

function cacheGet(key: string): string | null {
  const entry = ocrCache.get(key);
  if (entry) {
    if (Date.now() - entry.ts > 300000) {
      ocrCache.delete(key);
      return null;
    }
    return entry.result;
  }
  return null;
}

function cacheSet(key: string, result: string): void {
  if (ocrCache.size >= 50) {
    const first = ocrCache.entries().next().value;
    if (first) ocrCache.delete(first[0]);
  }
  ocrCache.set(key, { result, ts: Date.now() });
}

// ── OpenRouter AI OCR (fallback) ──
async function callOCRAI(rawText: string): Promise<{ name: string; price: number | null; description: string }[] | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || rawText.length < 10) return null;

  logger.info("[OCRAI] Asking free model to extract dishes from raw OCR...");

  const prompt = `You are a menu OCR processor. Below is the RAW OCR text from a restaurant menu photo. Extract ONLY the actual dish items (food/drink items the restaurant sells).

Rules:
- Return ONLY a JSON array (no markdown, no explanation)
- Each item: { "name": "Dish Name", "price": 12.99|null, "description": "brief description or empty string" }
- Extract price if visible (number, no $)
- IGNORE: restaurant name, phone numbers, addresses, hours, tax/tip info, payment info, allergens, "our menu" headers, "specials" titles
- IGNORE: garbled/nonsense text lines
- If you cannot identify ANY real dishes, return empty array []
- Be honest — don't invent dishes that aren't there

RAW OCR TEXT:
"""
${rawText.slice(0, 3000)}
"""`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://menulens.app",
        "X-Title": "MenuLens",
      },
      body: JSON.stringify({
        model: "google/gemma-4-26b-a4b-it:free",
        messages: [
          { role: "system", content: "You extract dish items from menu OCR text. Return only valid JSON arrays." },
          { role: "user", content: prompt },
        ],
        temperature: 0.05,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      logger.warn(`[OCRAI] Model returned ${res.status}`);
      return null;
    }

    const data = await res.json();
    const content: string | undefined = data.choices?.[0]?.message?.content;
    if (!content) return null;

    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return null;

    const items = JSON.parse(match[0]).filter(
      (item: { name: string }) => item.name && typeof item.name === "string" && item.name.length > 2
    );

    logger.info(`[OCRAI] Extracted ${items.length} dishes from raw OCR`);
    return items.length > 0 ? items : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[OCRAI] Failed: ${msg.slice(0, 100)}`);
    return null;
  }
}

// ── Python OCR Pipeline ──
async function pythonOCR(imageBuffer: ArrayBuffer): Promise<string> {
  const hash = createHash("sha256").update(Buffer.from(imageBuffer)).digest("hex").slice(0, 32);
  const cached = cacheGet(hash);
  if (cached) {
    logger.info(`[PythonOCR] Cache hit: ${hash.slice(0, 8)}`);
    return cached;
  }

  if (!existsSync(OCR_TEMP_DIR)) {
    mkdirSync(OCR_TEMP_DIR, { recursive: true });
  }

  const inputPath = join(OCR_TEMP_DIR, `input-${hash.slice(0, 8)}.png`);
  const scriptPath = join(OCR_TEMP_DIR, "ocr.py");

  writeFileSync(inputPath, Buffer.from(imageBuffer));

  const pythonScript = `import sys, re, json, math
sys.path.insert(0, r"${process.env.PYTHON_SITE_PACKAGES || ""}")
from PIL import Image, ImageFilter, ImageEnhance
import numpy as np
import pytesseract
from scipy import ndimage

pytesseract.pytesseract.tesseract_cmd = r"${process.env.TESSERACT_CMD || "tesseract"}"

RE_PRICE_ONLY = re.compile(r'^\\s*\\$?\\s*\\d+\\.?\\d*\\s*$')
PRICE_RE = re.compile(r'''\\$?\\s*(\\d+\\.?\\d*)\\s*(?:USD)?''', re.IGNORECASE)

NON_DISH_TRIGGERS = {
    "substitute", "substitution", "choose", "choice", "choose any",
    "side", "sides", "add", "extra", "toppings", "sauce", "sauces",
    "dressing", "dressings", "option", "options", "selection",
    "topping", "protein", "portion", "upgrade",
    "gluten-free", "gluten free", "vegetarian", "vegan",
    "contains", "may contain", "ask server", "ask your server",
    "upon request", "available", "request",
    "add-on", "add on", "substitute with", "swap", "exchange",
    "prepared", "cooked", "baked", "grilled", "fried", "roasted",
    "choose one", "choose two", "choose any one", "choose any two",
    "regular", "large", "small", "medium", "mini",
    "add for", "extra for", "each", "per",
}

SECTION_KEYWORDS = {
    "appetizers", "starters", "soups", "salads", "entrees", "mains",
    "main course", "main courses", "desserts", "drinks", "beverages",
    "specialty", "specials", "combos", "combo", "platters", "platter",
    "sides", "children", "kids", "lunch", "dinner", "breakfast",
    "brunch", "pizza", "pasta", "wraps", "sandwiches", "burgers",
}

GARBAGE_WORDS_BASE = {
    "open", "closed", "mon", "tue", "wed", "thu", "fri", "sat", "sun",
    "phone", "tel", "fax", "email", "address", "hours", "serving",
    "welcome", "thank", "please", "visit", "order", "delivery",
    "tax", "tip", "total", "subtotal", "gratuity", "service", "charge",
    "accept", "visa", "mastercard", "amex", "cash", "credit",
    "allergen", "contains", "may", "gluten", "dairy",
    "none", "n/a", "ask", "call", "text",
    "page", "menu", "our", "the", "and", "with", "for", "from",
    "wifi", "password", "internet", "free",
    "reservation", "reservations", "party", "parties",
    "groups", "group", "private", "event", "events",
    "banquet", "happy", "hour",
    "nutrition", "nutritional", "allergens", "ingredients",
    "takeout", "takeaway", "togo", "to go",
    "minimum", "min", "maximum", "max",
    "policy", "policies", "charge", "charges",
    "fee", "fees", "convenience", "handling",
    "gift", "certificate", "card", "cards",
}
GARBAGE_WORDS = GARBAGE_WORDS_BASE

def deskew(img):
    gray = img.convert("L")
    arr = np.array(gray, dtype=np.float32)
    gx = ndimage.sobel(arr, axis=1)
    gy = ndimage.sobel(arr, axis=0)
    mag = np.sqrt(gx**2 + gy**2)
    hist, edges = np.histogram(np.arctan2(gy, gx).ravel(), bins=360, range=(-np.pi, np.pi), weights=mag.ravel())
    angle = edges[np.argmax(hist)] * 180 / np.pi
    if abs(angle) > 0.8 and abs(angle) < 45:
        img = img.rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=(255, 255, 255))
    return img

def best_channel(img):
    r, g, b = img.split()
    gray = img.convert("L")
    best_name, best_img, best_var = "gray", gray, 0
    for name, ch in [("R", r), ("G", g), ("B", b), ("gray", gray)]:
        lap = np.abs(ndimage.laplace(np.array(ch, dtype=np.float32))).std()
        if lap > best_var:
            best_var, best_name, best_img = lap, name, ch
    return best_img

def build_strategies(mono):
    W, H = mono.size
    W2, H2 = int(W * 2), int(H * 2)
    up = mono.resize((W2, H2), Image.LANCZOS)
    ce = ImageEnhance.Contrast(mono).enhance(1.4).resize((W2, H2), Image.LANCZOS)
    sh = mono.resize((W2, H2), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1, percent=100, threshold=2))
    arr = np.array(mono, dtype=np.float32)
    local_mean = ndimage.uniform_filter(arr, size=15)
    local_std = np.sqrt(ndimage.uniform_filter((arr - local_mean) ** 2, size=15))
    local_std = np.clip(local_std, 5, 255)
    clahe_arr = np.clip(128 + (arr - local_mean) / (local_std / 35), 0, 255).astype(np.uint8)
    cl = Image.fromarray(clahe_arr).resize((W2, H2), Image.LANCZOS)
    return [("up", up), ("contrast", ce), ("sharp", sh), ("clahe", cl)]

def ocr_words(img):
    best_words, best_count = [], 0
    psm_modes = [6, 4, 3, 12, 11]
    for psm in psm_modes:
        try:
            data = pytesseract.image_to_data(img, lang="eng", config=f"--psm {psm}", output_type=pytesseract.Output.DICT)
            words = []
            for i in range(len(data["text"])):
                conf = data["conf"][i]
                text = (data["text"][i] or "").strip()
                if text and conf > 0:
                    words.append({"word": text, "conf": conf, "x": data["left"][i], "y": data["top"][i], "w": data["width"][i], "h": data["height"][i], "block": data["block_num"][i], "line": data["line_num"][i]})
            n = len(words)
            if n > best_count:
                best_count, best_words = n, words
        except Exception:
            pass
    return best_words

def group_words_into_lines(words):
    line_groups = {}
    for w in words:
        key = (w["block"], w["line"])
        if key not in line_groups:
            line_groups[key] = []
        line_groups[key].append(w)
    sorted_groups = sorted(line_groups.values(), key=lambda g: min(w["y"] for w in g))
    split_groups = []
    for group in sorted_groups:
        sorted_words = sorted(group, key=lambda w: w["y"])
        heights = [w["h"] for w in sorted_words if w["h"] > 0]
        median_h = sorted(heights)[len(heights)//2] if heights else 15
        gap_threshold = max(median_h * 1.5, 12)
        current_subgroup = [sorted_words[0]]
        for j in range(1, len(sorted_words)):
            w_prev = sorted_words[j-1]
            w_curr = sorted_words[j]
            gap = abs(w_curr["y"] - w_prev["y"])
            if gap > gap_threshold:
                split_groups.append(current_subgroup)
                current_subgroup = []
            current_subgroup.append(w_curr)
        if current_subgroup:
            split_groups.append(current_subgroup)
    split_groups.sort(key=lambda g: min(w["y"] for w in g))
    merged = []
    for group in split_groups:
        merged.extend(group)
        merged.append(None)
    lines = []
    current = []
    for item in merged:
        if item is None:
            if current:
                lines.append(current)
                current = []
        else:
            current.append(item)
    if current:
        lines.append(current)
    return lines

def line_to_text(word_list):
    sorted_words = sorted(word_list, key=lambda w: w["x"])
    return " ".join(w["word"] for w in sorted_words)

def avg_conf(word_list):
    return sum(w["conf"] for w in word_list) / max(len(word_list), 1)

def classify_line(text, word_list, total_height):
    s = text.strip()
    if not s:
        return {"type": "blank", "score": 0}
    letters = sum(1 for c in s if c.isalpha())
    digits = sum(1 for c in s if c.isdigit())
    symbols = sum(1 for c in s if not c.isalnum() and c not in " '\"")
    meaningful = letters + digits
    if meaningful == 0:
        return {"type": "garbage", "score": 0}
    if symbols > meaningful * 1.5:
        return {"type": "garbage", "score": 0}
    if len(s) < 3:
        return {"type": "garbage", "score": 0}
    avg_confidence = avg_conf(word_list)
    min_y = min(w["y"] for w in word_list)
    footer_zone = min_y > total_height * 0.85
    header_zone = min_y < total_height * 0.12
    has_phone = bool(re.search(r'\\d{3,4}[\\s\\-.]\\d{3}[\\s\\-.]\\d{4}', s))
    has_email = bool(re.search(r'[\\w.]+@[\\w.]+', s))
    has_time = bool(re.search(r'\\d{1,2}:\\d{2}\\s*[ap]m|\\b\\d+[ap]m\\b', s, re.IGNORECASE))
    has_day = bool(re.search(r'\\b(mon|tue|wed|thu|fri|sat|sun)\\w*\\b', s, re.IGNORECASE))
    has_address = bool(re.search(r'\\b(st|ave|rd|blvd|dr|ln|ste|suite|floor)\\b', s, re.IGNORECASE))
    words_lower = {w.lower().strip(".,!?;:'\\\"-") for w in s.split()}
    if has_phone or has_email:
        return {"type": "footer", "score": 0}
    garbage_hits = words_lower & GARBAGE_WORDS
    garbage_ratio = len(garbage_hits) / max(len(words_lower), 1)
    if footer_zone and (has_time or has_day or has_address or garbage_ratio > 0.3):
        return {"type": "footer", "score": 0}
    if has_time and has_day and garbage_ratio > 0.2:
        return {"type": "footer", "score": 0}
    if garbage_ratio > 0.5:
        return {"type": "footer", "score": 0}
    is_all_caps = s.isupper() and letters > 3 and len(s) > 2
    has_section_kw = bool(words_lower & SECTION_KEYWORDS)
    if is_all_caps and len(s) < 30 and letters > len(s) * 0.6:
        return {"type": "section", "score": 60, "name": s.title()}
    if has_section_kw and letters > 5 and len(s) < 25:
        return {"type": "section", "score": 50, "name": s.title()}
    dish_score = 0
    s_no_time = re.sub(r'\\b\\d+[ap]m\\b', '', s, flags=re.IGNORECASE)
    has_price = bool(re.search(r'(?:\\$\\s*(\\d+(?:\\.\\d{1,2})?)|(?<!\\S)(\\d+\\.\\d{2})(?=\\s|$))', s_no_time))
    if has_price:
        dish_score += 35
    if letters > 4 and len(s) > 6:
        dish_score += 20
    if s[0] in "\u2022\u00b7*-\\u2013\\u2014" or (s[0].isdigit() and len(s) > 4 and s[0:2].strip()):
        dish_score += 10
    if re.search(r'\\d+\\.\\d{2}\\s*$', s):
        dish_score += 15
    dish_score -= len(garbage_hits) * 8
    if s.count("|") > 2 or s.count("/") > 3:
        dish_score -= 15
    if header_zone:
        dish_score -= 30
    if avg_confidence < 40:
        dish_score -= 20
    elif avg_confidence < 20:
        dish_score -= 40
    first_word = s.split()[0] if s.split() else ""
    if first_word and first_word[0].islower() and letters > 6 and not has_price:
        dish_score -= 25
    if not has_price and letters > 28 and digits == 0:
        dish_score -= 10
    if not has_price and letters > 6 and len(s) > 20:
        first_word_lower = first_word.lower()
        if first_word_lower in ("fresh", "lightly", "classic", "warm", "chilled", "traditional", "homemade", "hand-cut", "slow-roasted", "wood-fired", "crispy", "golden", "tender", "juicy", "seasonal", "selected", "whole", "aged", "tomato", "served", "topped"):
            dish_score -= 12
    if not has_price:
        words_all = {w.lower().strip(".,!?;:'\\\"-()") for w in s.split()}
        non_dish_hits = words_all & NON_DISH_TRIGGERS
        if non_dish_hits:
            dish_score -= 20
        if len(s.split()) <= 2 and letters < 15 and not has_price and s[0] not in "\u2022\u00b7*-\\u2013\\u20140123456789":
            dish_score -= 15
    if not has_price and re.search(r'\\b(?:cal|calories|kcal|kj|protein|carb|carbohydrates?|sodium|fiber|sugar|fat|saturated|trans|cholesterol)\\b', s, re.IGNORECASE):
        if bool(re.search(r'\\d+\\s*(?:g|mg|mcg|%)', s, re.IGNORECASE)) or bool(re.search(r'\\b\\d{3,4}\\b', s)):
            dish_score -= 30
    STOPWORDS = {"a", "an", "the", "with", "and", "for", "in", "on", "at", "our", "your", "its", "is", "are", "was", "were", "of", "to", "from", "by", "that", "this", "each", "all", "served", "comes", "made", "choice", "choose", "available"}
    words_lower_set = {w.lower().strip(".,!?;:'\\\"-()") for w in s.split() if w.strip()}
    if words_lower_set and not has_price:
        stopword_hits = words_lower_set & STOPWORDS
        stopword_ratio = len(stopword_hits) / len(words_lower_set)
        if stopword_ratio > 0.35:
            dish_score -= 15
    if letters == 0 and digits > 0:
        dish_score = 0
    if dish_score >= 20:
        return {"type": "dish", "score": min(dish_score, 100)}
    elif dish_score >= 10:
        return {"type": "description", "score": dish_score}
    else:
        return {"type": "garbage", "score": max(0, dish_score)}

def extract_dishes(lines, raw_text, total_height):
    classified = []
    for word_list in lines:
        text = line_to_text(word_list)
        cls = classify_line(text, word_list, total_height)
        classified.append({**cls, "text": text, "y": min(w["y"] for w in word_list)})
    items = []
    current_section = "Menu"
    i = 0
    while i < len(classified):
        c = classified[i]
        if c["type"] == "section":
            current_section = c.get("name", current_section)
            i += 1
            continue
        if c["type"] == "dish":
            dish_text = c["text"]
            dish_conf = c["score"]
            price = None
            price_match = PRICE_RE.search(dish_text)
            if price_match:
                try:
                    price = float(price_match.group(1))
                except ValueError:
                    pass
                dish_name = dish_text[:price_match.start()].strip().rstrip(",-\\u2013\\u2014 ")
                if not dish_name or len(dish_name) < 2:
                    dish_name = dish_text
            else:
                dish_name = dish_text
            description = ""
            desc_lines = []
            nid = i + 1
            while nid < len(classified) and len(desc_lines) < 2:
                nxt = classified[nid]
                nxt_text = nxt["text"]
                nxt_has_price = bool(re.search(r'(?:\\$\\s*(\\d+(?:\\.\\d{1,2})?)|(?<!\\S)(\\d+\\.\\d{2})(?=\\s|$))', nxt_text))
                nxt_letters = sum(1 for c in nxt_text if c.isalpha())
                is_desc = (
                    (nxt["type"] == "description" or (nxt["type"] == "dish" and nxt["score"] < 25) or nxt["type"] == "garbage")
                    and nxt_letters > 6
                    and not nxt_has_price
                    and nxt["type"] not in ("section", "footer")
                    and len(nxt_text) < 60
                    and len(nxt_text) > 3
                )
                if is_desc:
                    desc_lines.append(nxt_text)
                    nid += 1
                else:
                    break
            if desc_lines:
                description = " ".join(desc_lines)
                i = nid - 1
            else:
                if i + 1 < len(classified):
                    next_text = classified[i + 1]["text"]
                    standalone_price = PRICE_RE.fullmatch(next_text.strip())
                    if standalone_price and price is None:
                        try:
                            price = float(standalone_price.group(1))
                        except (ValueError, IndexError):
                            price = None
                        i += 1
            items.append({
                "name": dish_name.strip()[:200] or "Menu Item",
                "price": price,
                "description": description.strip()[:500],
                "confidence": round(c["score"] / 100, 2),
                "category": current_section.lower(),
            })
            current_section = current_section
            i += 1
            continue
        i += 1
    return items

def run_pipeline_on_image(img):
    words = ocr_words(img)
    if not words:
        return [], "", 0
    lines = group_words_into_lines(words)
    total_height = img.height
    raw_text = "\\n".join(line_to_text(l) for l in lines)
    overall_conf = sum(w["conf"] for w in words) / len(words)
    conf_threshold = 25 if overall_conf > 30 else (10 if overall_conf > 15 else 5)
    high_conf_words = [w for w in words if w["conf"] > conf_threshold]
    if len(high_conf_words) < 3:
        high_conf_words = words[:]
    filtered_lines = group_words_into_lines(high_conf_words)
    items = extract_dishes(filtered_lines, raw_text, total_height)
    return items, raw_text, overall_conf

raw = Image.open(r"__IMG_PATH__").convert("RGB")
raw = deskew(raw)
mono = best_channel(raw)
strategies = build_strategies(mono)
best_result = None
best_items_count = -1
for label, simg in strategies:
    items, raw_text, avg_conf_val = run_pipeline_on_image(simg)
    if len(items) > best_items_count or (len(items) == best_items_count and avg_conf_val > (best_result or [None, 0, 0])[2]):
        best_items_count = len(items)
        best_result = (items, raw_text, avg_conf_val, label)
if best_result is None or best_items_count <= 0:
    fallback_img = mono.resize((mono.width * 2, mono.height * 2), Image.LANCZOS)
    items, raw_text, avg_conf_val = run_pipeline_on_image(fallback_img)
    best_result = (items, raw_text, avg_conf_val, "fallback-psm3")
    best_items_count = len(items)
items, raw_text, avg_conf_val, best_label = best_result
output = {
    "menu_name": "",
    "items": items,
    "raw_text": raw_text,
    "strategy": best_label,
    "avg_confidence": round(avg_conf_val, 1),
}
print(json.dumps(output))
`;

  writeFileSync(scriptPath, pythonScript);

  logger.info("[PythonOCR] Menu-specific pipeline (word-level + confidence + spatial)...");

  try {
    const raw = execSync(
      `"${process.env.PYTHON_CMD || "python"}" "${scriptPath}"`,
      { timeout: 180000, maxBuffer: 10 * 1024 * 1024 }
    ).toString().trim();

    let result: { menu_name?: string; items?: { name?: string; description?: string; price?: number; category?: string; confidence?: number }[]; raw_text?: string; strategy?: string; avg_confidence?: number };
    try {
      result = JSON.parse(raw);
    } catch {
      result = { menu_name: "", items: [], raw_text: raw, strategy: "parse-fallback", avg_confidence: 0 };
    }

    const itemCount = result.items?.length || 0;
    const avgConf = result.avg_confidence || 0;

    logger.info(`[PythonOCR] ${itemCount} items (conf=${avgConf}, strat=${result.strategy || "?"})`);

    if (itemCount === 0 || avgConf < 35) {
      logger.info("[PythonOCR] Low quality — trying AI extraction from raw text...");
      const aiResult = await callOCRAI(result.raw_text || "");
      if (aiResult && aiResult.length > 0) {
        result.items = aiResult as { name?: string; description?: string; price?: number; category?: string; confidence?: number }[];
      }
    }

    if (!result.items || result.items.length === 0) {
      const fallback = JSON.stringify({ menu_name: "", items: [] });
      cacheSet(hash, fallback);
      return fallback;
    }

    const output = JSON.stringify({
      menu_name: result.menu_name || "",
      items: result.items.map((item) => ({
        name: item.name?.slice(0, 200) || "Menu Item",
        description: item.description?.slice(0, 500) || "",
        price: item.price,
        category: item.category || "menu",
        confidence: item.confidence || 0.5,
      })),
    });

    cacheSet(hash, output);
    return output;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[PythonOCR] Failed: ${msg.slice(0, 200)}`);
    throw new Error(`PythonOCR: ${msg.slice(0, 100)}`);
  } finally {
    try { unlinkSync(inputPath); } catch { /* ignore */ }
    try { unlinkSync(scriptPath); } catch { /* ignore */ }
  }
}

// ── Call a single AI provider ──
async function callProvider(provider: { name: string; baseURL: string; model: string; apiKeyEnv: string; headers?: Record<string, string> }, opts: ChatOptions): Promise<{ choices: { message: { content: string } }[] }> {
  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey) throw new Error(`No API key for ${provider.name}`);

  const body: Record<string, unknown> = {
    model: provider.model,
    messages: opts.messages,
  };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.max_tokens !== undefined) body.max_tokens = opts.max_tokens;
  if (opts.response_format) body.response_format = opts.response_format;

  const res = await fetch(`${provider.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...provider.headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${provider.name} returned ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

// ── Gemini Direct Vision ──
async function callGeminiDirect(imageBuffer: ArrayBuffer, prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const base64 = Buffer.from(imageBuffer).toString("base64");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType: "image/jpeg", data: base64 } },
        ],
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 4000, responseMimeType: "application/json" },
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini Vision returned ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error("Gemini Vision returned empty content");
  return content;
}

// ── OpenRouter Vision ──
async function callOpenRouterVision(imageBuffer: ArrayBuffer, prompt: string, model: string, timeout = 90000): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

  const base64 = Buffer.from(imageBuffer).toString("base64");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://menulens.app",
      "X-Title": "MenuLens",
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
        ],
      }],
      temperature: 0.1,
      max_tokens: 4096,
    }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${model} returned ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${model} returned empty content`);
  return content;
}

// ── Exported: callGeminiVision (multi-provider fallback) ──
export async function callGeminiVision(imageBuffer: ArrayBuffer, prompt: string): Promise<string> {
  const errors: string[] = [];

  // Try OpenRouter vision models
  if (process.env.OPENROUTER_API_KEY) {
    for (const model of VISION_MODELS) {
      try {
        logger.info({ message: "Trying vision model", model });
        return await callOpenRouterVision(imageBuffer, prompt, model);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${model}: ${msg}`);
        logger.warn({ message: `Vision model ${model} failed`, error: msg });
      }
    }
  }

  // Try Gemini direct
  if (process.env.GEMINI_API_KEY) {
    try {
      return await callGeminiDirect(imageBuffer, prompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Gemini: ${msg}`);
    }
  }

  // Try local OCR (Tesseract.js - not available in Next.js)
  try {
    logger.info({ message: "Trying local Tesseract OCR fallback" });
    throw new Error("Tesseract.js not available in Next.js context");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`LocalOCR: ${msg}`);
  }

  // Try Python OCR
  try {
    logger.info({ message: "Trying Python OCR fallback" });
    const result = await pythonOCR(imageBuffer);
    if (result && result.length > 10) return result;
    throw new Error("PythonOCR result too short");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`PythonOCR: ${msg}`);
  }

  // Build final error
  const hasRateLimit = errors.some((e) => e.includes("429") || e.includes("quota") || e.includes("rate limit"));
  const hasGemini = !!process.env.GEMINI_API_KEY;

  if (hasRateLimit && !hasGemini) {
    throw new Error(
      "All AI vision models are currently rate-limited due to daily free tier limits. They reset at midnight UTC. Please try again tomorrow, or add a Gemini API key to bypass OpenRouter rate limits."
    );
  }

  if (hasRateLimit && hasGemini) {
    throw new Error(
      "All AI vision models failed. The Gemini fallback also failed — check that your Gemini API key is valid and has quota remaining. OpenRouter free models are rate-limited until midnight UTC."
    );
  }

  throw new Error(`All vision providers failed. ${errors.join("; ")}`);
}

// ── Exported: chatCompletions (multi-provider fallback) ──
export async function chatCompletions(opts: ChatOptions): Promise<{ choices: { message: { content: string } }[] }> {
  const available = providers
    .filter((p) => !!process.env[p.apiKeyEnv] && (p.name !== "cloudflare" || !!process.env.CLOUDFLARE_ACCOUNT_ID))
    .sort((a, b) => a.priority - b.priority);

  if (available.length === 0) {
    throw new Error("No AI providers configured. Add at least one API key to .env.local");
  }

  let lastError: Error | null = null;

  for (const provider of available) {
    try {
      const providerWithURL = provider.name === "cloudflare"
        ? { ...provider, baseURL: getCloudflareBaseURL() }
        : provider;
      const result = await callProvider(providerWithURL, opts);
      if (!result?.choices?.[0]?.message?.content) {
        throw new Error(`${provider.name} returned empty content`);
      }
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn(`AI provider ${provider.name} failed: ${lastError.message}`);
    }
  }

  throw new Error(`All AI providers failed. Last error: ${lastError?.message || "unknown"}`);
}

// ── Exported: callVisionOCR (for raw OCR text extraction) ──
export async function callVisionOCR(imageBuffer: ArrayBuffer, prompt: string): Promise<string> {
  return callGeminiVision(imageBuffer, prompt);
}
