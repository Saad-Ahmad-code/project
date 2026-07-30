# MenuLens — Complete Upgrade Roadmap

> **Status:** Planning only — not yet implemented
> **Goal:** Transform MenuLens from a functional prototype into a polished, professional restaurant menu scanning application with clean UI architecture, accessible components, refined visual design, and expanded features.
> **Architecture:** Next.js 15 App Router, dark-themed SPA, local JSON storage, multi-layer OCR pipeline (Tesseract.js → Sharp → EasyOCR → AI Vision), Groq-based AI Food Expert, Open Food Facts nutrition API.
> **Tech Stack:** React 19, TypeScript 5.7, Next.js 15.5, shadcn/ui, Tailwind CSS v4, Framer Motion, Lucide, Recharts (Phase 6)

---

## Phase 0 — Foundation & Tooling
*Setup work. No visual changes. Unlocks all subsequent phases.*

**Dependencies:** None — start here.

---

### Task 0.1: Install Tailwind CSS v4

**Objective:** Install and configure Tailwind CSS as the utility-first CSS framework, replacing all inline `style={{}}` props.

**Files:**
- Create: `postcss.config.mjs`
- Create: `src/app/globals.css` (rewrite with Tailwind directives)
- Create: `tailwind.config.ts`

**Step 1: Install packages**

```bash
npm install tailwindcss @tailwindcss/postcss postcss
```

**Step 2: Create `postcss.config.mjs`**

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
export default config;
```

**Step 3: Rewrite `src/app/globals.css`**

```css
@import "tailwindcss";

@theme {
  --color-primary: #059669;
  --color-primary-hover: #047857;
  --color-accent: #d97706;
  --color-accent-hover: #b45309;
  --color-surface: #18181b;
  --color-surface-hover: #27272a;
  --color-border: #27272a;
  --color-muted: #a1a1aa;
  --color-destructive: #dc2626;
  --color-success: #16a34a;
  --color-background: #09090b;

  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: "SF Mono", "Fira Code", monospace;
}

*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: var(--font-sans);
  background: var(--color-background);
  color: #e4e4e7;
  min-height: 100vh;
}

a {
  color: var(--color-primary);
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
}

