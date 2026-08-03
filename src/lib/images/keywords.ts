/** Shared food/non-food keyword sets used to filter image search results. */
export const NON_FOOD_KEYWORDS = new Set([
  "logo", "icon", "flag", "map", "coat of arms", "emblem", "seal", "stamp", "coin", "banknote",
  "medal", "badge", "building", "house", "church", "temple", "mosque", "synagogue", "monument",
  "statue", "fountain", "bridge", "tower", "castle", "car", "bus", "train", "airplane", "ship",
  "boat", "bicycle", "mountain", "hill", "valley", "river", "lake", "ocean", "sea", "forest",
  "desert", "island", "beach", "waterfall", "animal", "bird", "insect", "reptile", "mammal",
  "dog", "cat", "horse", "cow", "pig", "sheep", "goat", "flower", "tree", "plant", "mushroom",
  "algae", "person", "people", "man", "woman", "child", "baby", "face", "portrait", "singer",
  "actor", "politician", "athlete", "player", "painting", "drawing", "sketch", "illustration",
  "diagram", "chart", "graph", "plot", "table", "formula", "screenshot", "capture", "screen",
  "interface", "button", "texture", "pattern", "background", "wallpaper", "abstract", "geometric",
  "minimalist", "modern", "landscape", "skyline", "panorama", "aerial", "sport", "game", "match",
  "tournament", "competition", "music", "concert", "festival", "performance", "movie", "film",
  "cinema", "theater", "opera", "book", "magazine", "newspaper", "journal", "computer", "phone",
  "tablet", "laptop", "monitor", "clothing", "dress", "shirt", "shoes", "hat", "furniture",
  "chair", "table", "bed", "sofa", "weapon", "sword", "gun", "bomb", "tank", "tool", "hammer",
  "saw", "drill", "wrench", "medical", "hospital", "doctor", "nurse", "medicine", "military",
  "army", "navy", "air force", "soldier", "breed", "species", "genus", "fossil", "evolution",
  "extinct", "endangered", "habitat", "wild", "packaging", "brand", "label", "nutrition",
  "costume", "craft", "diy", "decoration", "decor", "tattoo", "sticker", "emoji", "outfit",
  "fashion", "style", "makeup", "stock photo", "selfie", "headshot", "profile", "farm", "farming",
  "agriculture", "livestock", "poultry", "pet", "zoo", "cage", "enclosure", "aquarium", "natural",
  "nature", "environment", "ecosystem", "puppy", "kitten", "cub", "foal", "sports", "football",
  "soccer", "basketball", "baseball", "tennis", "golf", "rugby", "cricket", "hockey", "racing",
  "race", "runner", "cycling", "swimming", "skiing", "snowboarding", "surfing", "skateboarding",
  "climbing", "hiking", "fishing", "hunting", "camping", "yoga", "fitness", "gym", "workout",
  "exercise", "dance", "ballet", "wedding", "party", "celebration", "birthday", "graduation",
  "ceremony", "parade", "protest", "conference", "meeting", "classroom", "school", "university",
  "college", "office", "factory", "warehouse", "construction", "road", "street", "highway",
  "traffic", "city", "town", "village", "neighborhood", "park", "garden", "zoo", "museum",
  "library", "store", "shop", "mall", "market", "restaurant exterior", "restaurant interior",
  "bar interior", "cafe interior", "kitchen", "chef portrait", "logo design", "brand logo",
  // Venue / interior shots that dominate restaurant-dish searches but show
  // the room, not the food (expanded per plan item: interior/exterior shots,
  // table settings, cutlery, signage).
  "interior", "exterior", "room", "dining room", "dining area", "dining hall",
  "table setting", "tabletop", "table top", "cutlery", "silverware",
  "napkin", "tablecloth", "menu board", "menu sign", "signage", "storefront", "facade",
  "window display", "display case", "counter", "bar counter", "bar stools", "bar stool",
  "pub", "tavern", "cafe", "bistro", "diner", "lounge", "terrace", "patio", "deck",
  "food court", "buffet", "banquet", "venue", "event", "restaurant", "restaurant interior",
  "food truck", "street food vendor", "vendor", "catering", "kitchen counter", "kitchen sink",
  "kitchen tools", "cookware", "pots and pans", "pots", "pans", "utensils", "spatula",
  "whisk", "measuring cups", "cutting board", "knife block", "blender", "mixer",
  "oven", "stove", "stovetop", "range", "microwave", "fridge", "refrigerator", "freezer",
  "dishwasher", "sink", "pantry", "cupboard", "cabinets", "shelves", "shelf", "rack",
]);

/**
 * Terms that indicate a food-adjacent photo is NOT a finished dish: cooking
 * in progress, raw ingredients, hands, plating, packaging — all common in
 * search results for a dish name but wrong as the dish's hero image.
 */
export const FOOD_EXCLUSION_KEYWORDS = new Set([
  "cooking", "preparation", "prep", "preparing", "cook", "cooks", "cooking process",
  "kitchen", "chef hands", "hands", "hand", "fingers", "plating", "plate up", "plated",
  "garnish", "garnishing", "assembling", "assembly", "making", "making of", "behind the scenes",
  "process", "step by step", "steps", "tutorial", "how to", "recipe card", "recipe book",
  "recipe page", "ingredients", "ingredient", "raw", "uncooked", "unbaked", "dough",
  "flour", "spices", "spice", "herbs", "seasoning", "marinade", "marinating", "mixing",
  "mixing bowl", "bowl of flour", "batter", "mixture", "preparation table", "worktop",
  "unboxing", "packaging", "package", "packet", "box", "carton", "jar", "bottle", "can",
  "container", "label", "nutrition facts", "ingredient list", "shopping", "groceries",
  "grocery", "supermarket", "market stall", "produce", "vegetable patch", "garden harvest",
  "harvest", "planting", "growing", "greenhouse", "farmers market", "butcher", "fishmonger",
  "bakery counter", "deli counter", "takeout container", "takeaway box", "delivery bag",
  "food delivery", "meal prep", "mealprep", "lunchbox", "bento box", "tupperware",
]);

export const FOOD_KEYWORDS = [
  "food", "cuisine", "dish", "meal", "recipe", "ingredient", "cooking", "baking", "grill",
  "roast", "steam", "fry", "saute", "boil", "broil", "bake", "fresh", "organic", "homemade",
  "gourmet", "delicious", "tasty", "flavorful", "savory", "sweet", "spicy", "healthy",
  "plate", "platter", "bowl", "serving", "portion", "dinner", "lunch", "breakfast", "brunch",
  "appetizer", "entree", "main course", "dessert", "side dish", "salad", "soup", "sandwich",
  "pizza", "pasta", "burger", "steak", "seafood", "chicken", "vegetarian", "vegan",
  "restaurant", "menu", "chef", "kitchen", "culinary", "gastronomy", "fusion",
  "traditional", "authentic", "regional", "local", "artisan", "handcrafted",
];

export const FOOD_PATTERNS = [
  /\b(food|dish|cuisine|meal|plate)\b/i,
  /\b(recipe|cooking|baking|grilling|roasting)\b/i,
  /\b(ingredient|fresh|organic|gourmet|homemade)\b/i,
  /\b(dinner|lunch|breakfast|brunch|appetizer|entree|dessert)\b/i,
  /\b(restaurant|chef|kitchen|culinary|menu)\b/i,
  /\b(pizza|pasta|burger|steak|seafood|chicken|salad|soup|sandwich)\b/i,
  /\b(delicious|tasty|flavorful|savory|sweet|spicy)\b/i,
];
