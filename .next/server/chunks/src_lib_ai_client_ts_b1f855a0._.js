module.exports=[363909,e=>{"use strict";e.s(["callVisionOCR",()=>w,"chatCompletions",()=>b],363909);let t=[{name:"openrouter-gemma4",baseURL:"https://openrouter.ai/api/v1",model:"google/gemma-4-26b-a4b-it:free",apiKeyEnv:"OPENROUTER_API_KEY",priority:1},{name:"openrouter-llama",baseURL:"https://openrouter.ai/api/v1",model:"meta-llama/llama-3.3-70b-instruct:free",apiKeyEnv:"OPENROUTER_API_KEY",priority:2},{name:"openrouter-router",baseURL:"https://openrouter.ai/api/v1",model:"openrouter/free",apiKeyEnv:"OPENROUTER_API_KEY",priority:3},{name:"openrouter-nemotron-nano",baseURL:"https://openrouter.ai/api/v1",model:"nvidia/nemotron-3-nano-30b-a3b:free",apiKeyEnv:"OPENROUTER_API_KEY",priority:4},{name:"openrouter-nemotron-super",baseURL:"https://openrouter.ai/api/v1",model:"nvidia/nemotron-3-super-120b-a12b:free",apiKeyEnv:"OPENROUTER_API_KEY",priority:5},{name:"openrouter-nemotron-ultra",baseURL:"https://openrouter.ai/api/v1",model:"nvidia/nemotron-3-ultra-550b-a55b:free",apiKeyEnv:"OPENROUTER_API_KEY",priority:6},{name:"openrouter-gpt-oss",baseURL:"https://openrouter.ai/api/v1",model:"openai/gpt-oss-20b:free",apiKeyEnv:"OPENROUTER_API_KEY",priority:7},{name:"freetheai",baseURL:"https://api.freetheai.xyz/v1",model:"kai/free",apiKeyEnv:"FREETHEAI_API_KEY",priority:8},{name:"groq",baseURL:"https://api.groq.com/openai/v1",model:"llama-3.3-70b-versatile",apiKeyEnv:"GROQ_API_KEY",priority:10},{name:"gemini",baseURL:"https://generativelanguage.googleapis.com/v1beta/openai/",model:"gemini-2.0-flash",apiKeyEnv:"GEMINI_API_KEY",priority:11},{name:"sambanova",baseURL:"https://api.sambanova.ai/v1",model:"Meta-Llama-3.3-70B-Instruct",apiKeyEnv:"SAMBANOVA_API_KEY",priority:12},{name:"github",baseURL:"https://models.github.ai/inference",model:"meta/llama-3.3-70b-instruct",apiKeyEnv:"GITHUB_TOKEN",priority:13,headers:{Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"}},{name:"huggingface",baseURL:"https://router.huggingface.co/v1",model:"meta-llama/Llama-3.3-70B-Instruct",apiKeyEnv:"HF_TOKEN",priority:14},{name:"cloudflare",get baseURL(){let e=process.env.CLOUDFLARE_ACCOUNT_ID||"";return`https://api.cloudflare.com/client/v4/accounts/${e}/ai/v1`},model:"@cf/meta/llama-3.3-70b-instruct-fp8-fast",apiKeyEnv:"CLOUDFLARE_API_TOKEN",priority:15,headers:{"cf-aig-gateway-id":"default"}}];var r=e.i(50377);async function i(e){throw r.logger.warn("[LocalOCR] Tesseract.js not available in Next.js — falling through to Python OCR"),Error("Tesseract.js unavailable in Next.js context")}var s=e.i(233405),o=e.i(522734),n=e.i(814747),a=e.i(446786),l=e.i(254799);let c=(0,n.join)((0,a.tmpdir)(),"menulens-ocr"),d=new Map;function p(e,t){if(d.size>=50){let e=d.entries().next().value;e&&d.delete(e[0])}d.set(e,{result:t,ts:Date.now()})}async function m(e){let t=process.env.OPENROUTER_API_KEY;if(!t||e.length<10)return null;r.logger.info("[OCRAI] Asking free model to extract dishes from raw OCR...");let i=`You are a menu OCR processor. Below is the RAW OCR text from a restaurant menu photo. Extract ONLY the actual dish items (food/drink items the restaurant sells).

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
${e.slice(0,3e3)}
"""`;try{let e=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${t}`,"HTTP-Referer":"https://menulens.app","X-Title":"MenuLens"},body:JSON.stringify({model:"google/gemma-4-26b-a4b-it:free",messages:[{role:"system",content:"You extract dish items from menu OCR text. Return only valid JSON arrays."},{role:"user",content:i}],temperature:.05,max_tokens:2048}),signal:AbortSignal.timeout(2e4)});if(!e.ok)return r.logger.warn(`[OCRAI] Model returned ${e.status}`),null;let s=await e.json(),o=s.choices?.[0]?.message?.content;if(!o)return null;let n=o.match(/\[[\s\S]*\]/);if(!n)return null;let a=JSON.parse(n[0]).filter(e=>e.name&&"string"==typeof e.name&&e.name.length>2);return r.logger.info(`[OCRAI] Extracted ${a.length} dishes from raw OCR`),a.length>0?a:null}catch(t){let e=t instanceof Error?t.message:String(t);return r.logger.warn(`[OCRAI] Failed: ${e.slice(0,100)}`),null}}async function g(e){let t=(0,l.createHash)("sha256").update(Buffer.from(e)).digest("hex").slice(0,32),i=function(e){let t=d.get(e);return t?Date.now()-t.ts>3e5?(d.delete(e),null):t.result:null}(t);if(i)return r.logger.info(`[PythonOCR] Cache hit: ${t.slice(0,8)}`),i;(0,o.existsSync)(c)||(0,o.mkdirSync)(c,{recursive:!0});let a=(0,n.join)(c,`input-${t.slice(0,8)}.png`),g=(0,n.join)(c,"ocr.py");(0,o.writeFileSync)(a,Buffer.from(e));let h=String.raw`import sys, re, json, math
sys.path.insert(0, r"C:\Users\maqso\AppData\Local\hermes\hermes-agent\venv\Lib\site-packages")
from PIL import Image, ImageFilter, ImageEnhance
import numpy as np
import pytesseract
from scipy import ndimage

pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PHASE 0: Configuration
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RE_PRICE_ONLY = re.compile(r'^\s*\$?\s*\d+\.?\d*\s*$')
PRICE_RE = re.compile(r'''\$?\s*(\d+\.?\d*)\s*(?:USD)?''', re.IGNORECASE)

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
    # Extended noise
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

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PHASE 1: Image preprocessing
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def deskew(img):
    """Correct rotation using Sobel gradient histogram."""
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
    """Pick sharpest channel (R/G/B/gray) by Laplacian variance."""
    r, g, b = img.split()
    gray = img.convert("L")
    best_name, best_img, best_var = "gray", gray, 0
    for name, ch in [("R", r), ("G", g), ("B", b), ("gray", gray)]:
        lap = np.abs(ndimage.laplace(np.array(ch, dtype=np.float32))).std()
        if lap > best_var:
            best_var, best_name, best_img = lap, name, ch
    return best_img

def build_strategies(mono):
    """Return list of (label, PIL_image) for multi-strategy OCR."""
    W, H = mono.size
    W2, H2 = int(W * 2), int(H * 2)

    up = mono.resize((W2, H2), Image.LANCZOS)

    ce = ImageEnhance.Contrast(mono).enhance(1.4).resize((W2, H2), Image.LANCZOS)

    sh = mono.resize((W2, H2), Image.LANCZOS).filter(
        ImageFilter.UnsharpMask(radius=1, percent=100, threshold=2)
    )

    arr = np.array(mono, dtype=np.float32)
    local_mean = ndimage.uniform_filter(arr, size=15)
    local_std = np.sqrt(ndimage.uniform_filter((arr - local_mean) ** 2, size=15))
    local_std = np.clip(local_std, 5, 255)
    clahe_arr = np.clip(128 + (arr - local_mean) / (local_std / 35), 0, 255).astype(np.uint8)
    cl = Image.fromarray(clahe_arr).resize((W2, H2), Image.LANCZOS)

    return [("up", up), ("contrast", ce), ("sharp", sh), ("clahe", cl)]

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PHASE 2: Word-level OCR with confidence filtering
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def ocr_words(img):
    """Run Tesseract with multiple PSM modes, return words from the best one.

    Tries PSM 6 (block), PSM 4 (single column), PSM 3 (auto).
    Picks the mode that produces the most words with conf > 0.
    """
    best_words, best_count = [], 0
    psm_modes = [6, 4, 3, 12, 11]  # Try block mode first (works for sparse/structured text)

    for psm in psm_modes:
        try:
            data = pytesseract.image_to_data(
                img, lang="eng", config=f"--psm {psm}",
                output_type=pytesseract.Output.DICT
            )
            words = []
            for i in range(len(data["text"])):
                conf = data["conf"][i]
                text = (data["text"][i] or "").strip()
                if text and conf > 0:
                    words.append({
                        "word": text,
                        "conf": conf,
                        "x": data["left"][i],
                        "y": data["top"][i],
                        "w": data["width"][i],
                        "h": data["height"][i],
                        "block": data["block_num"][i],
                        "line": data["line_num"][i],
                    })
            n = len(words)
            if n > best_count:
                best_count, best_words = n, words
        except Exception:
            pass

    return best_words

def group_words_into_lines(words):
    """
    Group word-level data into coherent text lines.
    Uses Tesseract's block/line numbers + vertical proximity clustering.

    Also splits groups that have large vertical gaps (Tesseract sometimes
    assigns the same line_num to multiple visually separate lines).
    """
    # First group by Tesseract's block+line
    line_groups = {}
    for w in words:
        key = (w["block"], w["line"])
        if key not in line_groups:
            line_groups[key] = []
        line_groups[key].append(w)

    # Merge adjacent lines with small vertical gap, but also split
    # within a group if there's a big vertical jump
    sorted_groups = sorted(line_groups.values(), key=lambda g: min(w["y"] for w in g))

    # Further split each group by vertical gaps within the group
    split_groups = []
    for group in sorted_groups:
        # Sort words by Y position
        sorted_words = sorted(group, key=lambda w: w["y"])
        # Split if gap > median word height * 1.5
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

    # Re-sort split groups by their Y position to interleave
    # Tesseract often groups all dishes in one line_num and all descriptions
    # in another, but they're interleaved vertically (dish → desc → dish → desc).
    split_groups.sort(key=lambda g: min(w["y"] for w in g))

    merged = []
    for group in split_groups:
        merged.extend(group)
        merged.append(None)  # separator

    # Re-split on separators
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
    """Join words in a line, keeping word order by x-position."""
    sorted_words = sorted(word_list, key=lambda w: w["x"])
    return " ".join(w["word"] for w in sorted_words)

def avg_conf(word_list):
    """Average confidence of words in a line."""
    return sum(w["conf"] for w in word_list) / max(len(word_list), 1)

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PHASE 3: Menu-specific line classification
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def classify_line(text, word_list, total_height):
    """Classify a line of OCR output. Returns a dict.

    Classification rules (menu-specific, NOT general OCR):
      - "dish"      → has price nearby OR has real words + no garbage keywords
      - "price"     → mostly digits/decimal, contains $ or number.dd
      - "section"   → ALL CAPS short line, or contains section keywords
      - "description" → short line below a dish, no price, lowercase start
      - "header"    → top 15% of image, standalone, large font
      - "footer"    → contains phone/email/address/hours keywords
      - "garbage"   → mostly symbols, too short, too fragmented
    """
    s = text.strip()
    if not s:
        return {"type": "blank", "score": 0}

    letters = sum(1 for c in s if c.isalpha())
    digits = sum(1 for c in s if c.isdigit())
    symbols = sum(1 for c in s if not c.isalnum() and c not in " '")
    meaningful = letters + digits
    if meaningful == 0:
        return {"type": "garbage", "score": 0}

    # Symbol-heavy = garbage
    if symbols > meaningful * 1.5:
        return {"type": "garbage", "score": 0}

    # Too short = garbage
    if len(s) < 3:
        return {"type": "garbage", "score": 0}

    avg_confidence = avg_conf(word_list)
    min_y = min(w["y"] for w in word_list)

    # Position-based: bottom 15% of image = footer zone
    footer_zone = min_y > total_height * 0.85
    # Position-based: top 12% = header zone
    header_zone = min_y < total_height * 0.12

    # ── Footer (phone, email, address, hours, legal) ──
    has_phone = bool(re.search(r'\d{3,4}[\s\-.]\d{3}[\s\-.]\d{4}', s))
    has_email = bool(re.search(r'[\w.]+@[\w.]+', s))
    has_time = bool(re.search(r'\d{1,2}:\d{2}\s*[ap]m|\b\d+[ap]m\b', s, re.IGNORECASE))
    has_day = bool(re.search(r'\b(mon|tue|wed|thu|fri|sat|sun)\w*\b', s, re.IGNORECASE))
    has_address = bool(re.search(r'\b(st|ave|rd|blvd|dr|ln|ste|suite|floor)\b', s, re.IGNORECASE))
    words_lower = {w.lower().strip(".,!?;:'\"-") for w in s.split()}

    if has_phone or has_email:
        return {"type": "footer", "score": 0}

    # Garbage keyword check
    garbage_hits = words_lower & GARBAGE_WORDS
    garbage_ratio = len(garbage_hits) / max(len(words_lower), 1)

    # Footer zone + time/day/address patterns = definitely footer
    if footer_zone and (has_time or has_day or has_address or garbage_ratio > 0.3):
        return {"type": "footer", "score": 0}
    # Even outside footer zone, time+day combo = not a dish
    if has_time and has_day and garbage_ratio > 0.2:
        return {"type": "footer", "score": 0}
    # Hours/phone/address keywords outside footer = garbage not dish
    if garbage_ratio > 0.5:
        return {"type": "footer", "score": 0}

    # ── Section header (ALL CAPS or section keywords) ──
    is_all_caps = s.isupper() and letters > 3 and len(s) > 2
    has_section_kw = bool(words_lower & SECTION_KEYWORDS)

    if is_all_caps and len(s) < 30 and letters > len(s) * 0.6:
        return {"type": "section", "score": 60, "name": s.title()}
    if has_section_kw and letters > 5 and len(s) < 25:
        return {"type": "section", "score": 50, "name": s.title()}

    # ── Dish candidate scoring ──
    dish_score = 0

    # Strip time patterns from price matching (e.g. "11am" should not match as "$11")
    s_no_time = re.sub(r'\b\d+[ap]m\b', '', s, flags=re.IGNORECASE)
    has_price = bool(re.search(r'(?:\$\s*(\d+(?:\.\d{1,2})?)|(?<!\S)(\d+\.\d{2})(?=\s|$))', s_no_time))
    if has_price:
        dish_score += 35

    # Has real alphabetic content
    if letters > 4 and len(s) > 6:
        dish_score += 20

    # Starts with bullet or number (menu list style)
    if s[0] in "•·*-–—" or (s[0].isdigit() and len(s) > 4 and s[0:2].strip()):
        dish_score += 10

    # Ends with price pattern
    if re.search(r'\d+\.\d{2}\s*$', s):
        dish_score += 15

    # Garbage keyword penalty
    dish_score -= len(garbage_hits) * 8

    # Symbol penalty
    if s.count("|") > 2 or s.count("/") > 3:
        dish_score -= 15

    # Header zone = not a dish
    if header_zone:
        dish_score -= 30

    # Low-confidence OCR penalty
    if avg_confidence < 40:
        dish_score -= 20
    elif avg_confidence < 20:
        dish_score -= 40

    # Description penalty: lines starting lowercase after first word are descriptions
    first_word = s.split()[0] if s.split() else ""
    if first_word and first_word[0].islower() and letters > 6 and not has_price:
        dish_score -= 25  # Descriptions usually start with lowercase
    
    # Description penalty: very long text-only lines are almost certainly descriptions
    if not has_price and letters > 28 and digits == 0:
        dish_score -= 10

    # Description phrase penalty: no price + starts with a common description starter word
    # (ingredient, cooking method, or serving style — NOT a dish name)
    if not has_price and letters > 6 and len(s) > 20:
        first_word_lower = first_word.lower()
        if first_word_lower in (
            "fresh", "lightly", "classic", "warm", "chilled", "traditional",
            "homemade", "hand-cut", "slow-roasted", "wood-fired",
            "crispy", "golden", "tender", "juicy", "seasonal", "selected",
            "whole", "aged", "tomato", "served", "topped",
        ):
            dish_score -= 12

    # Non-dish trigger: lines describing modifiers/options, not menu items
    # ("Substitute Fries", "Add Protein", "Choice of", "Side Salad")
    if not has_price:
        words_all = {w.lower().strip(".,!?;:'\"-()") for w in s.split()}
        non_dish_hits = words_all & NON_DISH_TRIGGERS
        if non_dish_hits:
            dish_score -= 20
        # Single short-ish word with no price, not a bullet, not a dish
        if len(s.split()) <= 2 and letters < 15 and not has_price and not s[0] in "•·*-–—0123456789":
            dish_score -= 15

    # Nutrition/calorie info rejection — lines with calorie/dietary numbers are NOT dishes
    if not has_price and re.search(r'\b(?:cal|calories|kcal|kj|protein|carbs|carbohydrates?|sodium|fiber|sugar|fat|saturated|trans|cholesterol)\b', s, re.IGNORECASE):
        if bool(re.search(r'\d+\s*(?:g|mg|mcg|%)', s, re.IGNORECASE)) or bool(re.search(r'\b\d{3,4}\b', s)):
            # "Cal 450", "Protein 25g", "Fat 12g" patterns = nutrition info
            dish_score -= 30

    # Stopword-heavy lines — if >35% of words are common English stopwords,
    # the line is almost certainly a description, not a dish name
    STOPWORDS = {
        "a", "an", "the", "with", "and", "for", "in", "on", "at",
        "our", "your", "its", "is", "are", "was", "were",
        "of", "to", "from", "by", "that", "this", "each", "all",
        "served", "comes", "made", "choice", "choose", "available",
    }
    words_lower_set = {w.lower().strip(".,!?;:'\"-()") for w in s.split() if w.strip()}
    if words_lower_set and not has_price:
        stopword_hits = words_lower_set & STOPWORDS
        stopword_ratio = len(stopword_hits) / len(words_lower_set)
        if stopword_ratio > 0.35:
            dish_score -= 15  # Heavy stopword presence = prose/description

    # Pure digits-only line = not a dish
    if letters == 0 and digits > 0:
        dish_score = 0

    if dish_score >= 20:
        return {"type": "dish", "score": min(dish_score, 100)}
    elif dish_score >= 10:
        return {"type": "description", "score": dish_score}
    else:
        return {"type": "garbage", "score": max(0, dish_score)}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PHASE 4: Dish extraction (spatial + content analysis)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def extract_dishes(lines, raw_text, total_height):
    """Take classified lines and build menu items.

    Algorithm:
    1. Classify every line
    2. Track current section header
    3. When we see a dish, check if next lines are prices or descriptions
    4. Pair dish + price + description
    5. Skip everything else (footer, garbage, header)
    """
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

            # Extract price from dish line
            price = None
            price_match = PRICE_RE.search(dish_text)
            if price_match:
                try:
                    price = float(price_match.group(1))
                except ValueError:
                    pass
                # Remove price from name; if that leaves nothing, keep full text
                dish_name = dish_text[:price_match.start()].strip().rstrip(",-–— ")
                if not dish_name or len(dish_name) < 2:
                    dish_name = dish_text
            else:
                dish_name = dish_text

            # Check next line(s) for description or standalone price
            description = ""
            # Collect up to 2 consecutive description lines after a dish
            desc_lines = []
            nid = i + 1
            while nid < len(classified) and len(desc_lines) < 2:
                nxt = classified[nid]
                nxt_text = nxt["text"]
                nxt_has_price = bool(re.search(r'(?:\$\s*(\d+(?:\.\d{1,2})?)|(?<!\S)(\d+\.\d{2})(?=\s|$))', nxt_text))
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
                i = nid - 1  # skip consumed lines
            else:
                # Check if it's a standalone price line on the very next line
                if i + 1 < len(classified):
                    next_text = classified[i + 1]["text"]
                    standalone_price = PRICE_RE.fullmatch(next_text.strip())
                    if standalone_price and price is None:
                        try:
                            price = float(standalone_price.group(1))
                        except (ValueError, IndexError):
                            price = None
                        i += 1  # Consumed this line

            items.append({
                "name": dish_name.strip()[:200] or "Menu Item",
                "price": price,
                "description": description.strip()[:500],
                "confidence": round(c["score"] / 100, 2),
                "category": current_section.lower(),
            })
            current_section = current_section  # keep section
            i += 1
            continue

        # Skip garbage, footer, header, blank
        i += 1

    return items

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PHASE 5: Multi-strategy OCR — try all strats, pick best for dishes
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def run_pipeline_on_image(img):
    """Run the full OCR pipeline on a preprocessed image.

    Returns (items, raw_text, avg_confidence).
    """
    words = ocr_words(img)
    if not words:
        return [], "", 0

    lines = group_words_into_lines(words)
    total_height = img.height
    raw_text = "\n".join(line_to_text(l) for l in lines)
    overall_conf = sum(w["conf"] for w in words) / len(words)

    # Adaptive confidence threshold based on overall quality
    # Low-res images produce conf 10-40; high-res produce 60-90
    conf_threshold = 25 if overall_conf > 30 else (10 if overall_conf > 15 else 5)

    high_conf_words = [w for w in words if w["conf"] > conf_threshold]
    if len(high_conf_words) < 3:
        # Ultra-permissive fallback: accept anything with conf > 0
        high_conf_words = words[:]

    filtered_lines = group_words_into_lines(high_conf_words)
    items = extract_dishes(filtered_lines, raw_text, total_height)
    return items, raw_text, overall_conf


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# MAIN: Try all preprocessing strategies
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

raw = Image.open(r"__IMG_PATH__").convert("RGB")
raw = deskew(raw)
mono = best_channel(raw)

strategies = build_strategies(mono)

best_result = None
best_items_count = -1

for label, simg in strategies:
    items, raw_text, avg_conf_val = run_pipeline_on_image(simg)
    logger_ts = f"[{label}] {len(items)} items, conf={avg_conf_val:.0f}"

    # Score this strategy: prefer more items + higher confidence
    score = len(items) * 10 + avg_conf_val
    if len(items) > best_items_count or (len(items) == best_items_count and avg_conf_val > (best_result or [None, 0, 0])[2]):
        best_items_count = len(items)
        best_result = (items, raw_text, avg_conf_val, label)

if best_result is None or best_items_count <= 0:
    # Absolute fallback: run psm 3 with upscaled only
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
`.replace("__IMG_PATH__",a.replace(/\\/g,"\\\\"));(0,o.writeFileSync)(g,h),r.logger.info("[PythonOCR] Menu-specific pipeline (word-level + confidence + spatial)...");try{let e,i=(0,s.execSync)(`"C:\\Users\\maqso\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\python.exe" "${g}"`,{timeout:18e4,maxBuffer:0xa00000}).toString().trim();try{e=JSON.parse(i)}catch{e={menu_name:"",items:[],raw_text:i,strategy:"parse-fallback",avg_confidence:0}}let o=e.items?.length||0,n=e.avg_confidence||0;if(r.logger.info(`[PythonOCR] ${o} items (conf=${n}, strat=${e.strategy||"?"})`),0===o||n<35){r.logger.info("[PythonOCR] Low quality — trying AI extraction from raw text...");let t=await m(e.raw_text);t&&t.length>0&&(e.items=t)}if(0===e.items.length){let e=JSON.stringify({menu_name:"",items:[]});return p(t,e),e}let a=JSON.stringify({menu_name:e.menu_name||"",items:e.items.map(e=>({name:e.name?.slice(0,200)||"Menu Item",description:e.description?.slice(0,500)||"",price:e.price,category:e.category||"menu",confidence:e.confidence||.5}))});return p(t,a),a}catch(t){let e=t instanceof Error?t.message:String(t);throw r.logger.warn(`[PythonOCR] Failed: ${e.slice(0,200)}`),Error(`PythonOCR: ${e.slice(0,100)}`)}finally{try{(0,o.unlinkSync)(a)}catch{}try{(0,o.unlinkSync)(g)}catch{}}}async function h(e,t){let r=process.env[e.apiKeyEnv];if(!r)throw Error(`No API key for ${e.name}`);let i={model:e.model,messages:t.messages,...void 0!==t.temperature&&{temperature:t.temperature},...void 0!==t.max_tokens&&{max_tokens:t.max_tokens},...t.response_format&&{response_format:t.response_format}},s=await fetch(`${e.baseURL}/chat/completions`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${r}`,...e.headers},body:JSON.stringify(i),signal:AbortSignal.timeout(3e4)});if(!s.ok){let t=await s.text().catch(()=>"");throw Error(`${e.name} returned ${s.status}: ${t.slice(0,200)}`)}return s.json()}async function u(e,t){let r=process.env.GEMINI_API_KEY;if(!r)throw Error("GEMINI_API_KEY is not configured");let i=_(e),s=`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${r}`,o={contents:[{parts:[{text:t},{inlineData:{mimeType:"image/jpeg",data:i}}]}],generationConfig:{temperature:.1,maxOutputTokens:4e3,responseMimeType:"application/json"}},n=await fetch(s,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(o),signal:AbortSignal.timeout(6e4)});if(!n.ok){let e=await n.text().catch(()=>"");throw Error(`Gemini Vision returned ${n.status}: ${e.slice(0,300)}`)}let a=await n.json(),l=a.candidates?.[0]?.content?.parts?.[0]?.text;if(!l)throw Error("Gemini Vision returned empty content");return l}function _(e){return Buffer.from(e).toString("base64")}let f=["google/gemma-4-26b-a4b-it:free","google/gemma-4-31b-it:free","nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free","nvidia/nemotron-nano-12b-v2-vl:free","nvidia/nemotron-3.5-content-safety:free","openrouter/free"];async function y(e,t,r,i=9e4){let s=process.env.OPENROUTER_API_KEY;if(!s)throw Error("OPENROUTER_API_KEY is not configured");let o=_(e),n=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${s}`,"HTTP-Referer":"https://menulens.app","X-Title":"MenuLens"},body:JSON.stringify({model:r,messages:[{role:"user",content:[{type:"text",text:t},{type:"image_url",image_url:{url:`data:image/jpeg;base64,${o}`}}]}],temperature:.1,max_tokens:4096}),signal:AbortSignal.timeout(i)});if(!n.ok){let e=await n.text().catch(()=>"");throw Error(`${r} returned ${n.status}: ${e.slice(0,300)}`)}let a=await n.json(),l=a.choices?.[0]?.message?.content;if(!l)throw Error(`${r} returned empty content`);return l}async function w(e,t){let s=[];if(process.env.OPENROUTER_API_KEY)for(let i of f)try{return r.logger.info({message:"Trying vision model",model:i}),await y(e,t,i)}catch(t){let e=t instanceof Error?t.message:String(t);s.push(`${i}: ${e}`),r.logger.warn({message:`Vision model ${i} failed`,error:e})}if(process.env.GEMINI_API_KEY)try{return await u(e,t)}catch(t){let e=t instanceof Error?t.message:String(t);s.push(`Gemini: ${e}`)}try{r.logger.info({message:"Trying local Tesseract OCR fallback"});let t=await i(e);if(t&&t.length>10)return t;throw Error("LocalOCR result too short")}catch(t){let e=t instanceof Error?t.message:String(t);s.push(`LocalOCR: ${e}`)}try{r.logger.info({message:"Trying Python OCR fallback"});let t=await g(e);if(t&&t.length>10)return t;throw Error("PythonOCR result too short")}catch(t){let e=t instanceof Error?t.message:String(t);s.push(`PythonOCR: ${e}`)}let o=s.some(e=>e.includes("429")||e.includes("quota")||e.includes("rate limit")),n=!!process.env.GEMINI_API_KEY;throw Error(o&&!n?"All AI vision models are currently rate-limited due to daily free tier limits. They reset at midnight UTC. Please try again tomorrow, or add a Gemini API key to bypass OpenRouter rate limits.":o&&n?"All AI vision models failed. The Gemini fallback also failed — check that your Gemini API key is valid and has quota remaining. OpenRouter free models are rate-limited until midnight UTC.":`All vision providers failed. ${s.join("; ")}`)}async function b(e){let i=t.filter(e=>!!process.env[e.apiKeyEnv]&&("cloudflare"!==e.name||!!process.env.CLOUDFLARE_ACCOUNT_ID)).sort((e,t)=>e.priority-t.priority);if(0===i.length)throw Error("No AI providers configured. Add at least one API key to .env.local");let s=null;for(let t of i)try{let r=await h(t,e);if(!r?.choices?.[0]?.message?.content)throw Error(`${t.name} returned empty content`);return r}catch(e){s=e instanceof Error?e:Error(String(e)),r.logger.warn(`AI provider ${t.name} failed: ${s.message}`)}throw Error(`All AI providers failed. Last error: ${s?.message||"unknown"}`)}}];

//# sourceMappingURL=src_lib_ai_client_ts_b1f855a0._.js.map