button {
  cursor: pointer;
  font-family: inherit;
}
```

**Step 4: Update `src/app/layout.tsx`** — remove the old import (same file, content unchanged but now points to Tailwind globals).

**Step 5: Build verification**

```bash
npx next build
```

Expected: ✓ Compiled successfully, no errors.

---

### Task 0.2: Install & Initialize shadcn/ui

**Objective:** Install shadcn/ui component library for accessible, dark-mode-native UI primitives.

**Dependencies:** Task 0.1 (Tailwind CSS)

**Files:**
- Create: `components.json` (shadcn config)
- Create: `src/lib/utils.ts` (cn utility)
- Create: `src/components/ui/*.tsx` (per-component as added)

**Step 1: Install shadcn CLI and init**

```bash
npx shadcn@latest init
```

Use these settings:
- Style: Default
- Base color: Zinc
- CSS variables: Yes
- Dark mode: Yes
- Import alias: `@/components`

**Step 2: Add base utility component**

```bash
npx shadcn@latest add button card dialog input progress badge skeleton
```

This creates:
- `src/components/ui/button.tsx`
- `src/components/ui/card.tsx`
- `src/components/ui/dialog.tsx`
- `src/components/ui/input.tsx`
- `src/components/ui/progress.tsx`
- `src/components/ui/badge.tsx`
- `src/components/ui/skeleton.tsx`

**Step 3: Build verification**

```bash
npx next build
```

Expected: ✓ Compiled successfully.

---

### Task 0.3: Remove All Emoji Usage

**Objective:** Remove all emoji characters used as UI icons throughout the application. Replace with text labels, CSS indicators, or nothing — no icon library used.

**Files to modify (all pages with emoji):**
- `src/app/scan/page.tsx` — 🤖, 🍽️, 🎬, ⭐, 🏆, 💡, 🍷, 🔄, ✅ (9 instances)
- `src/app/results/[id]/page.tsx` — 🤖, 🍽️, ⭐, 🏆, 💡, 🍷, 🔄, 🥗 (8 instances)
- `src/components/NutritionPanel.tsx` — 🥗, 🔍, 🔥, 🥩, 🧈, 🍚, 🌾, 🍬 (8 instances)
- `src/app/page.tsx` — none
- `src/components/dishes/DishCard.tsx` — none

**Search pattern:**

```bash
grep -rn '[🍽️🤖🥗⭐🔄🍷💡🏆🌿🔥🍚🥩🧈🍬🎬✅]' src/ --include="*.tsx" --include="*.ts"
```

**For each instance, apply one of these rules:**
- **Buttons/actions:** Replace emoji with descriptive text (e.g., "🤖 Ask AI Food Expert" → "Ask AI Food Expert")
- **Status indicators:** Replace with CSS colored indicators (e.g., green dot for success, red for error)
- **Labels:** Replace with plain text (e.g., "🔥 Calories" → "Calories")
- **Section headers:** Replace with plain text + underline or border accent
- **Loading:** Replace bounce animation with a clean spinner or skeleton

**Key replacements table:**

| Current | Replacement | Location |
|---------|-------------|----------|
| `🤖 Ask AI Food Expert` | `Ask AI Food Expert` | Scan page, Results page |
| `🥗 Hide Nutrition` | `Hide Nutrition` | NutritionPanel |
| `🥗 Nutrition` | `Nutrition` | NutritionPanel |
| `🔍 Looking up...` | `Looking up...` | NutritionPanel |
| `🔥 **{r.calories}** kcal` | `**{r.calories}** kcal` | NutritionPanel |
| `🥩 **{r.protein_g}g** protein` | `**{r.protein_g}g** protein` | NutritionPanel |
| `🧈 **{r.fat_g}g** fat` | `**{r.fat_g}g** fat` | NutritionPanel |
| `🍚 **{r.carbs_g}g** carbs` | `**{r.carbs_g}g** carbs` | NutritionPanel |
| `🌾 **{r.fiber_g}g** fiber` | `**{r.fiber_g}g** fiber` | NutritionPanel |
| `🍬 **{r.sugars_g}g** sugars` | `**{r.sugars_g}g** sugars` | NutritionPanel |
| `⭐ MUST TRY` | `MUST TRY` | Scan page, Results page |
| `🏆 TOP PICKS` | `TOP PICKS` | Scan page, Results page |
| `💡 TIPS` | `TIPS` | Scan page, Results page |
| `🍷 {pick.pairing}` | `{pick.pairing}` | Scan page, Results page |
| `🔄 Regenerate Suggestions` | `Regenerate Suggestions` | Scan page, Results page |

**Verification:**

```bash
grep -rn '[🍽️🤖🥗⭐🔄🍷💡🏆🌿🔥🍚🥩🧈🍬🎬✅]' src/ --include="*.tsx" --include="*.ts"
```

Expected: No matches.

---

### Task 0.4: Color Palette — Emerald Primary, Amber Accent

**Objective:** Apply the new color palette across all components. Already defined in `globals.css` via Tailwind theme. Now update all inline styles to use theme colors.

**Note:** This happens gradually as each component is migrated to Tailwind in Phase 1. The palette values are set in `globals.css` — any existing inline styles remain as-is until migrated.

**Verification:** Visual inspection after Phase 1 migration confirms correct colors.

---

### Task 0.5: Typography Scale

**Objective:** Define and apply a consistent type scale. No custom fonts — use system font stack with explicit size/weight/line-height classes.

**Implementation:** Tailwind's default type scale already maps well. Add semantic aliases in `globals.css` if needed. The scale:

| Level | Tailwind Class | Size | Weight | Use |
|-------|---------------|------|--------|-----|
| Display | `text-4xl font-bold` | 2.25rem | 700 | Page titles |
| Heading 1 | `text-2xl font-semibold` | 1.5rem | 600 | Section headers |
| Heading 2 | `text-xl font-semibold` | 1.25rem | 600 | Card titles (dish name) |
| Body | `text-base` | 1rem | 400 | Paragraph text |
| Body small | `text-sm` | 0.875rem | 400 | Secondary info |
| Caption | `text-xs font-medium` | 0.75rem | 500 | Badges, dates, confidence |
| Label | `text-sm font-medium` | 0.875rem | 500 | Form labels |

**Files to modify:** Applied globally via JSX class names during Phase 1 — no separate task needed.

---

### Task 0.6: Spacing System

**Objective:** Consistent spacing using Tailwind spacing scale. Replace current mix of arbitrary values.

**Scale to use:**

| Token | Value | Usage |
|-------|-------|-------|
| `gap-2` | 8px | Tight icon-text spacing |
| `gap-3` | 12px | Button groups |
| `gap-4` | 16px | Card internal padding |
| `gap-6` | 24px | Between sections |
| `gap-8` | 32px | Major page blocks |
| `p-4` | 16px | Card padding |
| `p-8` | 32px | Page container padding |
| `max-w-4xl` | 896px | Page max-width |

**Applied during Phase 1 migration** — no separate task.

**Verification:** Visual inspection — all pages use consistent spacing.

---

## Phase 1 — Component Migration
*Replace hand-rolled inline styles with shadcn/ui components. Structural change only — visual appearance preserved.*

**Dependencies:** Phase 0 (Tailwind, shadcn init, shadcn components added)

---

### Task 1.1: Migrate Navbar to shadcn Components

**Objective:** Replace Navbar inline styles with Tailwind classes + shadcn Button.

**File:** `src/components/ui/Navbar.tsx`

**Current:** 41 lines, all inline `style={{}}`.
**Replacement:** Use `<Button variant="ghost">` for nav items, Tailwind classes for layout.

**Key changes:**
- `<nav style={{display:"flex",justifyContent:"space-between"...}}>`
  → `<nav className="flex items-center justify-between px-8 py-4 border-b border-border">`
- Link "MenuLens" → `<span className="text-xl font-bold text-white">`
- Scan/History links → `<Button variant="ghost" asChild>`
- Login button → `<Button variant="outline" size="sm">`
- Logout button → `<Button variant="ghost" size="sm">`
- Email display → `<span className="text-sm text-muted">`
- Loading text → `<Skeleton className="h-4 w-20" />`

**Verification:**

```bash
npx next build
```

Expected: ✓ Compiled successfully.

---

### Task 1.2: Migrate DishCard to shadcn Card

**Objective:** Replace DishCard inline styles with shadcn Card component.

**File:** `src/components/dishes/DishCard.tsx`

**Current:** 46 lines, all inline `style={{}}`.
**Replacement:** Use `<Card>`, `<CardContent>`, Badge, Tailwind classes.

**Key changes:**
- Outer div → `<Card className="bg-surface">` with `flex` layout
- Image → standard `<img>` with Tailwind sizing classes
- Name → `<CardTitle className="text-lg">`
- Description → `<p className="text-sm text-muted">`
- AI description → `<p className="text-xs text-muted">`
- Price → `<span className="text-accent font-bold">`
- Category → `<Badge variant="outline">`
- Dietary tags → `<Badge variant="secondary">`
- Confidence → `<span className="text-xs text-muted">`

**Verification:**

```bash
npx next build
```

Expected: ✓ Compiled successfully.

---

### Task 1.3: Migrate Image Lightbox to shadcn Dialog (Scan Page)

**Objective:** Replace the hand-rolled image lightbox (`position:fixed` overlay) in the scan page with shadcn Dialog.

**File:** `src/app/scan/page.tsx` (lines 365–395, LocalDishItem component)

**Current:** Manual overlay with `position:"fixed", inset:0, background:"rgba(0,0,0,0.85)"` — ~30 lines of inline styles.

**Replacement:**
```tsx
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog"
```

Wrap lightbox content in `<Dialog open={showImages} onOpenChange={setShowImages}>`:
- Close button → `<DialogClose />`
- Title → `<DialogHeader><DialogTitle>{item.name}</DialogTitle></DialogHeader>`
- Image grid → `<div className="grid grid-cols-2 md:grid-cols-3 gap-3">`

**Verification:**

```bash
npx next build
```

Expected: ✓ Compiled successfully.

---

### Task 1.4: Migrate Image Lightbox to shadcn Dialog (Results Page)

**Objective:** Same migration for the results page lightbox.

**File:** `src/app/results/[id]/page.tsx` (lines 194–231)

**Same pattern** as Task 1.3 — replace hand-rolled overlay with shadcn Dialog.

**Verification:**

```bash
npx next build
```

Expected: ✓ Compiled successfully.

---

### Task 1.5: Replace Loading States with Skeleton

**Objective:** Replace all "Loading..." text with shadcn Skeleton placeholders.

**Files to modify:**

| File | Current | Replacement |
|------|---------|-------------|
| `src/app/scan/page.tsx` line 251 | `<p>🍽️ AI Food Expert is analyzing your menu...</p>` | `<Skeleton className="h-20 w-full" />` |
| `src/app/results/[id]/page.tsx` line 79 | `<p>Loading...</p>` | `<Skeleton className="h-8 w-48" />` + `<Skeleton className="h-64 w-full mt-4" />` |
| `src/app/history/page.tsx` line ~12 | `<p>Loading...</p>` | `<Skeleton className="h-8 w-48" />` + `<Skeleton className="h-20 w-full mt-4" />` |
| `src/app/scan/page.tsx` (Navbar loading) | `<span>Loading...</span>` | `<Skeleton className="h-4 w-20" />` |
| `src/components/NutritionPanel.tsx` line ~36 | "Looking up..." text | Already handled — button shows disabled state |

**Verification:**

```bash
npx next build
```

Expected: ✓ Compiled successfully.

---

### Task 1.6: Progress Bar → shadcn Progress

**Objective:** Replace the hand-rolled progress bar on the scan page with shadcn Progress.

**File:** `src/app/scan/page.tsx` (lines 197–203)

**Current:**
```tsx
<div style={{ height: 8, background: "#222", borderRadius: 4, overflow: "hidden", marginBottom: "0.5rem" }}>
  <div style={{ height: "100%", width: `${progress}%`, background: "#2563eb", transition: "width 0.3s" }} />
</div>
```

**Replacement:**
```tsx
<Progress value={progress} className="h-2 mb-2" />
```

shadcn Progress handles:
- Animated fill
- Determinate/indeterminate modes
- Consistent styling
- Accessible role="progressbar"

**Verification:**

```bash
npx next build
```

Expected: ✓ Compiled successfully.

---

### Task 1.7: Error/Success Divs → Toast

**Objective:** Replace manual error/success message divs with shadcn Sonner/Toast component.

**Step 1: Add Sonner**

```bash
npx shadcn@latest add sonner
```

**Step 2: Add `<Toaster />` to `src/app/layout.tsx`**

```tsx
import { Toaster } from "@/components/ui/sonner"
// Inside body:
<Toaster position="bottom-right" />
```

**Step 3: Migrate each error div**

| File | Current | Replacement |
|------|---------|-------------|
| `scan/page.tsx:207-218` | `<div style={{background:"#2d1b1b"...}}>{error}</div>` | `toast.error(error)` |
| `results/[id]/page.tsx:119-123` | `<div style={{background:"#2d1b1b"...}}>{suggestionsError}</div>` | `toast.error(suggestionsError)` |
| `results/[id]/page.tsx` (general error) | `<p style={{color:"red"}}>{error}</p>` | `toast.error(error)` |
| `history/page.tsx` | `<div style={{background:"#2d1b1b"...}}>{error}</div>` | `toast.error(error)` |
| `compare/page.tsx:59` | `<p style={{color:"#f87171"...}}>{error}</p>` | `toast.error(error)` |
| `auth/login/page.tsx` | `<p style={{color:"#f87171"...}}>{error}</p>` | `toast.error(error)` |
| `auth/register/page.tsx` | (similar pattern) | `toast.error(error)` |

**Step 4: Replace success indicators**
- `history/page.tsx` status "completed" → `<Badge variant="success">Completed</Badge>`
- `compare/page.tsx` price → `<span className="text-accent font-medium">`

**Note:** The error blocks may still be needed for persistent display (not auto-dismiss). In those cases, keep a div but use Tailwind classes instead:
```tsx
<div className="p-3 rounded-lg bg-red-950 border border-red-800 text-red-400 text-sm">
  {error}
</div>
```

**Verification:**

```bash
npx next build
```

Expected: ✓ Compiled successfully.

---

### Task 1.8: History Page → shadcn Table

**Objective:** Replace the flat list of `<Link>` items on the history page with a proper table.

**File:** `src/app/history/page.tsx`

**Current:** Unordered list of scan links with item count + date.
**Replacement:**

```tsx
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
```

Table columns:
- Date (formatted)
- Item Count
- Status (Completed → Badge green, Processing → Badge yellow)
- View (link)

**Verification:**

```bash
npx next build
```

Expected: ✓ Compiled successfully.

---

### Task 1.9: Compare Page → shadcn Card Layout

**Objective:** Replace flat list with side-by-side card layout.

**File:** `src/app/compare/page.tsx`

**Current:** Single-column list with flexbox.
**Replacement:** Grid with two columns, each scan in a Card.

**Verification:**

```bash
npx next build
```

Expected: ✓ Compiled successfully.

---

### Task 1.10: Results Page → 2-Column Dish Grid

**Objective:** Display dishes in a responsive grid instead of single column.

**File:** `src/app/results/[id]/page.tsx` (line 175)

**Current:** `<div style={{display:"grid", gap:"1rem"}}>`
**Replacement:** `<div className="grid grid-cols-1 md:grid-cols-2 gap-4">`

**Verification:**

```bash
npx next build
```

Expected: ✓ Compiled successfully.

---

## Phase 2 — Animation & Interaction
*Subtle, functional motion added via Framer Motion. No decorative animation.*

**Dependencies:** Phase 1 (components migrated)

---

### Task 2.1: Install Framer Motion

```bash
npm install framer-motion
```

**Verification:**

```bash
npx next build
```

Expected: ✓ Compiled successfully.

---

### Task 2.2: Dish Card Staggered Entrance

**Objective:** Items in the dish results list animate in one-by-one rather than appearing all at once.

**File:** `src/app/results/[id]/page.tsx` (items.map section)
**File:** `src/app/scan/page.tsx` (localItems.map section)

**Pattern:**
```tsx
import { motion, AnimatePresence } from "framer-motion"

<motion.div
  layout
  initial={{ opacity: 0, y: 12 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.25, delay: index * 0.05 }}
>
  <DishCard ... />
</motion.div>
```

**Verification:** Visual — cards appear sequentially on results load.

---

### Task 2.3: Nutrition Panel Expand/Collapse

**Objective:** Smooth height transition when the nutrition panel opens/closes.

**File:** `src/components/NutritionPanel.tsx`

**Pattern:**
```tsx
import { AnimatePresence, motion } from "framer-motion"

<AnimatePresence>
  {expanded && results && (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* nutrition content */}
    </motion.div>
  )}
