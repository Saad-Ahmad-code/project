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

import Tesseract from "tesseract.js";

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

const CATEGORY_KEYWORDS = new Set([
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
    /^(cheese|butter|cream|eggs|omelet|omelette|sandwich|pudding)$/.test(w) ||
    /^(cake|pie|cookie|brownie|muffin|donut|doughnut|mousse|candy)$/.test(w) ||
    /^(coffee|latte|cappuccino|espresso|mocha|latte|chai|soda|juice)$/.test(w) ||
    /^(lemonade|shake|smoothie|mocktail|cocktail|beer|wine)$/.test(w) ||
    /^(grilled|roast|roasted|fried|baked|smoked|steamed|pan|stir)$/.test(w) ||
    /^(bbq|buffalo|honey|garlic|spicy|tangy|sweet|sour)$/.test(w) ||
    /^(margherita|pepperoni|hawaiian|veggie|vegan|gluten)$/.test(w) ||
    /^(cheeseburger|hamburger|chowder|gumbo|bisque|stew|casserole)$/.test(w) ||
    /^(dip|salsa|guacamole|hummus|tapenade)$/.test(w) ||
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
    /^(olive|capsicum|jalapeno|pickle|potato)$/.test(w) ||
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
  [/ch[ie]ken/gi, "Chicken"], [/bvrger/gi, "Burger"], [/bvrg[ae]r/gi, "Burger"],
  [/sandwich/gi, "Sandwich"], [/sandw[ei]ch/gi, "Sandwich"], [/sandwish/gi, "Sandwich"],
  [/spagh[ea]tti/gi, "Spaghetti"], [/spagheti/gi, "Spaghetti"], [/spaghett[it]/gi, "Spaghetti"],
  [/lasagn?a/gi, "Lasagna"], [/rav[i1]oli/gi, "Ravioli"],
  [/fettvccine/gi, "Fettuccine"], [/fett[uv]ccine/gi, "Fettuccine"],
  [/brvschetta/gi, "Bruschetta"], [/br[uv]schetta/gi, "Bruschetta"], [/brvscetta/gi, "Bruschetta"],
  [/fr[ie]d/gi, "Fried"], [/grille?d/gi, "Grilled"], [/roaste?d/gi, "Roasted"],
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
  [/waffles?/gi, "Waffle"], [/pancakes?/gi, "Pancake"], [/muffi[mn]/gi, "Muffin"],
  [/cvvkies?/gi, "Cookie"], [/brow[nm]ie/gi, "Brownie"], [/donvts?/gi, "Donut"],
  [/samosa[sz]/gi, "Samosa"], [/pakora[sz]/gi, "Pakora"],
  [/sh[ae]warma/gi, "Shawarma"], [/k[ea]bab/gi, "Kebab"], [/fala?fe[li]/gi, "Falafel"],
  [/tikk[as]/gi, "Tikka"], [/masal[as]/gi, "Masala"], [/biry[ae]ni/gi, "Biryani"],
  [/parath[as]/gi, "Paratha"], [/tortilla[sz]/gi, "Tortilla"], [/guacamole?/gi, "Guacamole"],
  [/croissant/gi, "Croissant"],
  [/mozzarella?/gi, "Mozzarella"], [/parmesan[ao]/gi, "Parmesan"], [/parm[ie]san/gi, "Parmesan"],
  [/ricott[as]/gi, "Ricotta"], [/gorgonzol[as]/gi, "Gorgonzola"],
  [/fontin[as]/gi, "Fontina"], [/provolone?/gi, "Provolone"], [/mascarpone?/gi, "Mascarpone"],
  [/cappvccino/gi, "Cappuccino"], [/capp[uv]ccino/gi, "Cappuccino"], [/cappucino/gi, "Cappuccino"],
  [/espresso?/gi, "Espresso"], [/moch[as]/gi, "Mocha"], [/macchiato?/gi, "Macchiato"],
  [/limonade/gi, "Lemonade"], [/lemonad[es]/gi, "Lemonade"],
  [/smooth[ie]s/gi, "Smoothie"], [/cocktail[sz]/gi, "Cocktail"],
  [/margarit[as]/gi, "Margarita"], [/martin[i]s/gi, "Martini"],
  [/gvozas?/gi, "Gyoza"], [/dvmplings?/gi, "Dumpling"],
  [/tempvra/gi, "Tempura"], [/sashim[i]/gi, "Sashimi"],
  [/teriyaki?/gi, "Teriyaki"], [/yakitori?/gi, "Yakitori"],
  [/tonkatsu?/gi, "Tonkatsu"], [/edamame?/gi, "Edamame"],
  [/wasab[i]/gi, "Wasabi"], [/srirach[as]/gi, "Sriracha"],
  [/vinaigrette?/gi, "Vinaigrette"], [/a[io]oli?/gi, "Aioli"],
  [/hollandaise?/gi, "Hollandaise"], [/b[ée]arnaise?/gi, "Béarnaise"],
  [/tartar?/gi, "Tartar"], [/remoulade?/gi, "Remoulade"],
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

function isNoiseLine(text: string): boolean {
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
  if (/^[^a-zA-Z0-9]+$/.test(t)) return true;

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

  // Short centered text with capital first letter
  if (isCentered && lineWords.length <= 4 && !/\d/.test(t) && /^[A-Z]/.test(text.trim())) return true;

  return false;
}

// ═══════════════════════════════════════════════════════════════════
//  UTILITY: Price detection (multi-format)
// ═══════════════════════════════════════════════════════════════════

function normalizePrice(raw: string): number | null {
  let s = raw.trim();

  // Strip currency symbols and common prefixes/suffixes
  s = s.replace(/^[$€£¥Rs.\s]+/i, "");
  s = s.replace(/[$€£¥.\s]+$/i, "");
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
  const trailing = t.match(/(?:^|\s)([$€£¥RsSs.]+\s*)?(\d{1,3}(?:[.,]\d{1,2})?)\s*$/);
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
//  UTILITY: Dish name cleanup pipeline
// ═══════════════════════════════════════════════════════════════════

function cleanDishName(raw: string): string {
  let name = raw.trim();

  // Stage 1: Strip leading decorative symbols
  name = name.replace(/^[★☆⭐●◆▪▸▹►→▪•¶※✓✗✘✔✖✝✙✦✧⬟⬡⌾⭑✪✫✬✭✮✯✰✱✲✳✴✵✶✷✸✹✺✻✼✽✾✿❀]+/, "").trim();

  // Stage 2: Strip prefix modifiers
  name = name
    .replace(/^(NEW|NEW!|SPICY|HOT!|MILD|CHEF'?S?\s*SPECIAL|SIGNATURE|HOUSE|HOMEMADE|FRESH|ORGANIC|GRILLED|ROASTED|SMOKED|HOTEL|RESTAURANT|CAFE|CAFÉ|BAR|LOUNGE|GRILL|GRILLE|BISTRO)\s+/i, "")
    .trim();

  // Stage 3: Strip allergen/dietary tags like [GF] [V] [VG] (gf) (v)
  name = name.replace(/^\s*\[.*?\]\s*/, "").trim();
  name = name.replace(/\s*\[.*?\]\s*$/, "").trim();
  name = name.replace(/^\s*\(.*?\)\s*/, "").trim();
  name = name.replace(/\s*\(.*?\)\s*$/, "").trim();

  // Stage 4: Strip leading numbers like "1.", "1)", "1 Chicken Burger"
  name = name.replace(/^\d+[.)\s]+/, "").trim();

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

  // Stage 5d: Strip other noise characters — symbols, brackets, operators
  name = name.replace(/[*>{<}%]/g, " ").replace(/\s+/g, " ").trim();
  name = name.replace(/[|`~^\\/]/g, " ").replace(/\s+/g, " ").trim();

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

  // Stage 7: Collapse multiple spaces
  name = name.replace(/\s+/g, " ").trim();

  // If after all cleaning the name is too short, it was probably just noise
  if (name.length < 3 || /^[^a-zA-Z]+$/.test(name)) return raw.trim();

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

  for (const line of lines) {
    // Skip obvious noise
    if (isNoiseLine(line)) continue;
    // Skip description lines (not dish names)
    if (isDescriptionLine(line)) continue;

    const cleaned = line.replace(/[|]/g, " ").replace(/\s+/g, " ").trim();
    const price = findPriceInText(cleaned);
    const wordCount = cleaned.split(/\s+/).length;

    // Extract name (remove price if trailing)
    let name = cleaned;
    if (price && price.position === "trailing") {
      name = cleaned.slice(0, cleaned.lastIndexOf(price.raw)).trim();
    } else if (price && price.position === "left_side") {
      name = cleaned.replace(/^[$€£¥Rs.]+\s*\d+(?:[.,]\d+)?\s+/, "").trim();
    }

    if (!name || wordCount < 2 || wordCount > 25) continue;
    if (!/[a-zA-Z]{3,}/.test(name)) continue;

    // Skip category headers in flat menus (lines with no price that are category names)
    if (!price && wordCount <= 4) {
      const nameLower = name.toLowerCase().trim();
      if (CATEGORY_KEYWORDS.has(nameLower) || CATEGORY_KEYWORDS.has(nameLower.replace(/s$/, ""))) continue;
      // Also skip all-caps short lines with no price and no food words
      const nameWords = nameLower.split(/\s+/);
      const hasFoodWord = nameWords.some(w => isFoodRelated(w));
      if (!hasFoodWord && wordCount <= 3 && name === name.toUpperCase()) continue;
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
      category: guessCategory(name),
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
  const seen = new Set<string>();
  let sourceIndex = 0;

  for (let bi = 0; bi < blocks.length; bi++) {
    const lines = blocks[bi]
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 1);

    if (lines.length === 0) continue;

    // First line of each block = potential header
    const header = lines[0];
    const headerWords = header.split(/\s+/);

    // Check if first line is a category header
    if (isHeaderLike(header, false, false, headerWords)) {
      currentCategory = header;
      lines.shift(); // remove header from processing
    }

    // Process remaining lines for dishes
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isNoiseLine(line)) continue;

      // Single number or price-only line
      if (/^\d+(?:\.\d{1,2})?$/.test(line.trim())) continue;
      // Skip description lines (not dish names)
      if (isDescriptionLine(line)) continue;

      // Check for size variant pattern: "Small 9.99 / Large 12.99"
      if (/(Small|Regular|Single|Large|Double|Medium)\s+[$€£¥]?\s*\d/.test(line)) {
        const baseName = line
          .replace(/(Small|Regular|Single|Large|Double|Medium|Kids?)\s+[$€£¥]?\s*\d+(?:[.,]\d+)?\s*\/?\s*/g, "")
          .trim();
        if (baseName && baseName.length > 3) {
          const prices = [...line.matchAll(/(\d+(?:[.,]\d{1,2})?)/g)].map(m => parseFloat(m[1].replace(",", ".")));
          const medianPrice = prices.length > 0 ? prices[Math.floor(prices.length / 2)] : undefined;

          const cleaned = cleanDishName(baseName);
          if (!seen.has(cleaned.toLowerCase()) && !isNoiseLine(cleaned)) {
            seen.add(cleaned.toLowerCase());
            dishes.push({
              name: correctOCRErrors(cleaned).slice(0, 200),
              category: currentCategory || undefined,
              price: medianPrice,
              confidence: 0.6,
              sourceIndex: sourceIndex++,
            });
          }
        }
        continue;
      }

      // Detect price on this line
      const priceOnLine = findPriceInText(line);
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
      if (name.length < 3 || words.length < 2) continue;
      if (!/[a-zA-Z]{3,}/.test(name)) continue;
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
    const text = group.map(w => w.text).join(" ").trim();
    if (!text) continue;

    const minX = Math.min(...group.map(w => w.x));
    const minY = Math.min(...group.map(w => w.y));
    const maxX = Math.max(...group.map(w => w.x + w.w));
    const maxY = Math.max(...group.map(w => w.y + w.h));

    // Price in last 1-2 words
    let hasPrice = false;
    let price: number | undefined;
    let priceEndX = 0;

    for (let w = group.length - 1; w >= Math.max(0, group.length - 3); w--) {
      const pr = findPriceInWord(group[w].text);
      if (pr) {
        hasPrice = true;
        price = pr.price;
        priceEndX = group[w].x + group[w].w;
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
    const isCentered = midX > imgWidth * 0.25 && midX < imgWidth * 0.75 && (maxX - minX) < imgWidth * 0.7;
    const isAllCaps = text === text.toUpperCase() && /[A-Z]{4,}/.test(text);

    lines.push({
      text,
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
      words: group,
      hasPrice,
      price,
      priceEndX,
      isCentered,
      isAllCaps,
      isHeader: isHeaderLike(text, hasPrice, isCentered, lineWords),
    });
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
    const leftMaxX = Math.max(...leftLines.map(l => l.x + l.w));
    const rightMinX = Math.min(...rightLines.map(l => l.x));
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

  // Classify menu type for adaptive behavior
  const layout = classifyMenu(lines);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isNoiseLine(line.text)) continue;

    // Category header detection
    if (line.isHeader) {
      // Flush any pending dish
      if (pendingDish) { dishes.push(pendingDish); pendingDish = null; }
      currentCategory = line.text.trim();
      categoryLineIndex = i;
      continue;
    }

    // Category expires after 15 lines
    if (currentCategory && i - categoryLineIndex > 15) {
      currentCategory = "";
    }

    // Skip number-only and price-only lines
    if (/^\d+(?:\.\d+)?$/.test(line.text.trim())) continue;
    if (/^[\d\s.\-$€£¥]+$/.test(line.text.trim())) continue;

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
        const medianPrice = prices.length > 0 ? prices[Math.floor(prices.length / 2)] : undefined;
        const conf = computeConfidence(true, baseName, currentCategory, line.isCentered, line.isAllCaps, layout);

        dishes.push({
          name: baseName,
          category: currentCategory || undefined,
          price: medianPrice,
          confidence: conf,
          sourceIndex: nextIndex++,
        });
      }
      continue;
    }

    // 3-line fine-dining pattern: name / description / price
    if (!line.hasPrice && i + 2 < lines.length) {
      const next1 = lines[i + 1];
      const next2 = lines[i + 2];
      if (!next1.hasPrice && next2.hasPrice && !isNoiseLine(next1.text) && !isNoiseLine(next2.text)) {
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

      const cleaned = cleanDishName(nameText);
      if (cleaned.length >= 3 && words >= 2 && !isNoiseLine(cleaned)) {
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
    if (words >= 2 && words <= 25 && /[a-zA-Z]{3,}/.test(nameText)) {
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

  // Starts with ingredient/prep words
  if (/^(with|in|on|served|topped|drizzled|accompanied|comes|available|choice|side|and|plus|add)/i.test(t)) return true;

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
    if (!/[a-zA-Z]{3,}/.test(corrected)) continue;
    if (dish.confidence < threshold) continue;

    items.push({
      name: corrected.slice(0, 200),
      description: dish.description ? correctOCRErrors(dish.description).trim().slice(0, 500) : "",
      price: dish.price,
      category: dish.category || "other",
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
    if (!/[a-zA-Z]{3,}/.test(corrected)) continue;

    // Cross-validation: if this dish confidence is far below median, skip
    if (dish.confidence < threshold) continue;

    items.push({
      name: corrected.slice(0, 200),
      description: dish.description ? correctOCRErrors(dish.description).trim().slice(0, 500) : "",
      price: dish.price,
      category: dish.category || "other",
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

// ═══════════════════════════════════════════════════════════════════
//  MAIN ENTRY POINT — with Sharp preprocessing + multi-PSM
// ═══════════════════════════════════════════════════════════════════

async function tryTesseractOnBuffer(
  buffer: Buffer,
  psm: number
): Promise<{ data: any; wordCount: number; alphaWordCount: number }> {
  const result = await Tesseract.recognize(buffer, "eng", {
    tessedit_pageseg_mode: String(psm),
    logger: () => {},
  } as any);
  const text = (result.data.text || "").trim();
  const words = text.split(/\s+/).filter((w: string) => w.length > 2);
  const alphaWords = words.filter((w: string) => /[a-zA-Z]{3,}/.test(w));
  return {
    data: result.data,
    wordCount: words.length,
    alphaWordCount: alphaWords.length,
  };
}

function getBestResult(results: Array<{ data: any; wordCount: number; alphaWordCount: number }>): any {
  let best = results[0];
  let bestScore = -1;
  for (const r of results) {
    // Score: prefer alpha words (real text) with a minimum threshold
    const score = r.alphaWordCount * 10 + r.wordCount;
    if (score > bestScore && r.alphaWordCount >= 3) {
      bestScore = score;
      best = r;
    }
  }
  return best.data;
}

export async function runLocalOCR(
  file: File
): Promise<{ raw_text: string; items: LocalOCRItem[] }> {
  let resultData: any;

  try {
    // ── Step 1: Read file into buffer ──
    const arrayBuffer = await file.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);

    // ── Step 2: Try Sharp preprocessing (grayscale + normalize + sharpen) ──
    try {
      const sharp = eval('require')('sharp');
      const preprocessed = await sharp(inputBuffer)
        .grayscale()
        .normalize()
        .sharpen()
        .resize({ width: 2048, withoutEnlargement: true })
        .toBuffer();

      // ── Step 3: Multi-PSM trial on preprocessed image ──
      const psmModes = [6, 4, 11];
      const results = await Promise.all(
        psmModes.map(psm => tryTesseractOnBuffer(preprocessed, psm))
      );

      // Pick the best result
      resultData = getBestResult(results);
    } catch {
      // Sharp not available or preprocessing failed — try raw image with multi-PSM
      const psmModes = [6, 4, 11];
      const results = await Promise.all(
        psmModes.map(psm => tryTesseractOnBuffer(inputBuffer, psm))
      );
      resultData = getBestResult(results);
    }
  } catch {
    // Ultimate fallback: single Tesseract pass with File
    const result = await Tesseract.recognize(file, "eng", {
      logger: () => {},
    });
    resultData = result.data;
  }

  const raw_text = resultData.text || "";
  const rawWords: any[] = resultData.words || [];

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
    items = paragraphAwareParse(paragraphs, raw_text);
  }
  // Layer 2: Positional parser (word bbox data)
  else if (words.length > 3) {
    const hasPositionData = words.some(w => w.x !== 0 || w.y !== 0);
    const hasGoodConfidence = words.filter(w => w.confidence > 50).length >= 3;
    if (hasPositionData && hasGoodConfidence) {
      items = smartParse(raw_text, words);
    } else {
      items = sequentialParse(raw_text);
    }
  }
  // Layer 3: Sequential parser (blank-line blocks)
  else if (raw_text.split(/\n\s*\n/).length >= 2) {
    items = sequentialParse(raw_text);
  }
  // Layer 4: Basic fallback
  else {
    items = basicExtract(raw_text);
  }

  // Post-processing
  items = crossValidate(items);

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
