/**
 * Smart Menu Structure Analyzer — Multi-Layer OCR Extraction
 *
 * Reads a menu image via Tesseract.js and extracts structured dish data
 * by understanding the menu's visual layout and logical structure.
 *
 * Three layers of extraction, tried in order:
 *   Layer 1 — Positional (word bounding boxes → columns → blocks → dishes)
 *   Layer 2 — Sequential (blank-line paragraphs → block analysis)
 *   Layer 3 — Basic line filter (fallback for garbled OCR)
 *
 * Post-processing applies to all layers: name cleanup, OCR correction,
 * adaptive confidence thresholding, cross-validation.
 */

import { spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Tesseract from "tesseract.js";
import { cleanOCRText } from "./cleaner";
import { cleanTextWithOllama, ollamaVisionOCR, parseDishArray, refineWithOllama } from "./ollama";

// ═══════════════════════════════════════════════════════════════════
//  PYTHON SUBPROCESS (RapidOCR candidate engine)
// ═══════════════════════════════════════════════════════════════════

const RAPIDOCR_SCRIPT = join(process.cwd(), "src", "scripts", "rapidocr_scan.py");
const MENU_OCR_SCRIPT = join(process.cwd(), "src", "scripts", "menu_ocr.py");

function resolvePythonCmd(): string {
  // Prefer the project venv (has rapidocr/onnxruntime), matching client.ts
  // pythonOCR and engine.ts layer 3. Fallbacks: env override → PATH.
  if (process.env.MENULENS_PYTHON) return process.env.MENULENS_PYTHON;
  const venv = join(process.cwd(), ".venv", "Scripts", "python.exe");
  if (existsSync(venv)) return venv;
  return process.env.PYTHON_CMD || "python";
}

function runPythonScript(script: string, args: string[], timeoutMs = 45000): Promise<string> {
  return new Promise((resolve, reject) => {
    // PYTHONPATH must be cleared: when the app is spawned from an agent/editor
    // shell, PYTHONPATH can point at an unrelated venv whose numpy is a broken
    // binary mix — subprocesses must import only from their own interpreter.
    const child = spawn(resolvePythonCmd(), [script, ...args], {
      env: { ...process.env, PYTHONPATH: "" },
      windowsHide: true,
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`python ${script} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`python ${script} exited ${code}: ${err.slice(0, 300)}`));
    });
  });
}

// Runs RapidOCR (PP-OCRv6 on ONNX Runtime) as an extra candidate in the
// multi-PSM pool. Returns null on ANY failure — the pool must never break.
async function tryRapidOCR(
  buffer: Buffer
): Promise<{ data: any; wordCount: number; alphaWordCount: number; avgConf: number } | null> {
  const tmp = join(tmpdir(), `menulens-rapidocr-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  try {
    writeFileSync(tmp, buffer);
    const out = await runPythonScript(RAPIDOCR_SCRIPT, [tmp]);
    const parsed = JSON.parse(out.trim());
    const lines: Array<{ text: string; conf: number; box: number[] }> = parsed.lines || [];
    const text: string = parsed.raw_text || "";

    // Shape the output like Tesseract data so the shared parser pipeline
    // (smartParse / sequentialParse) consumes it unchanged. RapidOCR gives
    // line-level boxes; split each line into word tokens with char-proportional
    // x-extents so column detection and price/name parsing behave like the
    // Tesseract path (line-as-single-word produced 0 dishes).
    const words = lines
      .filter((l) => l.text && Array.isArray(l.box) && l.box.length === 4)
      .flatMap((l) => {
        const tokens = l.text.split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return [];
        const [x0, y0, x1, y1] = l.box;
        const lineW = Math.max(x1 - x0, 1);
        const totalChars = l.text.length || 1;
        const conf = Math.round((l.conf ?? 0) * 100);
        let cx = x0;
        return tokens.map((tok) => {
          const w = Math.max((tok.length / totalChars) * lineW, 2);
          const word = {
            text: tok,
            confidence: conf,
            bbox: { x0: cx, y0, x1: cx + w, y1 },
          };
          cx += w + 2; // small gap between tokens
          return word;
        });
      });

    const splitWords = text.split(/\s+/).filter((w: string) => w.length > 2);
    const alphaWords = splitWords.filter((w: string) => REAL_WORD_RE.test(w));
    const avgConf = lines.length
      ? (lines.reduce((a, l) => a + (l.conf ?? 0), 0) / lines.length) * 100
      : 0;
    // Keep the raw line boxes (not the synthetic words) — they carry the
    // rotation signal used by estimateSkewDegrees for deskewing.
    return { data: { text, words, rawLines: lines }, wordCount: splitWords.length, alphaWordCount: alphaWords.length, avgConf };
  } catch {
    return null;
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// Runs menu_ocr.py — the word-level pytesseract pipeline (4 preprocessing
// strategies × 5 PSM modes, own deskew) — as a pool candidate. It emits the
// winning strategy's word tokens with geometry; we shape them into
// Tesseract-like data so the shared parser consumes it exactly like the
// RapidOCR candidate. Placeholders are substituted the same way pythonOCR()
// in client.ts does. Returns null on ANY failure — the pool must never break.
async function tryMenuOCR(buffer: Buffer): Promise<OCRCandidate | null> {
  const tmpDir = join(tmpdir(), `menulens-menuocr-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const inputPath = join(tmpDir, "menu.png");
  const scriptPath = join(tmpDir, "menu_ocr.py");
  try {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(inputPath, buffer);
    const slash = (p: string) => p.replace(/\\/g, "/");
    const script = readFileSync(MENU_OCR_SCRIPT, "utf8")
      .replace(/__PYTHON_SITE_PACKAGES__/g, slash(process.env.PYTHON_SITE_PACKAGES || ""))
      .replace(/__TESSERACT_CMD__/g, slash(process.env.TESSERACT_CMD || "tesseract"))
      .replace(/__IMG_PATH__/g, slash(inputPath));
    writeFileSync(scriptPath, script);

    // Up to 20 tesseract passes — needs room (see menuOCRRescue: this only
    // runs when the fast engines produced a weak read, so the wait is the
    // rescue path, not the common path).
    const out = await runPythonScript(scriptPath, [], 120000);
    const parsed = JSON.parse(out.trim());
    const text: string = parsed.raw_text || "";

    const words = (parsed.words || [])
      .filter((w: any) => w && typeof w.word === "string" && w.word.trim().length > 0)
      .map((w: any) => {
        const x = w.x ?? 0;
        const y = w.y ?? 0;
        return {
          text: w.word as string,
          confidence: Math.round(w.conf ?? 0),
          bbox: { x0: x, y0: y, x1: x + (w.w ?? 0), y1: y + (w.h ?? 0) },
        };
      });

    if ((parsed.items || []).length === 0 && words.length === 0) return null;

    const splitWords = text.split(/\s+/).filter((w: string) => w.length > 2);
    const alphaWords = splitWords.filter((w: string) => REAL_WORD_RE.test(w));
    return {
      data: { text, words },
      wordCount: splitWords.length,
      alphaWordCount: alphaWords.length,
      avgConf: typeof parsed.avg_confidence === "number" ? parsed.avg_confidence : 0,
    };
  } catch {
    return null;
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════

export interface LocalOCRItem {
  name: string;
  description?: string;
  price?: number;
  category?: string;
}

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

interface PriceResult {
  price: number;
  raw: string;
  position: "trailing" | "next_line" | "right_aligned" | "standalone" | "left_side";
}

interface ParsedDish {
  name: string;
  description?: string;
  price?: number;
  category?: string;
  confidence: number;
  sourceIndex: number;
}

interface ParseContext {
  currentCategory: string;
  categoryLineIndex: number;
  blockIndex: number;
}

type MenuLayout = "descriptive" | "compact" | "fastfood" | "unknown";

// ═══════════════════════════════════════════════════════════════════
//  DATA: CATEGORY KEYWORDS (150+)
// ═══════════════════════════════════════════════════════════════════

export const CATEGORY_KEYWORDS = new Set([
  // Course / meal type
  "appetizers", "starters", "entrees", "mains", "soups", "salads", "sides", "extras",
  "main course", "main courses", "desserts", "dessert", "drinks", "beverages",
  "lunch", "dinner", "breakfast", "brunch", "supper",
  // Cuisines / styles
  "pizza", "pizzas", "pasta", "pastas", "pasta dishes",
  "burgers", "sandwiches", "wraps", "hot dog", "hot dogs",
  "seafood", "grill", "grilled", "bbq", "barbeque", "roasts",
  "noodles", "rice dishes", "fried rice",
  "curry", "curries", "tandoori", "tandoori specials",
  "chinese", "italian", "mexican", "thai", "japanese", "indian",
  "continental", "mediterranean", "greek", "lebanese", "turkish",
  "arabic", "moroccan", "spanish", "french", "korean", "vietnamese",
  "sushi", "ramen", "udon", "pho", "dim sum",
  "steaks", "steaks & grills", "sizzlers",
  // Drinks
  "drinks", "beverages", "beverage",
  "hot drinks", "cold drinks", "soft drinks", "mineral water",
  "coffee", "hot beverages", "tea", "tea selection",
  "mocktails", "cocktails", "mocktail", "cocktail",
  "smoothies", "shakes", "milkshakes", "frappes", "juice", "fresh juices",
  "beer", "wine", "liquor", "spirits", "bar menu", "beer list", "wine list",
  "draught beer", "bottled beer", "premium spirits",
  // Sections
  "specials", "daily specials", "specials of the day",
  "chef special", "chef specials", "chef specialties", "chef's special",
  "today special", "weekly specials", "signature dishes", "house specials",
  "combos", "meal deals", "value meals", "family deals", "family platters",
  "kids", "kids menu", "kids meal", "children", "happy meal",
  "for the table", "shareables", "small plates", "large plates",
  "build your own", "create your own", "choice of",
  // Specific dish types
  "pancakes", "waffles", "french toast", "omelettes", "egg dishes",
  "biryani", "kabab", "kebab", "shawarma", "falafel",
  "tacos", "burritos", "quesadillas", "enchilada", "enchiladas",
  "momos", "dumplings", "dim sums", "bao", "gyoza",
  "samosas", "pakoras", "chaat", "finger food", "tapas",
  "nibbles", "munchies", "small bites",
  "dosa", "idli", "vada", "uttapam", "paratha",
  "thali", "thalis", "indian thali",
  "bowls", "power bowls", "acai bowls", "smoothie bowls",
  "salad", "garden fresh", "soup & salad", "soup of the day",
  "platters", "towers", "buckets", "sharing platters",
  "rolls", "rolls & wraps", "kathi rolls", "kati roll",
  "flatbreads", "naan", "roti", "indian breads", "breads",
  "loaded fries", "nachos", "loaded nachos",
  "antipasti", "antipasto", "bruschetta", "carpaccio",
  "cakes", "pies", "tarts", "cheesecakes", "ice cream",
  "sundaes", "gelato", "sorbet", "sweet treats", "pastries",
  "patisserie", "bakery", "croissants", "muffins", "scones", "bagels",
  "all day breakfast", "continental breakfast", "english breakfast",
  // Subcontinental / regional
  "tandoor", "murgh", "gosht", "subzis", "dal", "lentils",
  "raita", "chutney", "achar", "papad",
  "south indian", "south indian thali", "gujarati thali", "punjabi thali",
  "chowmein", "chow mein", "manchurian", "hakka noodles",
  "street food", "bhel puri", "pani puri", "sev puri", "papdi chaat",
  "aloo tikki", "kathi roll", "kati roll",
  // Hot beverages sub-sections
  "espresso", "cappuccino", "latte", "mocha", "macchiato",
  "flat white", "long black", "americano", "iced coffee", "cold brew",
  "herbal tea", "green tea", "chai",
  // Desserts
  "fresh fruit", "yogurt", "granola", "cereals",
  "waffles", "pancakes", "crepes", "donuts",
  // Accessories
  "add-ons", "toppings", "extra toppings",
  "single", "double", "mixers",
]);

// ── Food-related words for validation (200+) ──

function isFoodRelated(word: string): boolean {
  const w = word.toLowerCase();
  if (w.length < 3) return false;

  if (
    /^(chicken|beef|lamb|pork|fish|shrimp|prawn|salmon|tuna|crab)$/.test(w) ||
    /^(lobster|mutton|turkey|duck|pizza|pasta|burger|steak|pancake)$/.test(w) ||
    /^(waffle|noodle|rice|bread|toast|wrap|taco|burrito|dosa|naan|roti)$/.test(w) ||
    /^(paratha|biryani|curry|tikka|masala|korma|salad|soup|fries)$/.test(w) ||
    /^(cheese|butter|cream|milk|eggs|omelet|omelette|sandwich|pudding)$/.test(w) ||
    /^(cake|pie|cookie|brownie|muffin|donut|doughnut|mousse|candy|tiramisu)$/.test(w) ||
    /^(cheesecake|pavlova|eclair|profiterole|parfait|trifle)$/.test(w) ||
    /^(coffee|latte|cappuccino|espresso|mocha|chai|tea|soda|juice)$/.test(w) ||
    /^(lemonade|shake|smoothie|mocktail|cocktail|beer|wine)$/.test(w) ||
    /^(grilled|roast|roasted|fried|baked|smoked|steamed|pan|stir)$/.test(w) ||
    /^(bbq|buffalo|honey|garlic|spicy|tangy|sweet|sour)$/.test(w) ||
    /^(margherita|pepperoni|hawaiian|veggie|vegan|gluten)$/.test(w) ||
    /^(cheeseburger|hamburger|chowder|gumbo|bisque|stew|casserole)$/.test(w) ||
    /^(dip|salsa|guacamole|hummus|tapenade)$/.test(w) ||
    /^(ribs|wings|brisket|bacon|sausage|ham|chorizo|prosciutto)$/.test(w) ||
    /^(caesar|greek|cobb|club|reuben|panini|ciabatta)$/.test(w) ||
    /^(bagel|croissant|bun|roll|biscuit)$/.test(w) ||
    /^(fajita|enchilada|tamale|samosa|pakora)$/.test(w) ||
    /^(shawarma|kebab|kabab|falafel|kofta|doner)$/.test(w) ||
    /^(manchurian|pad\s*thai|pho)$/.test(w) ||
    /^(ramen|udon|soba|donburi|gyoza|edamame)$/.test(w) ||
    /^(paella|tagine|couscous|risotto)$/.test(w) ||
    /^(truffle|pesto|alfredo|carbonara|bolognese|marinara)$/.test(w) ||
    /^(teriyaki|szechuan|hunan|wasabi|ginger|lemongrass)$/.test(w) ||
    /^(bacon|sausage|ham|salami|chorizo|prosciutto)$/.test(w) ||
    /^(mushroom|onion|tomato|lettuce|spinach|avocado)$/.test(w) ||
    /^(olive|capsicum|jalapeno|pickle|potato|pot|bean|beans)$/.test(w) ||
    /^(broccoli|cauliflower|zucchini|eggplant|asparagus)$/.test(w) ||
    /^(guacamole|cilantro|coriander|basil|oregano)$/.test(w) ||
    /^(mint|rosemary|thyme|sage|dill|parsley|chives)$/.test(w) ||
    /^(chocolate|vanilla|caramel|toffee|fudge|sprinkles)$/.test(w) ||
    /^(strawberry|blueberry|raspberry|banana|mango|apple)$/.test(w) ||
    /^(pineapple|coconut|orange|lemon|lime|grape)$/.test(w) ||
    /^(watermelon|melon|peach|cherry|kiwi|fig|date)$/.test(w) ||
    /^(almond|walnut|pecan|cashew|peanut|hazelnut)$/.test(w) ||
    /^(poached|scrambled|sunny|fried|boiled)$/.test(w) ||
    /^(carbonara|bolognese|marinara|arrabiata|pomodoro)$/.test(w) ||
    /^(mozzarella|burrata|parmesan|gouda|brie|cheddar|feta)$/.test(w) ||
    /^(halloumi|provolone|ricotta|gruyere|manchego|asiago)$/.test(w) ||
    /^(gnocchi|ravioli|linguine|fettuccine|penne|rigatoni|tagliatelle)$/.test(w) ||
    /^(arancini|bruschetta|crostini|caprese|antipasti|calamari)$/.test(w) ||
    /^(mussels|clams|oysters|scallops|octopus|anchovy|sardine)$/.test(w) ||
    /^(halibut|trout|tilapia|mahi|bass|snapper|catfish)$/.test(w) ||
    /^(brisket|meatball|schnitzel|katsu|poke|jambalaya)$/.test(w) ||
    /^(arugula|quinoa|kale|sprout|slaw|cobbler|crumble)$/.test(w) ||
    /^(sorbet|gelato|flan|tart|cannoli|macaron|eclair)$/.test(w) ||
    /^(nachos|quesadilla|taquito|tostada|arepa|empanada)$/.test(w) ||
    /^(philly|pastrami|corned|brisket|pulled|jerk)$/.test(w) ||
    /^(alfredo|aglio|olio|genovese|puttanesca|primavera)$/.test(w) ||
    /^(tandoori|masala|korma|jalfrezi|dopiaza|rogan|bhuna)$/.test(w) ||
    /^(saag|palak|paneer|dal|chana|rajma|chole)$/.test(w) ||
    /^(bhaji|bhajia|raita|chutney|sambar|rasam)$/.test(w) ||
    /^(dosa|idli|vada|uttapam|appam|puttu|upma|pongal)$/.test(w) ||
    /^(lassi|chaas|buttermilk|jaljeera)$/.test(w) ||
    /^(focaccia|bruschetta|crostini|antipasto|caprese)$/.test(w) ||
    /^(carpaccio|tartare|ceviche|crudo|tiradito)$/.test(w) ||
    /^(tempura|tonkatsu|teriyaki|yakitori|sashimi)$/.test(w) ||
    /^(maki|nigiri|temaki|gunkan)$/.test(w) ||
    /^(dim\s*sum|bao\s*bun|siu\s*mai|har\s*gow)$/.test(w) ||
    /^(enchilada|quesadilla|flauta|taquito|tostada)$/.test(w) ||
    /^(nachos|tortilla|burrito|taco|chimichanga)$/.test(w) ||
    /^(gnocchi|ravioli|tortellini|lasagna|manicotti)$/.test(w) ||
    /^(fettuccine|spaghetti|linguine|penne|rigatoni|ziti)$/.test(w) ||
    /^(macaroni|tagliatelle|pappardelle|fusilli|orzo)$/.test(w) ||
    /^(scallop|mussel|clam|oyster|octopus|calamari)$/.test(w) ||
    /^(anchovy|sardine|mackerel|halibut|cod|basa|tilapia)$/.test(w) ||
    /^(trout|catfish|snapper|barramundi|swordfish)$/.test(w) ||
    /^(quinoa|farro|barley|couscous|bulgur|millet|amaranth)$/.test(w) ||
    /^(edamame|tofu|tempeh|seitan|soy|miso)$/.test(w) ||
    /^(prosciutto|pepperoni|salami|chorizo|andouille)$/.test(w) ||
    /^(bresaola|pastrami|corned\s*beef)$/.test(w) ||
    /^(sirloin|ribeye|tenderloin|filet|t-bone|porterhouse)$/.test(w) ||
    /^(barbecue|barbeque|smokey|smoky|charred|charcoal)$/.test(w) ||
    /^(vinaigrette|aioli|hollandaise|béarnaise|remoulade)$/.test(w) ||
    /^(harissa|sriracha|sambal|gochujang|mirin|ponzu)$/.test(w) ||
    /^(chèvre|feta|cheddar|gouda|swiss|brie|camembert)$/.test(w) ||
    /^(gruyère|manchego|pecorino|asiago|colby|monterey)$/.test(w) ||
    /^(artichoke|asparagus|endive|radicchio|arugula|kale)$/.test(w) ||
    /^(brussels|spinach|chard|collard|turnip|parsnip)$/.test(w) ||
    /^(horseradish|wasabi|ginger|turmeric|saffron)$/.test(w) ||
    /^(cardamom|cinnamon|clove|nutmeg|allspice|star\s*anise)$/.test(w) ||
    /^(coriander|cumin|fennel|fenugreek|mustard|sesame)$/.test(w) ||
    /^(poppy|caraway|celery|dill|tarragon|marjoram|savory)$/.test(w) ||
    /^(sashimi|nigiri|maki|hand\s*roll|temaki)$/.test(w) ||
    /^(okonomiyaki|takoyaki|onigiri|katsu|kare)$/.test(w) ||
    /^(bibimbap|bulgogi|kimchi|japchae|tteokbokki)$/.test(w) ||
    /^(spring\s*roll|summer\s*roll|rice\s*paper|vermicelli)$/.test(w) ||
    /^(pho|bun|banh\s*mi|com|chao|goi)$/.test(w) ||
    /^(satay|rendang|gado-gado|nasi|mie|soto)$/.test(w) ||
    /^(halloumi|labneh|tahini|zaatar|sumac|pita)$/.test(w) ||
    /^(baba\s*ganoush|fattoush|tabbouleh|kibbeh|manakish)$/.test(w) ||
    /^(arepa|empanada|pupusa|tamale|ceviche)$/.test(w) ||
    /^(feijoada|moqueca|acarajé|vatapá|coxinha)$/.test(w) ||
    /^(paella|tapas|pinchos|bacalao|gambas|patatas)$/.test(w) ||
    /^(crepe|galette|ratatouille|bouillabaisse|coq|confit)$/.test(w) ||
    /^(sauerbraten|schnitzel|spätzle|bratwurst|weisswurst)$/.test(w) ||
    /^(köttbullar|smörgås|gravlax|herring|lingonberry)$/.test(w) ||
    /^(pierogi|bigos|golabki|kielbasa|zurek)$/.test(w) ||
    /^(borscht|pelmeni|blini|shashlik|kasha)$/.test(w)
  )
    return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════════
//  DATA: OCR SPELLING CORRECTIONS (100+)
// ═══════════════════════════════════════════════════════════════════

const OCR_CORRECTIONS: [RegExp, string][] = [
  [/pizz[saz]/gi, "Pizza"], [/pizz[aas]/gi, "Pizza"],
  [/ch[ie]ken/gi, "Chicken"], [/chl[ck]en/gi, "Chicken"], [/bvrger/gi, "Burger"], [/bvrg[ae]r/gi, "Burger"],
  [/sandwich/gi, "Sandwich"], [/sandw[ei]ch/gi, "Sandwich"], [/sandwish/gi, "Sandwich"],
  [/spagh[ea]tti/gi, "Spaghetti"], [/spagheti/gi, "Spaghetti"], [/spaghett[it]/gi, "Spaghetti"],
  [/lasagn?a/gi, "Lasagna"], [/rav[i1]oli/gi, "Ravioli"],
  [/fettvccine/gi, "Fettuccine"], [/fett[uv]ccine/gi, "Fettuccine"],
  [/brvschetta/gi, "Bruschetta"], [/br[uv]schetta/gi, "Bruschetta"], [/brvscetta/gi, "Bruschetta"],
  [/\bfr[ie]d\b/gi, "Fried"], [/grille?d/gi, "Grilled"], [/roaste?d/gi, "Roasted"],
  [/bake?d/gi, "Baked"], [/smoke?d/gi, "Smoked"], [/steame?d/gi, "Steamed"],
  [/sa[uv]tee?d/gi, "Sautéed"], [/poache?d/gi, "Poached"], [/scramble?d/gi, "Scrambled"],
  [/ch[ei]ese/gi, "Cheese"], [/cheez/gi, "Cheese"],
  [/broccol[il]/gi, "Broccoli"], [/m[uv]shroom/gi, "Mushroom"], [/mushro[o0]m/gi, "Mushroom"],
  [/avocado?/gi, "Avocado"], [/avocad[o0]/gi, "Avocado"],
  [/jalapeno/gi, "Jalapeño"], [/jalape[mn]o/gi, "Jalapeño"],
  [/fajit[as]/gi, "Fajita"], [/enchilad[as]/gi, "Enchilada"],
  [/q[uv]esadilla/gi, "Quesadilla"],
  [/ch[o0]colate/gi, "Chocolate"], [/vanill[as]/gi, "Vanilla"], [/carame[li]/gi, "Caramel"],
  [/strawberr[yt]/gi, "Strawberry"],
  [/waffles/gi, "Waffles"], [/waffle/gi, "Waffle"], [/pancakes/gi, "Pancakes"], [/pancake/gi, "Pancake"],
  [/muffins/gi, "Muffins"], [/muffi[mn]/gi, "Muffin"],
  [/terl?yak[l1i]/gi, "Teriyaki"], [/qulnoa/gi, "Quinoa"], [/whlte/gi, "White"], [/smoothl[ei]/gi, "Smoothie"],
  [/cvvkies/gi, "Cookies"], [/cvvkie/gi, "Cookie"], [/brow[nm]ie/gi, "Brownie"],
  [/donvts/gi, "Donuts"], [/donvt/gi, "Donut"],
  [/samosa[sz]/gi, "Samosa"], [/pakora[sz]/gi, "Pakora"],
  [/sh[ae]warma/gi, "Shawarma"], [/k[ea]bab/gi, "Kebab"], [/fala?fe[li]/gi, "Falafel"],
  [/tikk[as]/gi, "Tikka"], [/masal[as]/gi, "Masala"], [/biry[ae]ni/gi, "Biryani"],
  [/parath[as]/gi, "Paratha"], [/tortilla[sz]/gi, "Tortilla"], [/guacamole?/gi, "Guacamole"],
  [/croissant/gi, "Croissant"],
  [/mozzarella?/gi, "Mozzarella"], [/parmesan[ao]/gi, "Parmesan"], [/parm[ie]san/gi, "Parmesan"],
  [/ricott[as]/gi, "Ricotta"], [/gorgonzol[as]/gi, "Gorgonzola"],
  [/fontin[as]/gi, "Fontina"], [/provolone?/gi, "Provolone"], [/mascarpone?/gi, "Mascarpone"],
  [/cappvccino/gi, "Cappuccino"], [/capp[uv]ccino/gi, "Cappuccino"], [/cappucino/gi, "Cappuccino"],
  [/espresso?/gi, "Espresso"], [/espresso\w*/gi, "Espresso"], [/moch[as]/gi, "Mocha"], [/macchiato?/gi, "Macchiato"],
  [/limonade/gi, "Lemonade"], [/lemonad[es]/gi, "Lemonade"],
  [/smooth[ie]s/gi, "Smoothie"], [/cocktail[sz]/gi, "Cocktail"],
  [/stout\s*float/gi, "Stout Float"], [/\[?\bpa\b\]?/gi, "IPA"],
  [/sai?mon/gi, "Salmon"], [/risoh[o0]/gi, "Risotto"], [/tiramis[uv]/gi, "Tiramisu"],
  [/aperol[^\s]*\s*sprlz/gi, "Aperol Spritz"],
  [/margarit[as]/gi, "Margarita"], [/martin[i]s/gi, "Martini"],
  [/gvozas?/gi, "Gyoza"], [/dvmplings?/gi, "Dumpling"],
  [/tempvra/gi, "Tempura"], [/sashim[i]/gi, "Sashimi"],
  [/teriyaki?/gi, "Teriyaki"], [/yakitori?/gi, "Yakitori"],
  [/tonkatsu?/gi, "Tonkatsu"], [/edamame?/gi, "Edamame"],
  [/wasab[i]/gi, "Wasabi"], [/srirach[as]/gi, "Sriracha"],
  [/vinaigrette?/gi, "Vinaigrette"], [/a[io]oli?/gi, "Aioli"],
  [/hollandaise?/gi, "Hollandaise"], [/b[ée]arnaise?/gi, "Béarnaise"],
  [/tartar?/gi, "Tartar"], [/remoulade?/gi, "Remoulade"],
  // French menu staples — OCR drops accents; restore them for display
  [/cr[ée]me/gi, "Crème"], [/br[au]l[ée]e?/gi, "Brûlée"],
  [/huitres?/gi, "Huîtres"], [/fra[ic]hes?/gi, "Fraîches"], [/marinieres?/gi, "Marinières"],
  // "lb" weight suffix — OCR confuses l/I/1 ("1/2 Ib Burger" → "1/2 lb Burger")
  [/\b[Il1]b\b/gi, "lb"],
  [/caper[sz]/gi, "Caper"], [/artichoke?/gi, "Artichoke"],
  [/asparagus?/gi, "Asparagus"], [/zucch[ie]ni/gi, "Zucchini"],
  [/eggplant?/gi, "Eggplant"], [/cauliflower?/gi, "Cauliflower"],
  [/coriander?/gi, "Coriander"], [/cilantro?/gi, "Cilantro"],
  [/oregano?/gi, "Oregano"], [/rosemary?/gi, "Rosemary"],
  [/pomegranate?/gi, "Pomegranate"], [/pinapple/gi, "Pineapple"],
  [/coconvt/gi, "Coconut"], [/coconut?/gi, "Coconut"],
  [/mascarpone?/gi, "Mascarpone"],
  [/bechamel?/gi, "Béchamel"],
  [/mornay?/gi, "Mornay"],
  [/veloute?/gi, "Velouté"],
  [/gremolata?/gi, "Gremolata"],
  [/chimichurri?/gi, "Chimichurri"],
  [/pebre?/gi, "Pebre"],
  [/tzatziki?/gi, "Tzatziki"],
  [/yorkshire?/gi, "Yorkshire"],
  [/worcestershire?/gi, "Worcestershire"],
  [/horseradish?/gi, "Horseradish"],
  [/wasab[i]/gi, "Wasabi"],
];

function correctOCRErrors(text: string): string {
  let result = text;
  for (const [pattern, replacement] of OCR_CORRECTIONS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════
//  UTILITY: Noise detection
// ═══════════════════════════════════════════════════════════════════

export function isNoiseLine(text: string): boolean {
  const t = text.trim();
  if (t.length < 3) return true;

  const lower = t.toLowerCase();

  // Restaurant operation noise
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

  // Domain/URL anywhere
  if (/[a-z0-9][a-z0-9.-]*\.(com|org|net|io|app|me|us|co|uk|ca)(?:\/[^\s]*)?(?:\s|$)/i.test(t)) return true;

  // Phone numbers / emails
  if (/(\d{3}[.\-\s]\d{3}[.\-\s]\d{4})/.test(t)) return true;
  if (/@[a-z0-9.-]+\.[a-z]{2,}/i.test(t)) return true;

  // Social / footer
  if (/(?:follow|find|visit|connect)\s+us/i.test(t)) return true;
  if (/(?:order online|delivery|pickup|catering|delivery\s*available)/i.test(t)) return true;

  // Customer service / transactional noise
  if (/^(please|thank|thanks|enjoy|welcome|ask|inquire)/i.test(lower)) return true;
  if (/(?:pay at|pay upon|counter|cashier|reception)/i.test(lower)) return true;
  if (/(?:allergen|nutrition|ingredients|contains)/i.test(lower)) return true;
  if (/^hotel\b/i.test(lower)) return true;

  // Menu title / header noise (single short non-category headers)
  if (/^(menu|menus)$/i.test(t.trim())) return true;

  // Standalone venue/branding names that aren't dishes (1-2 words, no price markers)
  if (/^(restaurant|cafe|café|bistro|grill|grille|lounge|bar|truck|house|deli)$/i.test(t.trim())) return true;

  // URL-like text without dots (OCR can't read dots in URLs)
  if (/^www[a-z0-9]+(com|org|net|io|us|uk|ca)?$/i.test(t.trim()) && t.includes(".")) return false; // has dots, let domain filter handle
  if (/^www[a-z]/i.test(t.trim()) && !t.includes(".")) return true; // garbled URL

  // Single short word, capitalized, not food-related
  const words = t.split(/\s+/);
  if (words.length === 1 && words[0].length <= 3 && /^[A-Z][a-z]*$/.test(words[0])) return true;

  // All punctuation/noise
  if (/^[^\p{L}\p{N}]+$/u.test(t)) return true;

  // Mostly numbers
  const digitRatio = (t.match(/\d/g) || []).length / t.length;
  if (digitRatio > 0.5) return true;

  return false;
}

// ═══════════════════════════════════════════════════════════════════
//  UTILITY: Header / category detection
// ═══════════════════════════════════════════════════════════════════

function isHeaderLike(text: string, hasPrice: boolean, isCentered: boolean, lineWords: string[]): boolean {
  const t = text.trim().toLowerCase();
  if (hasPrice) return false;
  if (t.length < 2 || t.length > 80) return false;

  // Direct keyword match
  if (CATEGORY_KEYWORDS.has(t) || CATEGORY_KEYWORDS.has(t.replace(/s$/, ""))) return true;

  // Price-like content can never be a header. Defense-in-depth for callers
  // that don't pass hasPrice — dish lines like "Grilled Salmon $16.99" or
  // "Espresso $2.50" were being promoted to categories (first-word keyword
  // match), which ate the dish and poisoned the category of every line after.
  if (/[$€£¥]\s*\d|\b\d+[.,]\d/.test(t)) return false;

  // Check if first or last word matches a category keyword
  const firstWord = lineWords[0]?.toLowerCase();
  const lastWord = lineWords[lineWords.length - 1]?.toLowerCase();
  if (firstWord && CATEGORY_KEYWORDS.has(firstWord)) return true;
  if (lastWord && CATEGORY_KEYWORDS.has(lastWord)) return true;

  // All words are category keywords
  if (lineWords.length >= 2 && lineWords.length <= 5) {
    const allCategory = lineWords.every(w => CATEGORY_KEYWORDS.has(w.toLowerCase()));
    if (allCategory) return true;
  }

  // Short ALL-CAPS line with no price and no food word = section header
  // ("SMOKER", "SPECIALS"). All-caps is the classic menu-header signature —
  // dish names are title-case, and a food word ("BURGER") is a dish even in
  // caps. Guards: no price (a priced caps line is a dish), ≤3 words, and the
  // word must not be food-related (single-word caps dishes exist in fastfood
  // menus, e.g. "BURGER $5" — but that has a price; a bare "BURGER" without
  // a price on a fastfood menu stays a dish via this food-word guard).
  if (!hasPrice && lineWords.length <= 3 && text.trim() === text.trim().toUpperCase() &&
      !lineWords.some(w => isFoodRelated(w))) {
    return true;
  }

  // Short centered text with capital first letter. Venue titles ("The Golden
  // Fork") are centered title-case and have NO food words — a centered line
  // whose words ARE food-related is a dish (short no-price dishes like
  // "Chicken Quesadilla" can land mid-band and look centered), same guard
  // rule 620 uses for all-caps lines.
  if (isCentered && lineWords.length <= 4 && !/\d/.test(t) && /^[A-Z]/.test(text.trim()) &&
      !lineWords.some(w => isFoodRelated(w))) return true;

  return false;
}

// A single OCR word that could be part of a section header: all-caps or a
// known category keyword. Used to split merged header rows (two-column menus
// put "TACOS    COCKTAILS" on one physical line).
function isHeaderToken(word: string): boolean {
  return /^[A-Z]{2,}$/.test(word) || CATEGORY_KEYWORDS.has(word.toLowerCase());
}

// A header line that actually names a section (category keyword or all-caps),
// as opposed to a venue title like "The Golden Fork" (centered title-case).
function isHeaderCategoryLike(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    CATEGORY_KEYWORDS.has(t) ||
    CATEGORY_KEYWORDS.has(t.replace(/s$/, "")) ||
    text.trim() === text.trim().toUpperCase()
  );
}

// Reduce a header line to its category label. Text-only parsing cannot assign
// items to columns, so a header of 3+ discrete keywords ("TACOS COCKTAILS
// DRINKS") keeps only the first; 2-token phrases are left intact because
// "PIZZA COMBOS" / "CHEF SPECIALS" are legitimate single categories.
function categoryFromHeader(text: string): string {
  const tokens = text.trim().split(/\s+/);
  if (tokens.length >= 3 && tokens.length <= 5) {
    if (tokens.every(t => CATEGORY_KEYWORDS.has(t.toLowerCase()))) return tokens[0];
  }
  return text.trim();
}

// ═══════════════════════════════════════════════════════════════════
//  UTILITY: Price detection (multi-format)
// ═══════════════════════════════════════════════════════════════════

function normalizePrice(raw: string): number | null {
  let s = raw.trim();

  // Strip currency symbols and common prefixes/suffixes
  s = s.replace(/^[$€£¥Rs.\s]+/i, "");
  s = s.replace(/[$€£¥.\s]+$/i, "");

  // European comma decimal — AFTER the currency strip (so "$8,50" matches)
  // and BEFORE the comma removal below ("8,50" → 850 would otherwise parse
  // as 850, not 8.50). Thousand separators ("1,200") have 3 digits after
  // the comma and fall through to the separator removal.
  if (/^\d{1,3},\d{1,2}$/.test(s)) {
    s = s.replace(",", ".");
  }

  s = s.replace(/[,]/g, "");         // remove thousand separators
  s = s.replace(/[\/-]\s*$/, "");    // trailing "/-" or " /-"
  s = s.replace(/[^\d.,]/g, "");     // keep only digits, dot, comma

  if (!s) return null;

  // Handle European comma decimal: "14,50" → 14.50
  if (s.includes(",") && !s.includes(".")) {
    s = s.replace(",", ".");
  }

  // Handle "1299" → maybe $12.99 if last two digits look like cents
  if (s.length >= 4 && !s.includes(".")) {
    // Only do this for likely food prices (12.99 range, not 1299 which is $1299)
    const num = parseInt(s, 10);
    if (num < 1000) return num; // e.g., "999" = $999 is rare but possible
    // Assume last 2 digits are cents for 4-digit numbers starting with plausible whole price
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

function findPriceInText(text: string): PriceResult | null {
  const t = text.trim();

  // $12.99 or $ 12.99 or 12.99 at end of line
  // Also handle Tesseract misreading "$" as "S" (e.g. "S9.99" or "Margherita S9.99")
  // and space-separated cents from cursive/script fonts ("$10 00" → 10.00).
  // Trailing dots/spaces tolerated: script fonts put leader dots AFTER the
  // price ("$8,50. ...."), which would otherwise kill the end-anchor match.
  const trailing = t.match(/(?:^|\s)([$€£¥RsSs.]+\s*)?(\d{1,3}(?:[.,]\d{1,2})?|\d{1,3}\s+\d{2})[\s.]*$/);
  if (trailing) {
    const price = normalizePrice(trailing[0]);
    if (price !== null && price < 2000) {
      return { price, raw: trailing[0].trim(), position: "trailing" };
    }
  }

  // Left-side price: "$12.99 Chicken Burger" (some menus list price then name)
  const leading = t.match(/^[$€£¥Rs.]+\s*(\d{1,3}(?:[.,]\d{1,2})?)\s+/);
  if (leading) {
    const price = normalizePrice(leading[0]);
    if (price !== null && price < 2000) {
      return { price, raw: leading[0].trim(), position: "left_side" };
    }
  }

  return null;
}

function findPriceInWord(word: string): PriceResult | null {
  // Single word that IS a price: "$12.99", "12.99", "Rs.129"
  const m = word.match(/^[$€£¥Rs.]+\s*(\d{1,3}(?:[.,]\d{1,2})?)$/i);
  if (m) {
    const price = normalizePrice(m[0]);
    if (price !== null && price < 2000) {
      return { price, raw: m[0].trim(), position: "standalone" };
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
//  MERGED-ROW SPLITTER (local fallback)
//
//  "ICE MILK 77 BEAN" is really two dishes ("ICE MILK" @ 77 + "BEAN"):
//  OCR fuses adjacent rows into one line (or a vision engine transcribes
//  them on one line), and stripping only the trailing price would emit
//  dish1 + price + dish2 as a single item.
//
//  The PRIMARY splitter is the Ollama refine layer (a model reads the
//  text and splits intelligently). This deterministic helper is the
//  FALLBACK: it runs after refine and only fires when an item's name
//  still contains an embedded price — a no-op otherwise.
//
//  VERY conservative by design:
//   - The split price must be currency-prefixed or a 2+ digit bare
//     number — "Chicken 2 Ways", "Serves 2" and "1/2 lb Burger" NEVER
//     split (single bare digits are never prices here).
//   - The second half must start with a letter — "Spicy Chicken 65" is
//     one dish, not "Chicken" @ 65 + "65".
//   - Both halves must look like dish names: real words, not noise,
//     not description text, not a prefix word (with/extra/serves…).
//   - A single-word half is only accepted when it is a food word or
//     ALL-CAPS (BEAN, Wings, Tacos) so stray words never split.
// ═══════════════════════════════════════════════════════════════════
const DISH_PREFIX_WORDS =
  /^(extra|serves?|for|with|choice|add|plus|and|side|to|feeds?|serving|one|two|three|four|half|full|large|small|medium|regular|double|kids?|choose|ask|please)\b/i;

export function splitMergedDishLine(name: string, trailingPrice?: number): LocalOCRItem[] | null {
  // The second-half word class allows digits and currency symbols, not just
  // letters: fused rows can carry FURTHER prices ("Dish One $10 Dish Two
  // $12 Dish Three") and digit-start names ("Dish One $10 2 Piece
  // Chicken"). Both halves are re-checked by the guards below — and the
  // iterative fallback (splitMergedItemsFallback) re-runs this on each
  // output, so a second half that still embeds a price gets split further.
  // Mid-price alternatives also accept the SPACE-CENTS form ("$18 50"):
  // cleanDishName Stage 5f mangles embedded "$18.50" into "$18 50" before
  // this fallback runs, and "$18" alone would leave a stray "50" behind.
  const m = name.match(
    /^(.*?)\s+([$€£¥]\s*\d+(?:[.,]\d{1,2}|\s+\d{2})?|\d+[.,]\d{1,2}|\d+\s+\d{2}|\d{2,3})\s+([A-Za-z0-9$€£¥][A-Za-z0-9$€£¥&'-]*(\s+[A-Za-z0-9$€£¥][A-Za-z0-9$€£¥&'-]*)*)$/
  );
  if (!m) return null;
  const firstRaw = m[1].trim();
  const secondRaw = m[3].trim();
  if (!firstRaw || !secondRaw) return null;

  const first = cleanDishName(firstRaw);
  const second = cleanDishName(secondRaw);
  // Space-cents form ("$5 25"): cleanDishName Stage 5f turns embedded
  // "$5.25" into "$5 25" — collapse it back before parsing, otherwise
  // normalizePrice reads 525 (only 2-digit wholes survive its 1299 rescue).
  const midPrice = normalizePrice(m[2].replace(/\s+(\d{2})$/, ".$1"));
  if (midPrice === null || midPrice < 1 || midPrice >= 2000) return null;

  const firstWord = first.split(/\s+/)[0] || "";
  const secondWords = second.split(/\s+/).filter(Boolean);
  const firstOk =
    first.length >= 3 &&
    !isNoiseLine(first) &&
    !isDescriptionLine(first) &&
    !DISH_PREFIX_WORDS.test(first) &&
    hasSufficientRealWords(first) &&
    (isFoodRelated(firstWord) || first === first.toUpperCase());
  const secondOk =
    second.length >= 3 &&
    !isNoiseLine(second) &&
    !isDescriptionLine(second) &&
    !DISH_PREFIX_WORDS.test(second) &&
    hasSufficientRealWords(second) &&
    (secondWords.length >= 2 || isFoodRelated(second) || second === second.toUpperCase());
  if (!firstOk || !secondOk) return null;

  // If the parsed trailing price is the SAME token as the middle price,
  // the second dish has no price of its own (Shape B: "ICE MILK 77 BEAN").
  const secondPrice = trailingPrice !== undefined && trailingPrice !== midPrice ? trailingPrice : undefined;
  return [
    { name: correctOCRErrors(first).slice(0, 200), price: midPrice },
    { name: correctOCRErrors(second).slice(0, 200), ...(secondPrice !== undefined ? { price: secondPrice } : {}) },
  ];
}

/**
 * Post-parse safety net: any item whose name still contains an embedded
 * price ("Smoked Brisket $18.50 Pulled Pork Sandwich", "ICE MILK 77
 * BEAN", "Dish One $10 Dish Two $12 Dish Three") is split into two or
 * more dishes. No-op for every well-formed item.
 *
 * ITERATIVE: a fused row can carry several prices ("Dish One $10 Dish Two
 * $12 Dish Three $14" — the parser strips the trailing $14, leaving "Dish
 * One $10 Dish Two $12" + price 14). One pass only peels the FIRST dish;
 * we re-run the splitter on each output until nothing splits anymore
 * (bounded to 3 rounds — realistic fusion is 2-3 dishes per row).
 * Runs after the Ollama refine layer, which is the primary splitter.
 */
export function splitMergedItemsFallback(items: LocalOCRItem[]): LocalOCRItem[] {
  const out: LocalOCRItem[] = [];
  for (const item of items) {
    let pending: LocalOCRItem[] = [item];
    for (let depth = 0; depth < 3; depth++) {
      const next: LocalOCRItem[] = [];
      let splitThisRound = false;
      for (const p of pending) {
        const split = p.name ? splitMergedDishLine(p.name, p.price) : null;
        if (split) {
          // Preserve the original item's category/description on both halves —
          // the splitter itself only returns { name, price }.
          next.push({ ...p, ...split[0] }, { ...p, ...split[1] });
          splitThisRound = true;
        } else {
          next.push(p);
        }
      }
      pending = next;
      if (!splitThisRound) break; // stable — no more embedded prices
    }
    out.push(...pending);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
//  UTILITY: Dish name cleanup pipeline
// ═══════════════════════════════════════════════════════════════════

function cleanDishName(raw: string): string {
  let name = raw.trim();

  // Stage 1: Strip leading decorative symbols
  name = name.replace(/^[★☆⭐●◆▪▸▹►→▪•¶※✓✗✘✔✖✝✙✦✧⬟⬡⌾⭑✪✫✬✭✮✯✰✱✲✳✴✵✶✷✸✹✺✻✼✽✾✿❀]+/, "").trim();

  // Stage 2: Strip prefix modifiers — ONLY menu labels and venue names.
  // Food-descriptive words (GRILLED, ROASTED, SMOKED, FRESH, SPICY, HOUSE…)
  // are part of the dish name ("Grilled Salmon" ≠ "Salmon") and must NOT be
  // stripped. Standalone venue words are already caught by isNoiseLine.
  name = name
    .replace(/^(NEW!?|CHEF'?S?\s*SPECIAL|SIGNATURE|HOTEL|RESTAURANT|CAFE|CAFÉ|BAR|LOUNGE|GRILL|GRILLE|BISTRO)\s+/i, "")
    .trim();

  // Stage 3: Strip allergen/dietary tags like [GF] [V] [VG] (gf) (v)
  name = name.replace(/^\s*\[.*?\]\s*/, "").trim();
  name = name.replace(/\s*\[.*?\]\s*$/, "").trim();
  name = name.replace(/^\s*\(.*?\)\s*/, "").trim();
  name = name.replace(/\s*\(.*?\)\s*$/, "").trim();

  // Stage 4: Strip leading numbers like "1.", "1)", "1 Chicken Burger"
  name = name.replace(/^\d+[.)\s]+/, "").trim();

  // Stage 4b: Strip a leading PRICE token (RapidOCR on degraded photos emits
  // price-first lines, e.g. "$4 00 Espresso" or "$4.00 Espresso"). Require a
  // cents part so real numeric dish names ("1/2 lb Burger", "4 Cheese Pizza")
  // are untouched.
  name = name.replace(/^[$€£¥RsSs.]*\s*\d{1,3}(?:[.,]\s?\d{1,2}|\s+\d{2})\s+/, "").trim();

  // Stage 5: Strip trailing punctuation like ,; etc
  name = name.replace(/[;,]+$/, "").trim();

  // Stage 5b: Replace underscores with spaces (OCR noise)
  name = name.replace(/_/g, " ").replace(/\s+/g, " ").trim();

  // Stage 5c: Strip decorative dashes — remove leading/trailing hyphens,
  // multiple consecutive dashes, and dashes ONLY when they have adjacent spaces.
  // Keep single inner hyphens for legitimate names like "T-bone" or "Extra-Crunchy".
  name = name.replace(/^[-–—]+/, "").trim();                    // leading: "-Chicken" → "Chicken"
  name = name.replace(/[-–—]+$/, "").trim();                    // trailing: "Chicken-" → "Chicken"
  name = name.replace(/[-–—]{2,}/g, " ").replace(/\s+/g, " ").trim();  // double dash → space
  name = name.replace(/\s+[-–—]+\s+/g, " ").trim();             // "Chicken - Burger" → "Chicken Burger"
  name = name.replace(/^[-–—]+\s+/, "").trim();                 // "- Chicken" → "Chicken"

  // Stage 5d: Strip other noise characters — symbols, brackets, operators.
  // Digit fractions ("1/2 lb Burger") are protected first: the slash must not
  // become a space, which would shatter the name into size junk ("1 2 lb").
  name = name.replace(/(\d+)\s*\/\s*(\d+)/g, "$1\u2044$2");
  name = name.replace(/[*>{<}%]/g, " ").replace(/\s+/g, " ").trim();
  name = name.replace(/[|`~^\\]/g, " ").replace(/\s+/g, " ").trim();
  name = name.replace(/\u2044/g, "/");

  // Stage 5e: Strip lone parentheses and mixed brackets that aren't tag-like
  name = name.replace(/[(){}[\]]/g, " ").replace(/\s+/g, " ").trim();

  // Stage 5f: Handle dots — collapse multiple dots, strip leading/trailing,
  // and replace space-surrounded dots with space ("Chicken . Burger" → "Chicken Burger").
  name = name.replace(/\.{2,}/g, " ").replace(/\s+/g, " ").trim();    // multiple dots → space
  name = name.replace(/^\s*\.\s*/, "").trim();                         // leading dot
  name = name.replace(/\s*\.\s*$/, "").trim();                         // trailing dot
  name = name.replace(/\s+\.\s+/g, " ").trim();                        // "word . word" → "word word"
  name = name.replace(/\./g, " ").replace(/\s+/g, " ").trim();        // remaining single dots → space

  // Stage 6: Strip trailing "NEW" "SPICY" etc
  name = name.replace(/\s+(NEW|SPICY|HOT|MILD|CHEF'?S?\s*SPECIAL|SIGNATURE)$/i, "").trim();

  // Stage 6b: Strip trailing single "S" — Tesseract often misreads "$" as "S"
  // Only when it's the last character preceded by a space
  if (name.length > 3) {
    name = name.replace(/\s+S$/, "").trim();
  }

  // Stage 6c: Strip trailing standalone dietary markers left bare by OCR —
  // "Garden Salad v", "Quinoa Bowl vg", "Chowder gf" (parenthesized/bracketed
  // tags are already handled in Stage 3).
  name = name.replace(/\s+(?:V|VG|GF|DF|N)\s*$/i, "").trim();

  // Stage 6d: Strip trailing 1-2 char noise words from degraded photos —
  // dark menus read as "Smoked Brisket i i" / "Stout Float il imo ie a"
  // (garbage tails reject the item via hasSufficientRealWords, which needs
  // ≥60% of words to carry 3+ consecutive letters). Only strip from the END,
  // and never strip the whole name.
  let prev = name;
  while (name.length > 3) {
    const next = name.replace(/\s+\S{1,2}$/, "").trim();
    if (next === name) break;
    name = next;
  }
  if (name.length < 3) name = prev;

  // Stage 7: Collapse multiple spaces
  name = name.replace(/\s+/g, " ").trim();

  // If after all cleaning the name is too short, it was probably just noise
  if (name.length < 3 || /^[^\p{L}]+$/u.test(name)) return raw.trim();

  return name;
}

// ═══════════════════════════════════════════════════════════════════
//  UTILITY: Menu classification
// ═══════════════════════════════════════════════════════════════════

function classifyMenu(lines: TextLine[]): MenuLayout {
  if (lines.length === 0) return "unknown";

  const priceCount = lines.filter(l => l.hasPrice).length;
  const priceRatio = priceCount / lines.length;
  const avgTextLength = lines.reduce((s, l) => s + l.text.length, 0) / lines.length;

  if (priceRatio < 0.15) return "fastfood";
  if (avgTextLength > 45) return "descriptive";
  if (avgTextLength < 25) return "compact";
  return "unknown";
}

function classifyMenuText(rawText: string): { priceRatio: number; avgLineLen: number } {
  const lines = rawText.split(/\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { priceRatio: 0, avgLineLen: 0 };

  let priceLines = 0;
  let totalLen = 0;
  for (const line of lines) {
    if (/\$\s*\d/.test(line) || /\d+\.\d{2}/.test(line)) priceLines++;
    totalLen += line.length;
  }

  return { priceRatio: priceLines / lines.length, avgLineLen: totalLen / lines.length };
}

// ── Validate that a candidate dish name has enough real words ──
// Required: at least 60% of word-like tokens contain 3+ consecutive letters.
// Also: at least 2 words must meet this threshold for multi-word names.
// This prevents garbled OCR text like "fin re it ell" from passing.
// \p{L} (Unicode letters) keeps accented dishes like "Créme Bralée" valid —
// the old ASCII-only [a-zA-Z] gate rejected every French/Spanish/Italian
// name ("Bralée" has no 3-letter ASCII run).
const REAL_WORD_RE = /[\p{L}]{3,}/u;
const ANY_LETTER_RE = /[\p{L}]/u;

function hasSufficientRealWords(name: string): boolean {
  const words = name.split(/\s+/);
  if (words.length === 0) return false;
  // Tokens without letters ("1/2", "12"") are size/quantity info — they don't
  // count against the ratio ("1/2 lb Cheese Burger" is a valid dish name).
  const wordLike = words.filter(w => ANY_LETTER_RE.test(w));
  if (wordLike.length === 0) return false;
  const realWords = wordLike.filter(w => REAL_WORD_RE.test(w));
  const threshold = Math.max(1, Math.ceil(wordLike.length * 0.6));
  return realWords.length >= threshold;
}

// ═══════════════════════════════════════════════════════════════════
//  UTILITY: Adaptive confidence computation
// ═══════════════════════════════════════════════════════════════════

function computeConfidence(
  hasPrice: boolean,
  nameText: string,
  category: string,
  isCentered: boolean,
  isAllCaps: boolean,
  layout: MenuLayout
): number {
  let score = 0;

  // Has price = strongest signal
  if (hasPrice) score += 0.4;

  // Food-related words
  const words = nameText.toLowerCase().split(/\s+/);
  const foodWords = words.filter(w => isFoodRelated(w));
  score += Math.min(foodWords.length * 0.15, 0.35);

  // Under a category header
  if (category) score += 0.15;

  // Word count sweet spot
  if (words.length >= 2 && words.length <= 6) score += 0.1;
  else if (words.length > 8) score -= 0.15;

  // All caps unlikely for dish name
  if (isAllCaps && !hasPrice) score -= 0.15;

  // Contains non-price digits
  if (/\d/.test(nameText) && !nameText.match(/\d+\.\d{2}/)) score -= 0.1;

  // Length penalty
  if (nameText.length < 5) score -= 0.1;

  // Generic word penalty
  const genericWords = ["the", "and", "with", "for", "our", "all", "your", "from"];
  const genericCount = words.filter(w => genericWords.includes(w)).length;
  if (genericCount > words.length * 0.5) score -= 0.2;

  // Centered line less likely dish
  if (isCentered) score -= 0.1;

  // Layout adjustments
  if (layout === "fastfood" && !hasPrice) score -= 0.1;
  if (layout === "descriptive" && words.length <= 3) score += 0.1;

  return Math.max(0, Math.min(1, score));
}

function dynamicThreshold(dishes: ParsedDish[]): number {
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

// ═══════════════════════════════════════════════════════════════════
//  LAYER 3: Basic line filter (fallback for garbled OCR)
// ═══════════════════════════════════════════════════════════════════

function basicExtract(raw_text: string): LocalOCRItem[] {
  const lines = raw_text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 1);

  const items: LocalOCRItem[] = [];
  const seen = new Set<string>();
  let currentCategory = "";

  // Venue block: lines before the first section header (restaurant name,
  // tagline, address...) are never dishes — but only when the menu actually
  // has section headers (headerless fastfood menus keep their no-price items).
  const firstHeaderIdx = lines.findIndex(l => {
    const p = findPriceInText(l);
    return isHeaderLike(l, !!p, false, l.split(/\s+/));
  });
  const hasHeaders = firstHeaderIdx >= 0;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    // Skip obvious noise
    if (isNoiseLine(line)) continue;

    const cleaned = line.replace(/[|]/g, " ").replace(/\s+/g, " ").trim();
    const price = findPriceInText(cleaned);
    const wordCount = cleaned.split(/\s+/).length;

    // Venue/header block before the first section header
    if (hasHeaders && li < firstHeaderIdx && !price) continue;

    // Skip description lines (not dish names) — never when the line has a
    // price: "Avocado Toast (v) $11.00" is a dish, not a description, and the
    // dietary-marker check in isDescriptionLine would eat it.
    if (!price && isDescriptionLine(cleaned)) continue;

    // Extract name (remove price if trailing)
    let name = cleaned;
    if (price && price.position === "trailing") {
      name = cleaned.slice(0, cleaned.lastIndexOf(price.raw)).trim();
    } else if (price && price.position === "left_side") {
      name = cleaned.replace(/^[$€£¥Rs.]+\s*\d+(?:[.,]\d+)?\s+/, "").trim();
    }

    if (!name || wordCount > 25) continue;
    if (!REAL_WORD_RE.test(name)) continue;
    // Require at least 60% of individual words to have 3+ letters (reject garbled OCR)
    if (!hasSufficientRealWords(name)) continue;

    // Category headers in flat menus (lines with no price that are category
    // names) — skipped, but tracked so items below inherit the section.
    if (!price && wordCount <= 4) {
      const nameLower = name.toLowerCase().trim();
      const isCategoryHeader =
        CATEGORY_KEYWORDS.has(nameLower) || CATEGORY_KEYWORDS.has(nameLower.replace(/s$/, ""));
      // Also all-caps short lines with no price and no food words
      const nameWords = nameLower.split(/\s+/);
      const hasFoodWord = nameWords.some(w => isFoodRelated(w));
      const isAllCapsHeader = !hasFoodWord && wordCount <= 3 && name === name.toUpperCase();
      if (isCategoryHeader || isAllCapsHeader) {
        currentCategory = categoryFromHeader(name);
        continue;
      }
    }

    // Clean and validate
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
    });
  }

  return items.slice(0, 50);
}

// ═══════════════════════════════════════════════════════════════════
//  LAYER 2: Sequential blank-line block parser
// ═══════════════════════════════════════════════════════════════════

function sequentialParse(rawText: string): LocalOCRItem[] {
  const { priceRatio, avgLineLen } = classifyMenuText(rawText);
  const layout: MenuLayout = priceRatio < 0.15 ? "fastfood" : avgLineLen > 45 ? "descriptive" : "compact";

  // Split into blocks by blank lines
  const blocks = rawText
    .split(/\n\s*\n/)
    .map(b => b.trim())
    .filter(b => b.length > 0);

  if (blocks.length < 2) {
    // No clear block structure — fall through to basic
    return basicExtract(rawText);
  }

  const dishes: ParsedDish[] = [];
  let currentCategory = "";
  let headerSeen = false;
  const seen = new Set<string>();
  let sourceIndex = 0;

  // Does the menu have any section headers at all? Headerless (pure list)
  // menus must NOT apply the venue-block skip, or their first no-price dish
  // would be eaten.
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

    // Process lines for dishes. Headers can appear anywhere in a block: the
    // blank-line split puts the NEXT section's header at the END of the
    // previous block ("...Chicken Wings\nMains"), so every line is checked.
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isNoiseLine(line)) continue;

      // Section header detection — priced lines are never headers, so a dish
      // line like "Grilled Salmon $16.99" can't be consumed as a category.
      const priceOnLine = findPriceInText(line);
      if (isHeaderLike(line, !!priceOnLine, false, line.split(/\s+/))) {
        currentCategory = categoryFromHeader(line.trim());
        headerSeen = true;
        continue;
      }

      // Venue block: no-price lines before the first section header are the
      // restaurant name / tagline, not dishes — only when the menu has headers.
      if (menuHasHeaders && !headerSeen && !priceOnLine) continue;

      // Single number or price-only line
      if (/^\d+(?:\.\d{1,2})?$/.test(line.trim())) continue;
      // Skip description lines (not dish names) — never when priced: the
      // dietary-marker check ((v), [GF]) would eat real dish lines like
      // "Avocado Toast (v) $11.00".
      if (!priceOnLine && isDescriptionLine(line)) continue;

      // Check for size variant pattern: "Small 9.99 / Large 12.99"
      if (/(Small|Regular|Single|Large|Double|Medium)\s+[$€£¥]?\s*\d/.test(line)) {
        const baseName = line
          .replace(/(Small|Regular|Single|Large|Double|Medium|Kids?)\s+[$€£¥]?\s*\d+(?:[.,]\d+)?\s*\/?\s*/g, "")
          .trim();
        if (baseName && baseName.length > 3) {
          const cleaned = cleanDishName(baseName);
          if (!seen.has(cleaned.toLowerCase()) && !isNoiseLine(cleaned)) {
            seen.add(cleaned.toLowerCase());
            const prices = [...line.matchAll(/(\d+(?:[.,]\d{1,2})?)/g)].map(m => parseFloat(m[1].replace(",", ".")));
            // "Small $5.00 / Large $8.00" → entry price is the FIRST (small) size
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

      // Detect price on this line
      let name = line;
      let price = priceOnLine?.price;

      if (priceOnLine && priceOnLine.position === "trailing") {
        name = line.slice(0, line.lastIndexOf(priceOnLine.raw)).trim();
      } else if (priceOnLine && priceOnLine.position === "left_side") {
        name = line.replace(/^[$€£¥Rs.]+\s*\d+(?:[.,]\d+)?\s+/, "").trim();
      }

      // No price on this line — check next line for standalone price
      if (!priceOnLine && i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        const nextPrice = findPriceInText(nextLine);
        if (nextPrice && nextPrice.position === "trailing") {
          // Only if nextline is basically just a price
          const nextClean = nextLine.replace(nextPrice.raw, "").trim();
          if (nextClean.length === 0 || nextClean.length < 3) {
            price = nextPrice.price;
            i++; // consume the price line
          }
        }
      }

      // Validate name
      name = cleanDishName(name);
      const words = name.split(/\s+/);
      if (name.length < 3) continue;
      if (!REAL_WORD_RE.test(name)) continue;
      if (!hasSufficientRealWords(name)) continue;
      if (isNoiseLine(name)) continue;

      // For fastfood layout without price, require at least one food word
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

  // Apply adaptive threshold
  const threshold = dynamicThreshold(dishes);
  return dishes
    .filter(d => d.confidence >= threshold)
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .map(d => ({
      name: d.name,
      description: d.description || "",
      price: d.price,
      category: d.category || "other",
    }))
    .slice(0, 50);
}

// ═══════════════════════════════════════════════════════════════════
//  LAYER 1: Positional parser (bounding box data)
// ═══════════════════════════════════════════════════════════════════

// A Y-row carrying 2+ standalone price tokens is usually TWO dishes fused
// from a two-column layout ("Dish One $10  Dish Two $12" — the header-split
// above only fires on header-like tokens, so dish rows reach here whole).
// Re-segment the word array at the WIDEST internal gaps (a column gutter),
// so detectColumns sees clean per-column rows instead of one full-width line.
//
// Deliberately conservative:
//  - Size-variant rows ("Small $5 / Large $8") are ONE dish — never split.
//  - A cut needs a wide gap AND a next word that isn't an add-on prefix
//    ("Chicken $10 Add $2" is one dish; the price before "Add" is an add-on).
//  - Every resulting segment must start with a letter — otherwise the cut
//    was wrong and we bail, leaving the row for the iterative text splitter
//    (splitMergedItemsFallback), which handles single-column fusion.
function splitMultiPriceRow(words: WordPos[], imgWidth: number): WordPos[][] {
  const priceIdx = words
    .map((w, i) => (findPriceInWord(w.text) ? i : -1))
    .filter((i) => i >= 0);
  if (priceIdx.length < 2) return [words];

  const text = words.map((w) => w.text).join(" ");
  if (/(Small|Regular|Single|Large|Double|Medium|Kids?)\s+[$€£¥]?\s*\d/.test(text) && text.includes("/")) {
    return [words]; // size-variant row — one dish
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

  const segments: WordPos[][] = [];
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

function groupIntoLines(words: WordPos[]): TextLine[] {
  if (words.length === 0) return [];

  // Sort by Y, then X
  const sorted = [...words].sort((a, b) => {
    const yDiff = a.y - b.y;
    if (Math.abs(yDiff) > 8) return yDiff;
    return a.x - b.x;
  });

  // Group words on the same line by Y-proximity (≤10px tolerance)
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

    // Split merged header rows: two-column menus put both section headers on
    // one physical line ("TACOS    COCKTAILS"). When a large X-gap separates
    // two header-like words, treat each side as its own line so column
    // detection and category propagation work per column. Item rows are safe:
    // a price token is never header-like, so "name ....... $9.99" won't split.
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
      // Multi-price row split (splitMultiPriceRow): a Y-row that fuses two
      // columns' dishes ("Dish One $10  Dish Two $12") becomes per-column
      // sub-lines BEFORE detectColumns — otherwise the full-width line lands
      // in a single column and embeds the other dish into it.
      const subSegments = splitMultiPriceRow(seg, imgWidth);
      for (const seg of subSegments) {
        if (seg.length === 0) continue;
        const text = seg.map(w => w.text).join(" ").trim();
        if (!text) continue;

        const minX = Math.min(...seg.map(w => w.x));
        const minY = Math.min(...seg.map(w => w.y));
        const maxX = Math.max(...seg.map(w => w.x + w.w));
        const maxY = Math.max(...seg.map(w => w.y + w.h));

        // Price in last 1-2 words
        let hasPrice = false;
        let price: number | undefined;
        let priceEndX = 0;

        for (let w = seg.length - 1; w >= Math.max(0, seg.length - 3); w--) {
          const pr = findPriceInWord(seg[w].text);
          if (pr) {
            hasPrice = true;
            price = pr.price;
            priceEndX = seg[w].x + seg[w].w;
            break;
          }
        }

        // Also try price at end of full text
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
        // Truly centered = roughly equal left/right margins. A short LEFT-ALIGNED
        // line (a no-price dish like "Chicken Quesadilla" at x=64) can still land
        // its midX inside the 25-75% band — mislabeling it centered promotes it to
        // a section header (isHeaderLike's centered rule) and silently eats the
        // dish. Asymmetry > 20% of the canvas means the line hugs one margin.
        const leftMargin = minX;
        const rightMargin = imgWidth - maxX;
        const isCentered = midX > imgWidth * 0.25 && midX < imgWidth * 0.75 &&
          (maxX - minX) < imgWidth * 0.7 && Math.abs(leftMargin - rightMargin) < imgWidth * 0.2;
        const isAllCaps = text === text.toUpperCase() && /[A-Z]{4,}/.test(text);

        lines.push({
          text,
          x: minX,
          y: minY,
          w: maxX - minX,
          h: maxY - minY,
          words: seg,
          hasPrice,
          price,
          priceEndX,
          isCentered,
          isAllCaps,
          isHeader: isHeaderLike(text, hasPrice, isCentered, lineWords),
        });
      } // end sub-segment loop (splitMultiPriceRow)
    }
  }

  return lines;
}

function detectColumns(lines: TextLine[]): Column[] {
  if (lines.length === 0) return [];
  const imgWidth = Math.max(...lines.map(l => l.x + l.w), 1);
  if (imgWidth === 0) return [{ lines, xMin: 0, xMax: 0 }];

  const mid = imgWidth / 2;
  const leftLines = lines.filter(l => l.x + l.w / 2 < mid);
  const rightLines = lines.filter(l => l.x + l.w / 2 >= mid);

  if (leftLines.length >= 2 && rightLines.length >= 2) {
    // A side that is mostly price-only lines is a right-aligned PRICE column
    // (degraded layout where price boxes sit on their own row), not a menu
    // column. Keep everything unified so the split-price pairing logic can
    // attach each price to its dish name.
    const isPriceOnly = (l: TextLine) => /^[$€£¥]?\s*\d+(?:[.,]\d{1,2})?\s*$/.test(l.text.trim());
    const leftPriceShare = leftLines.filter(isPriceOnly).length / leftLines.length;
    const rightPriceShare = rightLines.filter(isPriceOnly).length / rightLines.length;
    if (leftPriceShare >= 0.6 || rightPriceShare >= 0.6) {
      return [{ lines: lines.sort((a, b) => a.y - b.y), xMin: 0, xMax: imgWidth }];
    }

    // Exclude centered lines (venue titles spanning the middle) from the gap
    // check — they bridge two genuine columns and would prevent the split.
    const leftSpan = leftLines.filter(l => !l.isCentered);
    const rightSpan = rightLines.filter(l => !l.isCentered);
    const leftMaxX = leftSpan.length ? Math.max(...leftSpan.map(l => l.x + l.w)) : Math.max(...leftLines.map(l => l.x + l.w));
    const rightMinX = rightSpan.length ? Math.min(...rightSpan.map(l => l.x)) : Math.min(...rightLines.map(l => l.x));
    if (rightMinX - leftMaxX > imgWidth * 0.08) {
      return [
        { lines: leftLines.sort((a, b) => a.y - b.y), xMin: 0, xMax: leftMaxX },
        { lines: rightLines.sort((a, b) => a.y - b.y), xMin: rightMinX, xMax: imgWidth },
      ];
    }
  }

  return [{ lines: lines.sort((a, b) => a.y - b.y), xMin: 0, xMax: imgWidth }];
}

function parseColumn(column: Column): ParsedDish[] {
  const lines = column.lines;
  const dishes: ParsedDish[] = [];
  let currentCategory = "";
  let pendingDish: ParsedDish | null = null;
  let nextIndex = 0;
  let categoryLineIndex = -1;
  let seenCategoryHeader = false;
  // A price-only line ("$9.50") whose dish name sits on the NEXT row — happens
  // on degraded/rotated photos where RapidOCR puts price boxes on their own
  // line. Attached to the next no-price dish line.
  let pendingPrice: number | undefined = undefined;

  // Classify menu type for adaptive behavior
  const layout = classifyMenu(lines);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Price-only line: capture BEFORE isNoiseLine — its digit ratio marks it
    // as noise, but in split-price layouts (degraded photos put price boxes
    // on their own row) it is the dish price that must pair with the name
    // on the next line. Trailing dots tolerated (script fonts: "$8,50. ....").
    if (/^[$€£¥]?\s*\d+(?:[.,]\d{1,2})?\s*\.*\s*$/.test(line.text.trim()) && line.price !== undefined) {
      pendingPrice = line.price;
      continue;
    }
    if (isNoiseLine(line.text)) continue;

    // A dish line with its OWN price cannot also absorb a pending (orphan)
    // price from an earlier price-only line — otherwise the orphan leaks
    // onto a LATER no-price dish ("$10 / Dish One $12 / Dish Two" → Dish
    // Two wrongly @10). The pending price was either noise or belonged to a
    // dish above; either way it is not this dish's. Priced headers clear it
    // too (the isHeader branch below also resets it — additive here).
    if (line.hasPrice) {
      pendingPrice = undefined;
    }

    // Category header detection
    if (line.isHeader) {
      const catText = line.text.trim();
      // A title-case line followed by a price-only line is a dish with a
      // split price ("Iced Tea" / "$2.75" — RapidOCR puts the price box on
      // its own row), even when its last word is a category keyword ("tea").
      // All-caps section headers keep header status; and only after a real
      // category header exists (so "Chef Specials" as the FIRST header stays
      // a header even if a price line sits below it).
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
      // Flush any pending dish
      if (pendingDish) { dishes.push(pendingDish); pendingDish = null; }

      // A price-only line preceded this "header": in degraded layouts the
      // price box sits on its own row above the name, so this line is really
      // a dish ("$2.75" then "Iced Tea", "$6.50" then "Cheesecake"). Only
      // all-caps headers keep header status — a title-case "header" directly
      // after a price is a priced dish, even when it's a category keyword
      // (cheesecake, tiramisu, soup).
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

      // Venue gate: the FIRST header in a column must look like a real section
      // (category keyword or all-caps). Restaurant titles ("The Golden Fork")
      // are centered title-case and must not become the category of everything
      // below. An ALL-CAPS title ("STEEL & OAK") passes the category-like test
      // though — so if the next line is a venue subtitle (title-case, no price,
      // carries an "Est." or year signature), this first header is the
      // restaurant name, not a section: skip it, keep looking for a real one.
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

    // Recover swallowed headers: Y-grouping can merge the venue subtitle into
    // the next section header ("Est. 1998 • Fine Dining APPETIZERS"), which
    // fails isHeaderLike and silently eats the category. If the line contains
    // digits (subtitle signature) plus an ALL-CAPS category keyword, that
    // keyword is the real header.
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

    // Category expires after 15 lines
    if (currentCategory && i - categoryLineIndex > 15) {
      currentCategory = "";
    }

    // Skip number-only lines
    if (/^\d+(?:\.\d+)?$/.test(line.text.trim())) continue;

    // Name extraction with price
    const nameText = line.text.trim();
    const words = nameText.split(/\s+/).length;

    // Check for size variant pattern
    if (/(Small|Regular|Single|Large|Double|Medium)\s+[$€£¥]?\s*\d/.test(nameText)) {
      if (pendingDish) { dishes.push(pendingDish); pendingDish = null; }

      const baseName = nameText
        .replace(/(Small|Regular|Single|Large|Double|Medium|Kids?)\s+[$€£¥]?\s*\d+(?:[.,]\d+)?\s*\/?\s*/g, "")
        .trim();
      if (baseName && baseName.length > 3) {
        const prices = [...nameText.matchAll(/(\d+(?:[.,]\d{1,2})?)/g)].map(m => parseFloat(m[1].replace(",", ".")));
        // "Small $5.00 / Large $8.00" → entry price is the FIRST (small) size
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

    // No-price line with a price-only line BEFORE it (price-first ordering:
    // degraded photos put the price box above the name). The pending price is
    // THIS dish's price — consume it before the 2-line pattern can misread the
    // next row's price as ours.
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

    // 2-line split pattern: name on this line, price-only line right below
    // (RapidOCR splits price boxes onto their own row on some menus).
    // NOTE: no isNoiseLine() guard on nxt — a price-only line like "$8.75" IS
    // "noise" by digitRatio (3 digits / 5 chars = 0.6 > 0.5), so the guard
    // would silently block every price attach and cascade the price to the
    // NEXT name. hasPrice + price !== undefined already proves it's a price.
    // The nxt line must be PRICE-ONLY, though: a name+price line below a
    // no-price header ("SMOKER" + "Smoked Brisket $18.50") must not donate
    // its price to the header — the header would steal the real dish's price.
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

    // 3-line fine-dining pattern: name / description / price
    if (!line.hasPrice && i + 2 < lines.length) {
      const next1 = lines[i + 1];
      const next2 = lines[i + 2];
      // next1 must not be a header: "Est. 1998 • Fine Dining" + "APPETIZERS" +
      // "Truffle Arancini $9.50" would otherwise read as name/desc/price and
      // swallow the section header and its first dish. next2 is a price line —
      // price-only lines are "noise" by digitRatio, so no isNoiseLine there.
      // Two more guards learned from the dark menu: the pattern fires on
      // "Gastro Pub · Est. 2011" + "SMOKER" + "Smoked Brisket $18.50" and
      // eats the first real dish (its price line becomes the fake item's).
      //  - line must not be a venue subtitle: centered, and digits ("Est. 2011")
      //    are a subtitle signature, never a dish name.
      //  - next1 must not be ALL-CAPS: section headers (SMOKER, DESSERTS) are
      //    all-caps but are not category keywords, so isHeader misses them;
      //    descriptions are mixed-case.
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

    // Standard price on this line
    if (line.hasPrice && line.price !== undefined) {
      if (pendingDish) { dishes.push(pendingDish); pendingDish = null; }

      // Strip the parsed trailing price BEFORE cleaning: cleanDishName's
      // dot-strip stage turns "$9.99" into "$9 99", which then fails the
      // real-word gate and drops the dish entirely.
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

    // No price on this line
    if (words >= 1 && words <= 25 && /[a-zA-Z]{3,}/.test(nameText)) {
      const cleaned = cleanDishName(nameText);
      if (cleaned.length < 3) continue;

      // Check if this could be a dish name (even without price)
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
        // Could be a description or multi-line dish name
        if (isDescriptionLine(cleaned)) {
          pendingDish.description = cleaned;
        } else if (words <= 6) {
          // Multi-line dish name continuation
          pendingDish.name += " " + cleaned;
          pendingDish.confidence = Math.min(pendingDish.confidence + 0.05, 1);
        }
      }
    }
  }

  if (pendingDish) dishes.push(pendingDish);
  return dishes;
}

function nameTableEntry(nameText: string, category: string, layout: MenuLayout): boolean {
  const t = nameText.toLowerCase().trim();
  const words = t.split(/\s+/);
  if (words.length < 2 && !isFoodRelated(t)) return false;

  // Check for food-related content
  const foodWords = words.filter(w => isFoodRelated(w));

  // In pizza or dessert category, be more lenient
  if (category.toLowerCase().includes("pizza") || category.toLowerCase().includes("dessert")) {
    return foodWords.length >= 1 || words.length >= 2;
  }

  // In fastfood layout, require food words
  if (layout === "fastfood") return foodWords.length >= 1;

  // Standard: at least one food word
  return foodWords.length > 0;
}

function isDescriptionLine(text: string): boolean {
  const t = text.toLowerCase().trim();

  // Starts with ingredient/prep words — \b so "onion" isn't caught by "on"
  // (a word-boundary bug that mislabeled dishes like Onion Rings as
  // descriptions and blocked merged-row splitting).
  if (/^(with|in|on|served|topped|drizzled|accompanied|comes|available|choice|side|and|plus|add)\b/i.test(t)) return true;

  // Allergen / dietary info
  if (/\b(gf|v|vg|df|contains|allergen|nut)\b/i.test(t)) return true;

  // Long line = description
  if (t.length > 100) return true;

  // High ratio of descriptive marker words
  const descMarkers = ["with", "fresh", "sautéed", "roasted", "grilled", "baked", "served",
    "topped", "drizzled", "alongside", "accompanied", "choice", "side", "in", "on", "and", "plus"];
  const words = t.split(/\s+/);
  const markerCount = words.filter(w => descMarkers.includes(w)).length;
  if (markerCount >= 2 && words.length <= 10) return true;

  return false;
}

// ═══════════════════════════════════════════════════════════════════
//  PARAGRAPH-AWARE PARSE — uses Tesseract's own layout segmentation
//  Each Tesseract paragraph = a logical block.
//  We reuse groupIntoLines + parseColumn per paragraph.
// ═══════════════════════════════════════════════════════════════════

interface TesseractPara {
  text?: string;
  lines?: Array<{ text?: string; words?: Array<{ text?: string; bbox?: { x0: number; y0: number; x1: number; y1: number }; confidence?: number }> }>;
  words?: Array<{ text?: string; bbox?: { x0: number; y0: number; x1: number; y1: number }; confidence?: number }>;
}

function extractParagraphs(resultData: any): ParagraphInfo[] {
  const paragraphs: ParagraphInfo[] = [];

  // Try direct data.paragraphs first (Tesseract.js v7+)
  const directParas: TesseractPara[] = resultData.paragraphs;
  if (directParas && directParas.length > 0) {
    for (const para of directParas) {
      const paraText = (para.text || "").trim();
      if (!paraText) continue;

      // Extract words from paragraph (either direct or via lines)
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

  // Fallback: extract from blocks → paragraphs
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

function paragraphAwareParse(paragraphs: ParagraphInfo[], rawText: string): LocalOCRItem[] {
  if (paragraphs.length < 2) {
    // Not enough paragraphs — fall back to word-level
    return smartParse(rawText, paragraphs[0]?.words || []);
  }

  const allDishes: ParsedDish[] = [];
  let sourceIndex = 0;

  for (const para of paragraphs) {
    if (para.lines.length === 0) continue;

    // Each paragraph is its own "column" (menu section)
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

  // Apply adaptive threshold + dedup (same as smartParse)
  const threshold = dynamicThreshold(allDishes);
  const seen = new Set<string>();
  const items: LocalOCRItem[] = [];

  for (const dish of allDishes.sort((a, b) => a.sourceIndex - b.sourceIndex)) {
    const key = dish.name.toLowerCase().trim();
    if (key.length < 3 || seen.has(key)) continue;
    seen.add(key);

    const corrected = correctOCRErrors(dish.name).trim();
    if (corrected.length < 3 || isNoiseLine(corrected + " x")) continue;
    if (!REAL_WORD_RE.test(corrected)) continue;
    if (!hasSufficientRealWords(corrected)) continue;
    if (dish.confidence < threshold) continue;

    items.push({
      name: corrected.slice(0, 200),
      description: dish.description ? correctOCRErrors(dish.description).trim().slice(0, 500) : "",
      price: dish.price,
      category: dish.category || guessCategory(corrected),
    });
  }

  return items;
}

// ═══════════════════════════════════════════════════════════════════
//  POSITIONAL SMART PARSE (Layer 1 orchestrator)
// ═══════════════════════════════════════════════════════════════════

function smartParse(rawText: string, words: WordPos[]): LocalOCRItem[] {
  const lines = groupIntoLines(words);
  if (lines.length < 2) return sequentialParse(rawText);

  const columns = detectColumns(lines);
  const allDishes: ParsedDish[] = [];

  for (const column of columns) {
    const columnDishes = parseColumn(column);
    allDishes.push(...columnDishes);
  }

  // Apply adaptive threshold
  const threshold = dynamicThreshold(allDishes);
  const seen = new Set<string>();
  const items: LocalOCRItem[] = [];

  for (const dish of allDishes.sort((a, b) => a.sourceIndex - b.sourceIndex)) {
    const key = dish.name.toLowerCase().trim();
    if (key.length < 3 || seen.has(key)) continue;
    seen.add(key);

    const corrected = correctOCRErrors(dish.name).trim();
    if (corrected.length < 3 || isNoiseLine(corrected + " x")) continue;
    if (!REAL_WORD_RE.test(corrected)) continue;
    if (!hasSufficientRealWords(corrected)) continue;

    // Cross-validation: if this dish confidence is far below median, skip
    if (dish.confidence < threshold) continue;

    items.push({
      name: corrected.slice(0, 200),
      description: dish.description ? correctOCRErrors(dish.description).trim().slice(0, 500) : "",
      price: dish.price,
      category: dish.category || guessCategory(corrected),
    });
  }

  return items;
}

// ═══════════════════════════════════════════════════════════════════
//  POST-PROCESSING: Cross-validation & dedup
// ═══════════════════════════════════════════════════════════════════

function crossValidate(items: LocalOCRItem[]): LocalOCRItem[] {
  if (items.length <= 1) return items;

  // Collect all prices
  const prices = items.filter(i => i.price !== undefined).map(i => i.price as number);
  if (prices.length >= 3) {
    const sorted = [...prices].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((s, p) => s + (p - mean) ** 2, 0) / prices.length;
    const stdDev = Math.sqrt(variance);

    // Flag items with prices > 3σ from mean as likely OCR errors
    // These are usually digit insertion errors (€4.99 → €64.99)
    const lowerBound = mean - 3 * stdDev;
    const upperBound = mean + 3 * stdDev;
    for (const item of items) {
      if (item.price !== undefined && (item.price < lowerBound || item.price > upperBound)) {
        // Remove the price — it's almost certainly corrupted by OCR
        item.price = undefined;
      }
    }
  }

  // Deduplicate items with 80%+ word overlap
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
        // Keep the shorter, cleaner name (usually the correct one)
        if (items[j].name.length < best.name.length) best = items[j];
        used.add(j);
      }
    }

    result.push(best);
    used.add(i);
  }

  return result;
}

// Parse a candidate's OCR data through the standard parser dispatch. Shared
// by the real pipeline and the parse-quality winner selection below.
function parseResultData(resultData: any): LocalOCRItem[] {
  const raw_text = resultData.text || "";
  const rawWords: any[] = resultData.words || [];

  // Clean the OCR text before parsing (venue/noise lines dropped, split
  // prices merged) so every parser sees a tidy menu — and so the
  // parse-quality winner selection scores the same cleaned text the real
  // pipeline will parse.
  const cleaned = cleanOCRText(raw_text);
  const parseText = cleaned.text;

  // Filter low-confidence words BEFORE any parsing
  const words: WordPos[] = rawWords
    .filter((w: any) => (w.confidence ?? 0) >= 25) // filter garbage OCR
    .map((w: any) => ({
      text: w.text || "",
      x: w.bbox?.x0 ?? 0,
      y: w.bbox?.y0 ?? 0,
      w: (w.bbox?.x1 ?? 0) - (w.bbox?.x0 ?? 0),
      h: (w.bbox?.y1 ?? 0) - (w.bbox?.y0 ?? 0),
      confidence: w.confidence ?? 0,
    }));

  // Extract paragraph-level structure from Tesseract
  const paragraphs = extractParagraphs(resultData);

  // Layer 1: Paragraph-aware parser (uses Tesseract's own text grouping)
  // Preferred when we have 2+ paragraphs with good word data
  const hasParaWords = paragraphs.some(p => p.words.length >= 3);
  if (paragraphs.length >= 2 && hasParaWords) {
    return paragraphAwareParse(paragraphs, parseText);
  }
  // Layer 2: Positional parser (word bbox data)
  if (words.length > 3) {
    const hasPositionData = words.some(w => w.x !== 0 || w.y !== 0);
    const hasGoodConfidence = words.filter(w => w.confidence > 50).length >= 3;
    if (hasPositionData && hasGoodConfidence) {
      return smartParse(parseText, words);
    }
    return sequentialParse(parseText);
  }
  // Layer 3: Sequential parser (blank-line blocks)
  if (parseText.split(/\n\s*\n/).length >= 2) {
    return sequentialParse(parseText);
  }
  // Layer 4: Basic fallback
  return basicExtract(parseText);
}

// Pick the candidate whose PARSE yields the most priced items. Raw word
// counts reward garbage-tails (Tesseract on keystoned photos reads noise
// words after every name) over clean split-price readings (RapidOCR), so
// the engine that actually read prices should win. Tie-breaks fall back to
// the getBestResult pick (score + order).
function pickByParseQuality(base: any, results: Array<OCRCandidate | null>): any {
  const quality = (data: any) => {
    try {
      const items = parseResultData(data);
      return { priced: items.filter(i => i.price !== undefined).length, total: items.length };
    } catch {
      return { priced: -1, total: -1 };
    }
  };
  let best = base;
  let bestQ = quality(base);
  for (const r of results) {
    if (!r?.data) continue;
    const q = quality(r.data);
    if (q.priced > bestQ.priced) {
      bestQ = q;
      best = r.data;
    }
  }
  return best;
}

// menu_ocr.py is the slowest pool candidate (4 strategies × 5 PSM modes of
// pytesseract — up to ~1-2 min), so it must NOT be a plain pool member: that
// would stall every scan on it. Instead it only joins when the fast engines'
// winner is a WEAK read (<3 items or <2 priced) — exactly the degraded-photo
// case the word-level pipeline was built for. Strong reads never wait for it.
// The slow pipeline deskews internally, so its data carries no rawLines; the
// shared parser consumes its emitted word tokens just like RapidOCR's.
async function menuOCRRescue(
  buffer: Buffer,
  base: any,
  results: Array<OCRCandidate | null>,
  deskewedCount: number
): Promise<any> {
  let fastItems: LocalOCRItem[];
  try {
    fastItems = parseResultData(base);
  } catch {
    fastItems = [];
  }
  const priced = fastItems.filter((i) => i.price !== undefined).length;
  if (fastItems.length >= 3 && priced >= 2) return base;

  const menuOcr = await tryMenuOCR(buffer);
  if (!menuOcr) return base;
  results.push(menuOcr);
  return pickByParseQuality(getBestResult(results, deskewedCount), results);
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN ENTRY POINT — with Sharp preprocessing + multi-PSM
// ═══════════════════════════════════════════════════════════════════

type OCRCandidate = { data: any; wordCount: number; alphaWordCount: number; avgConf: number };

async function tryTesseractOnBuffer(
  buffer: Buffer,
  psm: number
): Promise<OCRCandidate> {
  const result = await Tesseract.recognize(buffer, "eng", {
    tessedit_pageseg_mode: String(psm),
    logger: () => {},
  } as any);
  const text = (result.data.text || "").trim();
  const words = text.split(/\s+/).filter((w: string) => w.length > 2);
  const alphaWords = words.filter((w: string) => REAL_WORD_RE.test(w));
  return {
    data: result.data,
    wordCount: words.length,
    alphaWordCount: alphaWords.length,
    avgConf: result.data.confidence ?? 0,
  };
}

function countPriceLines(text: string): number {
  if (!text) return 0;
  let n = 0;
  for (const line of text.split("\n")) {
    if (/[$€£¥]\s*\d|\b\d{1,3}[.,]\d{1,2}\b/.test(line)) n++;
  }
  return n;
}

// Estimate page rotation from RapidOCR line boxes. A rotated text line's
// bounding box height is inflated by w·sinθ, so a naive (y1-y0)/(x1-x0) slope
// over-estimates badly (18° measured on a 7° image). Iterate: text height h is
// derived from NARROW boxes (single-word lines — near-zero rotation bias),
// then each wide line yields θ = asin(((y1-y0) − h·cosθ) / w); 4 iterations
// converge (7.09° on a 7° image). Positive = text tilts down to the right;
// sharp.rotate(+θ) straightens it (validated empirically).
function estimateSkewDegrees(rawLines: Array<{ box: number[] } | null | undefined>): number {
  const boxes = (rawLines ?? [])
    .filter((l): l is { box: number[] } => !!l && Array.isArray(l.box) && l.box.length === 4)
    .map((l) => l.box as [number, number, number, number]);
  if (boxes.length < 6) return 0;

  let h = 30;
  let theta = 0;
  for (let iter = 0; iter < 4; iter++) {
    const rad = (theta * Math.PI) / 180;
    const narrow = boxes.filter(([x0, , x1]) => x1 - x0 < 90);
    if (narrow.length < 2) break;
    const hs = narrow
      .map(([x0, y0, x1, y1]) => (y1 - y0) - (x1 - x0) * Math.sin(rad))
      .sort((a, b) => a - b);
    h = hs[Math.floor(hs.length / 2)];

    const wide = boxes.filter(([x0, , x1]) => x1 - x0 >= 120);
    if (wide.length < 3) break;
    const angles = wide
      .map(([x0, y0, x1, y1]) => {
        const w = x1 - x0;
        const num = (y1 - y0) - h * Math.cos(rad);
        return (Math.asin(Math.max(-0.35, Math.min(0.35, num / w))) * 180) / Math.PI;
      })
      .sort((a, b) => a - b);
    theta = angles[Math.floor(angles.length / 2)];
  }
  return Math.abs(theta) >= 1.0 && Math.abs(theta) <= 14 ? theta : 0;
}

function getBestResult(results: Array<OCRCandidate | null>, deskewedCount = 0): any {
  let best: any = null;
  let bestScore = -1;
  for (const [index, r] of results.entries()) {
    if (!r || !r.data) continue; // failed candidate (e.g. RapidOCR unavailable)
    // Confidence gate: garbled OCR (avgConf ~10) must never beat real text
    // (avgConf 90+), even when it produces more tokens. Measured on a noisy
    // synthetic menu: tesseract garbage = 27 alpha words @ conf 10 vs
    // RapidOCR 21 alpha words @ conf 100.
    if (r.alphaWordCount < 3 || (r.avgConf ?? 0) < 40) continue;
    // Score: prefer alpha words (real text) with a minimum threshold.
    // avgConf/10 breaks ties in favour of the higher-confidence engine
    // (RapidOCR ≈100 vs Tesseract ≈95), so a strong reading wins over an
    // equal-sized weaker one.
    // Word-data bonus: candidates with word bounding boxes (RapidOCR) enable
    // the positional parser — columns, per-column categories, merged-header
    // splitting. Worth ~2.5 alpha words; real quality gaps still win.
    const hasWords = Array.isArray(r.data.words) && r.data.words.length > 0;
    const alphaWords = ((r.data.text ?? "").split(/\s+/) as string[]).filter((w) => /[a-zA-Z]{3,}/.test(w)).length;
    // Price-line bonus: a menu where one engine reads N priced lines and the
    // other reads zero is almost always a case for the priced one (dark
    // photos: unboosted Tesseract sees names, boosted sees names AND prices).
    const priceLines = countPriceLines(r.data.text ?? "");
    // Deskewed candidates get +1: after resampling, RapidOCR's per-line
    // confidence drops a hair (99.7 vs 100.0), so a deskewed reading — which
    // has the CORRECT detection order — would otherwise lose ties to the
    // geometrically-scrambled raw reading by ~0.3 points.
    const bonus = index < deskewedCount ? 1 : 0;
    // RapidOCR preference: it is the best image analyzer on this project's
    // degraded corpus (dark, perspective, small, script, ink all read
    // flawlessly; Tesseract only beats it by emitting garbage tails). On
    // near-ties the score must go to RapidOCR — its candidates carry the
    // rawLines signature.
    const rapidBonus = Array.isArray(r.data?.rawLines) ? 2 : 0;
    const score = alphaWords * 10 + r.wordCount + (r.avgConf ?? 0) / 10 + (hasWords ? 25 : 0) + priceLines * 4 + bonus + rapidBonus;
    if (score > bestScore) {
      bestScore = score;
      best = r.data;
    }
  }
  // Nothing passed the gates — keep the first candidate (old behavior) so the
  // parser still has something to work with on pathological images.
  return best ?? (results.find((r) => r && r.data)?.data ?? null);
}

export async function runLocalOCR(
  file: File
): Promise<{ raw_text: string; items: LocalOCRItem[] }> {
  let resultData: any;
  let inputBuffer: Buffer | null = null;

  try {
    // ── Step 1: Read file into buffer ──
    // Accept both File (browser uploads, harness) and Buffer (internal
    // callers). A Buffer has no .arrayBuffer() in this Node runtime — passing
    // one used to throw here and silently drop the whole sharp/RapidOCR
    // pipeline into the low-quality single-Tesseract fallback.
    inputBuffer = Buffer.isBuffer(file as unknown)
      ? (file as unknown as Buffer)
      : Buffer.from(await (file as unknown as { arrayBuffer(): Promise<ArrayBuffer> }).arrayBuffer());

    // ── Step 2: Try Sharp preprocessing (grayscale + normalize + sharpen) ──
    try {
      const sharp = eval('require')('sharp');
      const preprocessed = await sharp(inputBuffer)
        .grayscale()
        .normalize()
        .sharpen()
        .resize({ width: 2048, withoutEnlargement: true })
        .toBuffer();
      const meanLum = (await sharp(preprocessed).stats()).channels[0].mean;

      // ── Step 3: Candidate pool ──
      const psmModes = [6, 4, 11];
      const results: Array<OCRCandidate | null> = [];

      // Phase A: fast pair — RapidOCR first (raw buffer: it has its own
      // internal preprocessing, and Sharp's normalize+sharpen amplifies noise
      // on degraded photos, which made RapidOCR detect nothing on a noisy
      // menu). Its raw line boxes also feed skew estimation.
      const rapid = await tryRapidOCR(inputBuffer);
      const skewDeg = estimateSkewDegrees(rapid?.data?.rawLines);
      let deskewedCount = 0; // first N results are deskewed (order-corrected)

      if (skewDeg !== 0) {
        // Phase B (tilted page): deskew and re-run BOTH engines. Tesseract
        // can't read >5° rotation, and RapidOCR's detection ORDER scrambles on
        // rotated photos (price boxes at the right edge sit a line lower,
        // attaching each price to the wrong dish). Deskewed candidates go
        // FIRST (with a +1 tie-break in getBestResult) so the order-corrected
        // reading wins; the unrotated candidates stay in the pool because
        // skew estimates can be false positives (noise), and deskewing an
        // already-straight page only degrades it.
        // The +1 bonus applies ONLY to confident skew (≥2.5°): on noise-level
        // false positives (1-2°) winner races are razor-thin and the bonus
        // would tip them to the deskewed copy, which is geometrically worse.
        const deskewedPrep = await sharp(preprocessed)
          .rotate(skewDeg, { background: { r: 255, g: 255, b: 255 } })
          .toBuffer();
        const deskewedRaw = await sharp(inputBuffer)
          .rotate(skewDeg, { background: { r: 255, g: 255, b: 255 } })
          .toBuffer();
        if (Math.abs(skewDeg) >= 2.5) deskewedCount = 4; // 3 deskewed PSM modes + deskewed RapidOCR
        results.push(
          await tryRapidOCR(deskewedRaw), // deskewed RapidOCR first (best image analyzer)
          ...(await Promise.all(psmModes.map((psm) => tryTesseractOnBuffer(deskewedPrep, psm)))),
          rapid, // raw RapidOCR second — best analyzer, no deskew artifacts
          await tryTesseractOnBuffer(preprocessed, 6),
          await tryTesseractOnBuffer(preprocessed, 4),
          await tryTesseractOnBuffer(preprocessed, 11),
        );
      } else {
        // Phase B (straight page): RapidOCR first — it is the best image
        // analyzer (own preprocessing; reads degraded menus that Tesseract
        // garbles), then the remaining PSM modes on the preprocessed image.
        // NOTE: Ollama vision candidates (qwen2.5vl, gemma4) are NOT in the
        // pool — benchmarked 2026-08: local VLMs on this 6GB machine either
        // time out (qwen) or HALLUCINATE a plausible fake menu (gemma4
        // invented "SPRING ROLLS / FRIES / BREADSTICKS" for a menu that
        // actually lists Smoked Brisket). Hallucinated text parses to priced
        // items, so no downstream gate can catch it — the only safe move is
        // to never let vision text win. RapidOCR is the proven reader.
        results.push(
          rapid,
          await tryTesseractOnBuffer(preprocessed, 6),
          await tryTesseractOnBuffer(preprocessed, 4),
          await tryTesseractOnBuffer(preprocessed, 11),
        );
      }

      // Phase C: dark-menu boost — normalize() alone leaves near-black photos
      // unreadable (dark pubs: names come through, prices vanish). A brightness
      // boost recovers the price lines; getBestResult's price-line bonus then
      // prefers whichever engine actually read prices.
      if (meanLum < 60) {
        const boosted = await sharp(preprocessed)
          .modulate({ brightness: 1.7 })
          .toBuffer();
        results.push(...(await Promise.all(psmModes.map((psm) => tryTesseractOnBuffer(boosted, psm)))));
      }

      // Pick the best result (null candidates are skipped); deskewed
      // candidates carry the +1 tie-break for correct detection order.
      // Then refine by PARSE quality: the reading that yields the most
      // priced items wins (garbage-tails inflate word counts but parse
      // to nothing — see pickByParseQuality).
      const fastWinner = pickByParseQuality(getBestResult(results, deskewedCount), results);
      // Slow-candidate rescue: menu_ocr.py joins the pool only when the
      // fast engines read this menu weakly (see menuOCRRescue).
      resultData = await menuOCRRescue(inputBuffer, fastWinner, results, deskewedCount);
    } catch (e) {
      // Sharp not available or preprocessing failed — try raw image with
      // RapidOCR first (best image analyzer), then multi-PSM Tesseract.
      const psmModes = [6, 4, 11];
      const results = await Promise.all([
        tryRapidOCR(inputBuffer!),
        ...psmModes.map(psm => tryTesseractOnBuffer(inputBuffer!, psm)),
      ]);
      resultData = getBestResult(results);
    }
  } catch (e) {
    // Ultimate fallback: single Tesseract pass with File
    const result = await Tesseract.recognize(file, "eng", {
      logger: () => {},
    });
    resultData = result.data;
  }

  const raw_text = resultData.text || "";
  const rawWords: any[] = resultData.words || [];

  // Clean the OCR text before parsing: drop venue/noise lines (titles,
  // subtitles, addresses, phones, hours, delivery spam) and merge split
  // prices back onto their names ("Smoked Brisket\n$18.50" → one line).
  // The parsers then see a tidy menu; the original raw_text is still
  // returned to callers (engine.ts surfaces it as-is).
  const cleaned = cleanOCRText(raw_text);
  let parseText = cleaned.text;
  if (process.env.OLLAMA_CLEAN !== "0") {
    parseText = await cleanTextWithOllama(parseText);
  }

  // Filter low-confidence words BEFORE any parsing
  const words: WordPos[] = rawWords
    .filter((w: any) => (w.confidence ?? 0) >= 25) // filter garbage OCR
    .map((w: any) => ({
      text: w.text || "",
      x: w.bbox?.x0 ?? 0,
      y: w.bbox?.y0 ?? 0,
      w: (w.bbox?.x1 ?? 0) - (w.bbox?.x0 ?? 0),
      h: (w.bbox?.y1 ?? 0) - (w.bbox?.y0 ?? 0),
      confidence: w.confidence ?? 0,
    }));

  let items: LocalOCRItem[];

  // Extract paragraph-level structure from Tesseract
  const paragraphs = extractParagraphs(resultData);

  // Layer 1: Paragraph-aware parser (uses Tesseract's own text grouping)
  // Preferred when we have 2+ paragraphs with good word data
  const hasParaWords = paragraphs.some(p => p.words.length >= 3);
  if (paragraphs.length >= 2 && hasParaWords) {
    items = paragraphAwareParse(paragraphs, parseText);
  }
  // Layer 2: Positional parser (word bbox data)
  else if (words.length > 3) {
    const hasPositionData = words.some(w => w.x !== 0 || w.y !== 0);
    const hasGoodConfidence = words.filter(w => w.confidence > 50).length >= 3;
    if (hasPositionData && hasGoodConfidence) {
      items = smartParse(parseText, words);
    } else {
      items = sequentialParse(parseText);
    }
  }
  // Layer 3: Sequential parser (blank-line blocks)
  else if (parseText.split(/\n\s*\n/).length >= 2) {
    items = sequentialParse(parseText);
  }
  // Layer 4: Basic fallback
  else {
    items = basicExtract(parseText);
  }

  // Post-processing
  items = crossValidate(items);

  // Optional Ollama refinement (src/lib/ocr/ollama.ts): when Ollama is
  // reachable, a model re-reads the CLEANED text and emits a clean dish
  // list — recovering items the line parsers swallowed, fixing garbled
  // names, and SPLITTING merged rows ("ICE MILK 77 BEAN" → two dishes).
  // Fails soft (returns the deterministic parse on any error) and only
  // replaces it when the model's list is at least as complete.
  // Disable with OLLAMA_REFINE=0 (the regression harness does this for
  // determinism).
  if (process.env.OLLAMA_REFINE !== "0") {
    try {
      const refined = await refineWithOllama(parseText, items);
      // refineWithOllama returns the SAME array reference on every failure
      // path — that is the fail-soft signal. Only when it actually
      // replaced the list do we trust the model's split decisions.
      if (refined !== items) {
        items = refined;
      }
    } catch {
      // refineWithOllama never throws by design; belt-and-braces.
    }
  }

  // Local splitter fallback: after the primary (Ollama) splitter — or
  // instead of it when refine was disabled/failed — split any item whose
  // name still contains an embedded price. No-op for well-formed items.
  items = splitMergedItemsFallback(items);

  // Vision rescue: when deterministic OCR found NOTHING (blurry photo,
  // exotic script, severe tilt), ask the local vision model to read the
  // image directly. Deliberately NOT in the candidate pool — benchmarked
  // 2026-08: local VLMs are slow (19-47s) and gemma4:e2b hallucinates
  // entire fake menus; they only earn a shot when every deterministic
  // engine failed. The vision text is parsed by the SAME parser pipeline
  // (its output shape is Tesseract-like: text + empty word boxes) and
  // refined with the same gates, so hallucinated names are rejected by
  // the grounding gate (they are not in the OCR text — which for a
  // vision rescue IS the transcription).
  if (items.length === 0 && process.env.OLLAMA_VISION !== "0" && inputBuffer) {
    try {
      const vis = await ollamaVisionOCR(inputBuffer);
      if (vis && vis.alphaWordCount >= 3) {
        const visText = vis.data.text.trim();
        // New vision prompt asks for JSON — parse directly when it's a JSON array
        if (visText.startsWith("[")) {
          const parsedItems = parseDishArray(visText, visText);
          if (parsedItems.length > 0) {
            items = parsedItems;
          }
        } else {
          // Legacy: raw transcribed text → clean → sequentialParse → refine
          const visClean = cleanOCRText(visText);
          const visItems = sequentialParse(visClean.text);
          const visRefined =
            process.env.OLLAMA_REFINE !== "0"
              ? await refineWithOllama(visClean.text, visItems)
              : visItems;
          if (visRefined !== visItems) {
            items = visRefined;
          } else {
            items = splitMergedItemsFallback(visItems);
          }
        }
      }
    } catch {
      // Vision rescue never throws; belt-and-braces.
    }
  }

  return { raw_text, items: items.slice(0, 50) };
}

// ═══════════════════════════════════════════════════════════════════
//  CATEGORY GUESSER (kept for backward compatibility)
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
//  OFFLINE OCR PIPELINE — wraps runLocalOCR with OCRResult shape
// ═══════════════════════════════════════════════════════════════════

export interface OfflineOCRResult {
  items: LocalOCRItem[];
  raw_text: string;
  layer: string;
  confidence: number;
  menu_name?: string;
}

/**
 * Offline OCR entry point for the scan endpoint. Wraps runLocalOCR
 * and returns the full OCRResult shape so the persistence and SSE
 * logic in the scan route works unchanged. Accepts an ArrayBuffer
 * and an optional SSE progress callback.
 */
export async function runOfflineOCRPipeline(
  arrayBuffer: ArrayBuffer,
  send?: (event: string, data: Record<string, unknown>) => void
): Promise<OfflineOCRResult> {
  send?.("status", { status: "ocr_started", progress: 10, message: "Running local OCR…" });
  const blob = new Blob([arrayBuffer], { type: "image/jpeg" });
  const file = new File([blob], "menu.jpg", { type: "image/jpeg" });
  const result = await runLocalOCR(file);
  send?.("status", {
    status: "ocr_complete",
    progress: 50,
    message: `Found ${result.items.length} items via offline`,
    layer: "offline",
    confidence: 85,
  });
  return {
    items: result.items,
    raw_text: result.raw_text,
    layer: "offline",
    confidence: 85,
  };
}