</AnimatePresence>
```

**Verification:** Visual — panel expands/shrinks smoothly.

---

### Task 2.4: Image Lightbox Zoom

**Objective:** Image lightbox opens with a zoom-in animation + backdrop blur.

**File:** `src/app/scan/page.tsx` and `src/app/results/[id]/page.tsx`

Framer Motion's `<AnimatePresence>` wraps the Dialog:
```tsx
<motion.div
  initial={{ opacity: 0, scale: 0.95 }}
  animate={{ opacity: 1, scale: 1 }}
  exit={{ opacity: 0, scale: 0.95 }}
  transition={{ duration: 0.2 }}
>
```

**Verification:** Visual — lightbox zooms in on open, zooms out on close.

---

### Task 2.5: Error Toast Animation

**Objective:** Toasts (via Sonner) already animate by default — no additional work needed.

**Verification:** Visual — toasts slide in from bottom-right.

---

### Task 2.6: AI Food Expert Panel Slide-Down

**Objective:** Suggestions panel slides down when results load.

**File:** `src/app/scan/page.tsx` and `src/app/results/[id]/page.tsx`

```tsx
<motion.div
  initial={{ height: 0, opacity: 0 }}
  animate={{ height: "auto", opacity: 1 }}
  transition={{ duration: 0.3, ease: "easeOut" }}
