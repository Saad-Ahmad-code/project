/**
 * Deterministic dietary tagger — keyword-based, no AI.
 *
 * Replaces the AI-derived tags that used to come from dish-research.ts
 * (removed when descriptions moved to on-demand). Tags are computed at
 * scan/enrichment time from the dish name + OCR description, so cards
 * show badges immediately without spending AI tokens.
 *
 * Deliberately conservative: vegetarian/vegan use keyword absence (a dish
 * named only for its main ingredient is usually that), while
 * gluten-free/dairy-free/nut-free require the text to say so explicitly
 * (absence of a keyword is NOT proof — an unlisted sauce may contain it).
 */

const MEAT_WORDS = [
  "chicken", "beef", "pork", "fish", "shrimp", "prawn", "meat", "lamb",
  "turkey", "duck", "bacon", "ham", "sausage", "steak", "salmon", "tuna",
  "crab", "lobster", "squid", "octopus", "mutton", "veal", "prosciutto",
  "chorizo", "pepperoni", "salami", "kebab", "shawarma", "burger",
  "brisket", "ribs", "wings", "tenders", "hot dog", "schnitzel", "katsu",
  "jerk", "pastrami", "corned", "pulled pork", "meatball", "anchovy",
  "sardine", "cod", "halibut", "tilapia", "mahi", "bass", "trout",
];

const DAIRY_EGG_HONEY_WORDS = [
  "cheese", "cream", "butter", "milk", "yogurt", "honey", "egg", "eggs",
  "omelet", "omelette", "parmesan", "mozzarella", "feta", "cheddar",
  "brie", "ice cream", "gelato", "mayo", "mayonnaise", "buttermilk",
  "paneer", "ghee", "alfredo", "carbonara", "béchamel", "bechamel",
  "cream cheese", "sour cream", "half and half", "custard", "pudding",
  "mascarpone", "ricotta", "queso", "flan", "crème", "creme",
];

const SPICY_WORDS = [
  "spicy", "hot", "chili", "chilli", "sriracha", "jalapeño", "jalapeno",
  "habanero", "serrano", "cayenne", "pepper flakes", "harissa", "sambal",
  "gochujang", "peri peri", "tikka", "vindaloo", "jerk", "wasabi",
];

/**
 * Tag a dish from its name + description. Returns a sorted, de-duplicated
 * list of tags: vegetarian, vegan, spicy, gluten-free, dairy-free, nut-free.
 */
export function tagDietary(name: string, description = ""): string[] {
  const text = `${name} ${description}`.toLowerCase();
  const has = (words: string[]) => words.some((w) => text.includes(w));

  const tags: string[] = [];

  // Vegetarian = no meat/seafood keyword. Vegan = vegetarian AND no
  // dairy/egg/honey keyword.
  const vegetarian = !has(MEAT_WORDS);
  if (vegetarian) {
    tags.push("vegetarian");
    if (!has(DAIRY_EGG_HONEY_WORDS)) tags.push("vegan");
  }

  if (has(SPICY_WORDS)) tags.push("spicy");

  // Explicit-only flags (mirror the old AI tagger's behavior).
  if (text.includes("gluten-free") || text.includes("gluten free")) tags.push("gluten-free");
  if (text.includes("dairy-free") || text.includes("dairy free")) tags.push("dairy-free");
  if (text.includes("nut-free") || text.includes("nut free")) tags.push("nut-free");

  return [...new Set(tags)].sort();
}