>
```

**Verification:** Visual — panel slides open.

---

## Phase 3 — Feature Enhancements (Low Effort)
*New functionality built on existing infrastructure. No new third-party services.*

**Dependencies:** Phase 0, Phase 1 (stable component base)

---

### Task 3.1: Allergen Detection via Groq Prompt

**Objective:** Enhance the existing AI Food Expert to return structured allergen information for each dish.

**File:** `src/app/api/suggest/route.ts`

**Changes:**
1. Extend the Groq prompt to request allergen data per dish
2. Update the suggestion response type to include `allergens: string[]` per dish
3. Update the frontend `FoodExpertSuggestion` interface to match
4. Display allergens in the suggestions panel (if present)

**Prompt addition:**
```
For each dish, list potential allergens (gluten, dairy, nuts, soy, eggs, seafood, sesame).
If the dish name suggests an allergen, flag it.
Return: { "allergens": ["gluten", "dairy"] }
```

**New type field:**
```ts
interface DishSuggestion {
  name: string;
  reason: string;
  pairing?: string;
  allergens?: string[];
}
```

**Verification:**
```bash
curl -X POST http://localhost:3000/api/suggest \
  -H "Content-Type: application/json" \
  -d '{"dishes":["Butter Chicken","Garlic Naan","Dal Makhani"]}'
```

Expected: Response includes `allergens` array per dish.

---

### Task 3.2: Nutri-Score Health Rating

**Objective:** Calculate and display a Nutri-Score (A–E) for each dish using existing Open Food Facts nutrition data.

**File:** `src/app/api/nutrition/route.ts`
**File:** `src/components/NutritionPanel.tsx`

**Step 1: Add scoring function**

The Nutri-Score formula calculates points based on:
- **Negative:** Energy (kcal), saturated fat, sugar, sodium (per 100g)
- **Positive:** Fiber, protein, fruits/vegetables percentage

Simplified algorithm:
```ts
function calculateNutriScore(n: NutritionValues): string {
  // Points for energy
  let N = 0;
  if (n.calories > 275) N += 10;
  else if (n.calories > 200) N += 7;
  // ... full formula based on EU regulation

  // Positive points
  let P = 0;
  if (n.fiber_g > 4.7) P += 5;
  else if (n.fiber_g > 3.0) P += 3;
  // ...

  const score = N - P;
  if (score <= -1) return "A";
  if (score <= 2) return "B";
  if (score <= 10) return "C";
  if (score <= 18) return "D";
  return "E";
}
```

**Step 2: Display in NutritionPanel**

Show a colored badge: green (A) → red (E).

**Verification:**
```bash
curl -X POST http://localhost:3000/api/nutrition \
  -H "Content-Type: application/json" \
  -d '{"dish_name":"butter chicken"}'
```

Expected: Response includes `nutri_score: "C"` (or similar).

---

### Task 3.3: Menu Translation

**Objective:** Add a language selector that translates scanned menu text via Groq.

**New file:** `src/app/api/translate/route.ts`
**Modified file:** `src/app/scan/page.tsx` (add language dropdown)

**Step 1: Create `/api/translate` route**

```ts
// POST /api/translate
// Body: { text: string, target_language: string }
// Calls Groq to translate menu content
```

**Step 2: Add language selector to scan page**

Dropdown with languages: English, Urdu, Arabic, Chinese, French, Spanish, German, Japanese.

**Step 3: Display translated text**

After OCR completes and translation is fetched, show a toggle between original and translated.

**Verification:**
```bash
curl -X POST http://localhost:3000/api/translate \
  -H "Content-Type: application/json" \
  -d '{"text":"Butter Chicken - $16.99","target_language":"urdu"}'
```

Expected: Returns translated text.

---

### Task 3.4: Dietary Preference Filter

**Objective:** Let users set dietary preferences and auto-filter scanned dishes.

**New file:** `src/components/PreferencesPanel.tsx` (or section in results)
**Modified file:** `src/app/results/[id]/page.tsx`

**Step 1: Add preference UI**

Checkbox/button group for: Vegetarian, Vegan, Keto, Gluten-Free, Halal, Low-Carb.
Store selection in local state (or localStorage for persistence).

**Step 2: Filter function**

```ts
const filteredItems = items.filter(item => {
  if (preferences.vegetarian && item.dietary_tags?.includes("meat")) return false;
  if (preferences.vegan && item.dietary_tags?.includes("dairy")) return false;
  // ... more rules
  return true;
});
```

**Step 3: Show match count badge**

Badge above dish grid: "12 dishes match your preferences"

**Verification:** Visual — toggling preferences filters the dish list.

---

### Task 3.5: Calorie from Dish Photo (Groq Vision)

**Objective:** Let users snap a photo of a dish and get estimated calories via Groq Vision.

**New file or section in scan page:** "Snap & Track" button
**Reuses:** Existing Groq Vision infrastructure in `src/lib/ai/client.ts`

**Step 1: Create vision endpoint** (or reuse `/api/suggest` with image)

Send image to Groq with prompt: "Estimate the calories and macros for this dish. Return JSON."

**Step 2: Add button to results page**

Button: "Estimate Calories from Photo" — opens camera/file picker → sends to Groq → shows result.

**Verification:**
```bash
# Upload a dish photo
curl -X POST http://localhost:3000/api/suggest \
  -F "image=@/path/to/dish.jpg"
```

Expected: Returns calorie/macro estimate.

---

### Task 3.6: USDA Food Data Central Fallback

**Objective:** When Open Food Facts returns no results, fall back to USDA Food Data Central.

**File:** `src/app/api/nutrition/route.ts`

**Step 1: Add USDA client**

```ts
const USDA_FDC_URL = "https://api.nal.usda.gov/fdc/v1";
const USDA_API_KEY = process.env.USDA_API_KEY || "DEMO_KEY";

async function searchUSDA(query: string): Promise<NutritionResult[]> {
  const res = await fetch(
    `${USDA_FDC_URL}/foods/search?query=${encodeURIComponent(query)}&api_key=${USDA_API_KEY}&pageSize=5`,
  );
  // Parse and return results
}
```

**Step 2: Modify nutrition endpoint**

```ts
// Try Open Food Facts first
let results = await searchOpenFoodFacts(dishName);
if (results.length === 0) {
  // Fallback to USDA
  results = await searchUSDA(dishName);
}
```

**Verification:**
```bash
curl -X POST http://localhost:3000/api/nutrition \
  -H "Content-Type: application/json" \
  -d '{"dish_name":"pizza"}'
```

Expected: Returns results from either OFF or USDA.

---

## Phase 4 — Feature Enhancements (Medium Effort)
*New capabilities requiring additional dependencies or setup.*

**Dependencies:** Phase 3 or parallel

---

### Task 4.1: Barcode Scanner

**Objective:** Add camera-based barcode scanning for packaged food nutrition lookup.

**Frontend:**
- Install `html5-qrcode`: `npm install html5-qrcode`
- New component: `src/components/BarcodeScanner.tsx`
- Opens camera, scans EAN/upc barcode
- Sends barcode → `/api/nutrition` (already supports barcode field)
- Displays nutrition results in NutritionPanel

**Backend:** No changes needed — your existing `/api/nutrition` endpoint already accepts a `barcode` query parameter and passes it to Open Food Facts.

**Verification:** Visual — scan a barcode → see nutrition data.

---

### Task 4.2: Dish Image Classification (Food101)

**Objective:** Identify a dish from a photo using a pretrained PyTorch model.

**New file:** `src/scripts/food_classifier.py` (Python script)
**New route:** `src/app/api/classify/route.ts`

**Python script:**
```python
import torch
from torchvision import models, transforms
from PIL import Image
import json, sys

model = models.resnet18(weights=models.ResNet18_Weights.IMAGENET1K_V1)
# Map ImageNet classes to food-relevant categories
# ... inference logic
```

Since `.venv` already has PyTorch (2.13.0), the dependency is already installed.

**Integration:** `POST /api/classify` accepts an image, calls the Python script, returns top matching dish names with confidence scores.

**Verification:**
```bash
curl -X POST http://localhost:3000/api/classify \
  -F "image=@/path/to/dish.jpg"
```

Expected: Returns `{"dishes": [{"name": "butter chicken", "confidence": 0.87}]}`

---

### Task 4.3: PDF Menu Support

**Objective:** Accept PDF menu uploads in addition to images.

**Backend:**
- Use `VikParuchuri/marker` or `drmingler/docling-api` Python library
- New Python script: `src/scripts/pdf_extract.py`
- New route or modify `/api/scan/new` to accept PDF
- Extract text → feed into existing OCR pipeline (skip image-based layers)

**Dependency:** Install marker: `pip install marker-pdf`

**Verification:**
```bash
curl -X POST http://localhost:3000/api/scan/new \
  -F "file=@/path/to/menu.pdf"
```

Expected: Same response as image scan — structured menu items.

---

### Task 4.4: PaddleOCR Layout Detection

**Objective:** Detect menu sections (Appetizers, Mains, Desserts, Drinks) automatically using PaddleOCR layout analysis.

**File:** `src/scripts/easyocr_scan.py` (modify to add layout detection step)

**Approach:**
- After EasyOCR reads text, run layout analysis to group items by section
- Use PaddleOCR's layout detection model or a simpler approach: group text by vertical position (y-coordinate), separated by whitespace gaps
- Assign category labels based on known patterns or proximity to headers

**Verification:** Scanned menus show section headers ("Appetizers", "Mains") as group labels.

---

### Task 4.5: Recipe Lookup via TheMealDB

**Objective:** Add a "Show Recipe" button per dish that fetches recipe from TheMealDB.

**New route:** `src/app/api/recipes/route.ts`

TheMealDB API: `https://www.themealdb.com/api/json/v1/1/search.php?s={dish_name}`

Free, no API key.

**Display:** Modal or panel showing ingredients, measurements, instructions, and recipe image.

**Verification:**
```bash
curl http://localhost:3000/api/recipes?dish=butter%20chicken
```

Expected: Returns recipe data.

---

## Phase 5 — Page-Level Redesigns
*Holistic page redesigns that unify all previous phases.*

**Dependencies:** Phase 0, 1, 2 (components, animations)

---

### Task 5.1: Landing Page Redesign

**File:** `src/app/page.tsx`

**Current:** 20 lines — title + 2 links.
**Proposed:**
- Full-viewport hero section
- Large heading + supporting description
- Two `Button` variants: primary (Scan) + outline (History)
- Three-step "How It Works" compact row: Upload → Scan → Review
- Footer with minimal links

**Layout:**
```tsx
<main className="min-h-screen flex flex-col items-center justify-center px-4">
  <section className="max-w-2xl text-center space-y-6">
    <h1 className="text-5xl font-bold tracking-tight">MenuLens</h1>
    <p className="text-lg text-muted max-w-md mx-auto">
      Scan and analyze restaurant menus with AI
    </p>
    <div className="flex gap-4 justify-center pt-2">
      <Button size="lg" asChild><Link href="/scan">Scan a Menu</Link></Button>
      <Button size="lg" variant="outline" asChild><Link href="/history">View History</Link></Button>
    </div>
  </section>
  <section className="mt-16 grid grid-cols-3 gap-8 max-w-2xl text-center text-sm text-muted">
    <div><span className="font-semibold text-white block">01</span> Upload menu photo</div>
    <div><span className="font-semibold text-white block">02</span> AI extracts dishes</div>
    <div><span className="font-semibold text-white block">03</span> Review & save</div>
  </section>
</main>
```

**Verification:** Visual check at `/` — hero with CTAs, step guide below.

---

### Task 5.2: Scan Page Upload Area Refinement

**File:** `src/app/scan/page.tsx`

**Current:** Dashed drop zone with centered text.
**Proposed:**
- Full-width drop zone with `border-dashed border-2 border-border`
- "Upload menu image" label above drop zone
- After selection: image preview + two buttons (primary "Scan with AI", outline "Scan Offline")
- Clean progress bar during scanning
- Results section below (same as current)

**Verification:** Visual check at `/scan`.

---

### Task 5.3: Results Page Layout Refinement

**File:** `src/app/results/[id]/page.tsx`

**Current:** Single-column dish list + floating AI Food Expert button.
**Proposed:**
- 2-column dish grid (Task 1.10)
- AI Food Expert as a collapsible Card section above the grid
- Nutrition panel inside each card (already done in Phase 1)
- Animated entrance for cards (Task 2.2)

**Verification:** Visual check at `/results/[id]`.

---

### Task 5.4: Admin Dashboard Enhancement

**File:** `src/app/admin/page.tsx`

**Current:** 3 stat cards.
**Proposed:**
- Keep the 3 stat cards
- Add: Recharts trend chart (scan volume over last 7 days)
- Add: Recent scans mini-table (shadcn Table, last 10)
- Add: Agent health status panel (from `/api/admin/agent`)

**Dependency:** `npm install recharts`

**Verification:** Visual check at `/admin`.

---

## Phase 6 — Major New Capabilities
*High-effort, transformational features.*

**Dependencies:** All previous phases

---

### Task 6.1: Multi-Agent Food Expert (LangGraph)

**Objective:** Upgrade the single Groq call to a coordinated multi-agent system.

**Architecture:**
- **Orchestrator Agent:** Receives dish list, delegates to specialized agents
- **Categorization Agent:** Groups dishes by meal type, cuisine, dietary category
- **Pairing Agent:** Suggests wine/drink pairings for each dish
- **Nutrition Agent:** Fetches and summarizes nutrition data (via existing `/api/nutrition`)
- **Recommendation Agent:** Generates top picks based on analysis

**Implementation:** LangGraph Python library. Python script called from Next.js API route (similar pattern to EasyOCR).

**Reference:** `luisrodriguesphd/combinaai` — WhatsApp AI concierge with LangGraph multi-agent for food recommendations.

**Verification:**
```bash
curl -X POST http://localhost:3000/api/suggest \
  -H "Content-Type: application/json" \
  -d '{"dishes":["Butter Chicken","Garlic Naan","Dal Makhani","Gulab Jamun"]}'
```

Expected: Detailed multi-perspective response covering categories, pairings, nutrition, recommendations.

---

### Task 6.2: Restaurant Discovery & Comparison

**Objective:** Find restaurants near the user, view their menus (if scanned), compare prices.

**New page:** `src/app/discover/page.tsx`
**New components:** `RestaurantCard`, `LocationSearch`
**New routes:** `/api/places/search`, `/api/places/[id]`

**Integration:** Google Places API (free tier) or Yelp Fusion API (free, 5k calls/day).

**Features:**
- Search field for restaurant name or cuisine
- Results list with ratings, distance, address
- Click restaurant → see all their scanned menus (from local DB)
- Compare prices across restaurants for same dish

**Verification:** Visual check at `/discover` — search for restaurants, see menu comparisons.

---

### Task 6.3: Digital Menu Generator

**Objective:** After scanning a physical menu, let restaurant owners publish it as a hosted digital menu with QR code.

**New page:** `src/app/menu/[id]/page.tsx` (public, no auth)
**New feature on results page:** "Publish as Digital Menu" button

**Features:**
- Takes scanned OCR output → validates/edits items
- Generates public page at `/menu/[id]` with clean layout
- Generates QR code pointing to the public page
- Option to set restaurant name, description, hours

**Reference:** `kaje94/menufic` (★136) — Next.js T3 stack digital menu generator.

**Verification:**
```bash
# After scanning a menu, click "Publish" → visit /menu/{id}
curl http://localhost:3000/menu/{id}
```

Expected: Beautiful public menu page with categories, prices, descriptions, images.

---

## Appendix: File Change Summary

### Phase 0 — Foundation
| File | Action |
|------|--------|
| `postcss.config.mjs` | **Create** |
| `tailwind.config.ts` | **Create** |
| `src/app/globals.css` | **Rewrite** |
| `components.json` | **Create** (by shadcn init) |
| `src/lib/utils.ts` | **Create** (by shadcn init) |
| `src/components/ui/button.tsx` | **Create** (shadcn) |
| `src/components/ui/card.tsx` | **Create** (shadcn) |
| `src/components/ui/dialog.tsx` | **Create** (shadcn) |
| `src/components/ui/input.tsx` | **Create** (shadcn) |
| `src/components/ui/progress.tsx` | **Create** (shadcn) |
| `src/components/ui/badge.tsx` | **Create** (shadcn) |
| `src/components/ui/skeleton.tsx` | **Create** (shadcn) |
| `src/components/ui/sonner.tsx` | **Create** (shadcn) |
| `src/app/scan/page.tsx` | **Modify** (remove emoji) |
| `src/app/results/[id]/page.tsx` | **Modify** (remove emoji) |
| `src/components/NutritionPanel.tsx` | **Modify** (remove emoji) |

### Phase 1 — Component Migration
| File | Action |
|------|--------|
| `src/components/ui/Navbar.tsx` | **Rewrite** (shadcn components) |
| `src/components/dishes/DishCard.tsx` | **Rewrite** (shadcn Card) |
| `src/app/scan/page.tsx` | **Modify** (Dialog, Skeleton, Progress) |
| `src/app/results/[id]/page.tsx` | **Modify** (Dialog, Skeleton, grid) |
| `src/app/history/page.tsx` | **Rewrite** (shadcn Table) |
| `src/app/compare/page.tsx` | **Modify** (Card layout) |
| `src/app/layout.tsx` | **Modify** (add Toaster) |
| `src/app/auth/login/page.tsx` | **Modify** (Toast, Tailwind classes) |
| `src/app/auth/register/page.tsx` | **Modify** (Toast, Tailwind classes) |
| `src/components/NutritionPanel.tsx` | **Modify** (Toast, Tailwind) |

### Phase 2 — Animation
| File | Action |
|------|--------|
| `src/app/scan/page.tsx` | **Modify** (Framer Motion stagger/slide) |
| `src/app/results/[id]/page.tsx` | **Modify** (Framer Motion stagger/slide) |
| `src/components/NutritionPanel.tsx` | **Modify** (Framer Motion expand) |

### Phase 3 — Low-Effort Features
| File | Action |
|------|--------|
| `src/app/api/suggest/route.ts` | **Modify** (allergen prompt) |
| `src/app/api/nutrition/route.ts` | **Modify** (Nutri-Score, USDA fallback) |
| `src/components/NutritionPanel.tsx` | **Modify** (Nutri-Score badge display) |
| `src/app/api/translate/route.ts` | **Create** |
| `src/app/scan/page.tsx` | **Modify** (language selector) |
| `src/components/PreferencesPanel.tsx` | **Create** |
| `src/app/results/[id]/page.tsx` | **Modify** (preferences filter) |

### Phase 4 — Medium Features
| File | Action |
|------|--------|
| `src/components/BarcodeScanner.tsx` | **Create** |
| `src/app/api/classify/route.ts` | **Create** |
| `src/scripts/food_classifier.py` | **Create** |
| `src/scripts/pdf_extract.py` | **Create** |
| `src/app/api/recipes/route.ts` | **Create** |
| `src/app/api/scan/new/route.ts` | **Modify** (PDF support) |
| `src/scripts/easyocr_scan.py` | **Modify** (layout detection) |

### Phase 5 — Redesigns
| File | Action |
|------|--------|
| `src/app/page.tsx` | **Rewrite** (hero + how-it-works) |
| `src/app/admin/page.tsx` | **Modify** (Recharts chart + table) |

### Phase 6 — Major Capabilities
| File | Action |
|------|--------|
| `src/scripts/multi_agent.py` | **Create** |
| `src/app/api/suggest/route.ts` | **Modify** (multi-agent integration) |
| `src/app/discover/page.tsx` | **Create** |
| `src/app/menu/[id]/page.tsx` | **Create** |

---

## Verification Strategy

### Build Verification (after every task)
```bash
npx next build
```
Expected: ✓ Compiled successfully, 0 errors.

### API Verification (after every backend task)
```bash
# Test the endpoint
curl -X POST http://localhost:3000/api/{endpoint} \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```
Expected: 200 response with expected shape.

### Visual Verification (after every frontend task)
- `/` — Landing page
- `/scan` — Upload, scan, results
- `/results/[id]` — Dish cards, nutrition, suggestions
- `/history` — Scan list
- `/compare` — Side-by-side
- `/admin` — Stats + charts
- `/auth/login` — Login form

### Git Commit Strategy
```
phase-0: Foundation setup (Tailwind, shadcn, palette, remove emoji, typography, spacing)
phase-1: Component migration (Navbar, DishCard, Dialog, Skeleton, Progress, Toast, Table, Compare)
phase-2: Animation (Framer Motion stagger, expand, zoom)
phase-3a: Allergen detection + Nutri-Score
phase-3b: Menu translation + dietary filters
phase-3c: Calorie from photo + USDA fallback
phase-4: Barcode, Classification, PDF, Layout, Recipes
phase-5: Page redesigns (Landing, Admin)
phase-6: Multi-agent, Discovery, Menu Generator
```
