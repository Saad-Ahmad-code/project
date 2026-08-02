# Fix Dish/Price Grouping Bug ("Dish One $10 Dish Two") Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Eliminate garbled OCR output where one item contains two dish names with a price wedged between them ("Dish One $10 Dish Two"), and stop orphan price lines from leaking onto the wrong dish.

**Architecture:** All changes live in `src/lib/ocr/local.ts` (offline pipeline — `engine.ts` is frozen per AGENTS.md rule 1; the online scan path's L1/L2 call `runLocalOCR`, so the fix reaches online scans too). Three layered fixes: (A) make the existing merged-row splitter iterative + relax its guards, (B) fix the `pendingPrice` lifecycle leak in `parseColumn`, (C) split multi-price word-rows at the bounding-box level in `groupIntoLines` so column detection never sees fused rows. Regression coverage via the existing `test_batch.ts` harness + new synthetic corpus menus.

**Tech Stack:** TypeScript, Next.js 15, RapidOCR/Tesseract.js OCR pipeline, PIL-generated synthetic menus, `npx tsx` harness.

---

## Root Cause Analysis (grounded in current code)

### Failure mode 1 — merged rows survive the splitter (`splitMergedDishLine`, local.ts:776-815)

OCR fuses two adjacent rows into one line (or a two-column menu puts two dishes on one Y-row that `groupIntoLines` merges — only *header-like* tokens trigger the split at local.ts:1354-1360, dish rows never do). `findPriceInText` (local.ts:709-735) extracts only ONE price (trailing), so the line becomes:

- item name: `"Dish One $10 Dish Two"` (mid price still embedded)
- item price: `12` (trailing)

The post-parse fallback `splitMergedItemsFallback` (local.ts:823-834, called at 2466 and 2500) exists to fix this, but has three gaps:

1. **One-shot, not iterative.** `"Dish One $10 Dish Two $12 Dish Three"` splits into `[Dish One @10, "Dish Two $12 Dish Three" @12]` — the second output still contains an embedded price, and re-running the regex on it FAILS because `$12` doesn't match the `[A-Za-z][A-Za-z0-9&'-]*` second-half anchor. Garbled item survives.
2. **Second half must start with a letter.** `"Dish One $10 2 Piece Chicken"` never splits (`[A-Za-z]` anchor at local.ts:778).
3. **Single-word second half must be food/all-caps** (local.ts:805). `"Dish One $10 Frites"` with `frites` missing from `isFoodRelated` never splits.

### Failure mode 2 — `pendingPrice` leaks onto the wrong dish (`parseColumn`, local.ts:1477-1643)

`pendingPrice` (price-only line captured for price-above-name layouts) is consumed ONLY by no-price lines (local.ts:1628-1643) and title-case headers (local.ts:1530-1542). A **name+price line never clears it** (local.ts:1596-1622 path). Sequence:

```
$10.00          → pendingPrice = 10
Dish One $12    → emits "Dish One" @12; pendingPrice STILL 10
Dish Two        → consumes pendingPrice → "Dish Two" @10  ← WRONG (orphan price jumps a dish)
```

### Failure mode 3 — fused two-column rows (structural, feeds mode 1)

`groupIntoLines` (local.ts:1321-1426) merges all words within 10px Y into one `TextLine`. A two-column menu where both columns have a dish at the same Y (very common) produces `"Dish One $10 Dish Two $12"` as ONE line spanning both columns — `detectColumns` then assigns this full-width line to a single column, embedding the other column's dish into it.

---

## Proposed Approach

| Fix | Location | Change | Scope |
|---|---|---|---|
| **A. Iterative splitter** | `splitMergedDishLine` + `splitMergedItemsFallback` (local.ts:776-834) | Loop each item until no embedded price remains (max 3 iterations); relax second-half anchor to `[A-Za-z0-9]` (allow "2 Piece Chicken"); keep all existing guards | ~25 lines |
| **B. pendingPrice lifecycle** | `parseColumn` name+price path (local.ts:1596-1622) | Clear `pendingPrice` when a dish line carries its own price — an orphan price can't be "this dish's" | ~3 lines |
| **C. Box-level multi-price row split** | `groupIntoLines` segment loop (local.ts:1368-1422) | When a segment has ≥2 standalone price tokens AND isn't a size-variant row, split it at the largest internal gaps into sub-lines (each goes through the existing TextLine construction) | ~40 lines |
| **D. Regression corpus** | `corpus/` + `ground_truth.json` | 3 new synthetic menus pinning modes 1-3; extend `test_batch.ts` expectations | 1 gen script (deleted) + truth entries |

The primary splitter (Ollama refine) is NOT touched — the harness runs with `OLLAMA_REFINE=0`, so the deterministic fallback IS the splitter under test. Fix A makes it behave like a proper splitter; Fix C prevents fused rows from ever reaching the parsers.

---

## Step-by-Step Plan

### Task 1: Write failing unit probes for the splitter

**Objective:** Pin the current splitter's gaps with direct-call probes before touching code.

**Files:**
- Create: `test_splitter.ts` (repo root, gitignored pattern `test_*.ts`)

**Step 1: Write the probe**

```typescript
// test_splitter.ts — run with: PYTHONPATH= npx tsx test_splitter.ts
import { splitMergedDishLine, splitMergedItemsFallback } from "./src/lib/ocr/local";

const cases: [string, number | undefined, string][] = [
  // [input name, trailing price, expected output summary]
  ["ICE MILK 77 BEAN", undefined, "2 items: ICE MILK@77 + BEAN"],        // existing shape B
  ["Dish One $10 Dish Two $12", 12, "2 items: Dish One@10 + Dish Two@12"], // mode 1 basic
  ["Dish One $10 Dish Two $12 Dish Three $14", 14, "3 items"],           // mode 1 gap #1 (iterative)
  ["Dish One $10 2 Piece Chicken", 12, "2 items"],                       // mode 1 gap #2 (digit start)
  ["Spicy Chicken 65", undefined, "NO SPLIT"],                           // guard: numeric dish name
  ["Small $5 / Large $8", 8, "NO SPLIT"],                                // guard: size variants
  ["Chicken $10 Add $2", 2, "NO SPLIT"],                                 // guard: add-on
  ["Pizza $10 Salad", undefined, "2 items"],                             // single-word second (food)
];
// assert + print PASS/FAIL per case; exit 1 on any failure
```

**Step 2: Run and confirm the expected failures**

Run: `PYTHONPATH= npx tsx test_splitter.ts`
Expected: cases 3, 4, 8 FAIL (one-shot splitter / letter-anchor / food-word gaps); cases 5-7 PASS (guards hold).

### Task 2: Make the splitter iterative + relax guards

**Objective:** `splitMergedItemsFallback` fully splits N-dish merged rows; `splitMergedDishLine` accepts digit-start second halves.

**Files:**
- Modify: `src/lib/ocr/local.ts:776-834`

**Step 1: Relax the second-half anchor** (local.ts:778)

```typescript
// was: /^(.*?)\s+([$€£¥]\s*\d+(?:[.,]\d{1,2})?|\d+[.,]\d{1,2}|\d{2,3})\s+([A-Za-z][A-Za-z0-9&'-]*(\s+[A-Za-z][A-Za-z0-9&'-]*)*)$/
// now: allow the second half to start with a digit ("2 Piece Chicken") —
// the mid-price requirement + DISH_PREFIX_WORDS guard already prevent
// "Spicy Chicken 65" style false splits (nothing follows the number there).
/^(.*?)\s+([$€£¥]\s*\d+(?:[.,]\d{1,2})?|\d+[.,]\d{1,2}|\d{2,3})\s+([A-Za-z0-9][A-Za-z0-9&'-]*(\s+[A-Za-z0-9][A-Za-z0-9&'-]*)*)$/
```

**Step 2: Make the fallback iterative** (local.ts:823-834)

```typescript
export function splitMergedItemsFallback(items: LocalOCRItem[]): LocalOCRItem[] {
  const out: LocalOCRItem[] = [];
  for (const item of items) {
    let pending: LocalOCRItem[] = [item];
    for (let depth = 0; depth < 3; depth++) {
      // Split ANY pending item that still contains an embedded price.
      const next: LocalOCRItem[] = [];
      let splitThisRound = false;
      for (const p of pending) {
        const split = p.name ? splitMergedDishLine(p.name, p.price) : null;
        if (split) { next.push(split[0], split[1]); splitThisRound = true; }
        else next.push(p);
      }
      pending = next;
      if (!splitThisRound) break; // stable — no more embedded prices
    }
    out.push(...pending);
  }
  return out;
}
```

**Step 3: Run the probes**

Run: `PYTHONPATH= npx tsx test_splitter.ts`
Expected: cases 3, 4, 8 now PASS; cases 5-7 still PASS (guards intact).

### Task 3: Fix the `pendingPrice` leak

**Objective:** A name+price line consumes-and-clears any pending orphan price, so it can't jump to a later no-price dish.

**Files:**
- Modify: `src/lib/ocr/local.ts` `parseColumn` normal name-extraction path (after the size-variant check at local.ts:1622, before the `!line.hasPrice && pendingPrice` branch at 1628)

**Step 1: Clear pendingPrice when the line has its own price**

```typescript
// A dish line with its OWN price cannot also absorb a pending (orphan)
// price from an earlier price-only line — otherwise the orphan leaks
// onto a LATER no-price dish ("$10 / Dish One $12 / Dish Two" → Dish
// Two wrongly @10). The pending price was either noise or belonged to
// a dish above; either way it is not this dish's.
if (line.hasPrice) {
  pendingPrice = undefined;
}
```

Placement: top of the `for` loop body, right after the price-only capture / `isNoiseLine` skip, BEFORE the `isHeader` block — so priced header-looking lines also clear it. (The `isHeader` branch already sets `pendingPrice = undefined` at local.ts:1544, so this is purely additive for the dish-line paths.)

**Step 2: Verify no behavioral change for legitimate split-price layouts**

The 2-line pattern (local.ts:1654) and price-above-name flow (1628) both still work: those paths have `pendingPrice !== undefined` + `!line.hasPrice`, which this change does not touch.

### Task 4: Box-level multi-price row split in `groupIntoLines`

**Objective:** A Y-row with 2+ standalone price tokens (two-column fusion) splits into per-dish sub-lines BEFORE `detectColumns`/`parseColumn`, preserving bounding boxes and column membership.

**Files:**
- Modify: `src/lib/ocr/local.ts` `groupIntoLines` segment loop (local.ts:1368-1422)

**Step 1: Add the splitter**

```typescript
// Multi-price row split: a Y-row carrying 2+ standalone price tokens is
// two dishes fused from a two-column layout ("Dish One $10  Dish Two
// $12" — only header-like tokens split above). Re-segment the word array
// at the WIDEST internal gaps between price tokens (a column gap), so
// detectColumns sees clean per-column rows. Size-variant rows ("Small $5
// / Large $8") and add-on rows ("Chicken $10 Add $2") are one dish and
// never split: variant rows have a "/" separator between prices, and an
// add-on's price token is preceded by a DISH_PREFIX word.
function splitMultiPriceRow(words: WordPos[], imgWidth: number): WordPos[][] {
  const priceIdx = words
    .map((w, i) => (findPriceInWord(w.text) ? i : -1))
    .filter((i) => i >= 0);
  if (priceIdx.length < 2) return [words];
  const text = words.map((w) => w.text).join(" ");
  if (/(Small|Regular|Single|Large|Double|Medium)\s+[$€£¥]?\s*\d.*\//.test(text)) return [words]; // size variants
  // gap = distance from end of price token to start of next word
  const gaps = priceIdx.slice(0, -1).map((pi, k) => ({
    at: pi,
    px: words[pi + 1].x - (words[pi].x + words[pi].w),
  }));
  const wide = gaps.filter((g) => g.px > Math.max(imgWidth * 0.08, 60));
  if (wide.length === 0) return [words]; // fused single-column row → leave for Fix A
  // split after each wide gap's price token; each side must start with a letter
  const cuts = new Set<number>(wide.map((g) => g.at + 1));
  const segments: WordPos[][] = [];
  let start = 0;
  for (let i = 0; i <= words.length; i++) {
    if (i === words.length || cuts.has(i)) {
      const seg = words.slice(start, i);
      if (seg.length > 0 && /[A-Za-z]/.test(seg[0].text)) segments.push(seg);
      start = i;
    }
  }
  return segments.length >= 2 ? segments : [words];
}
```

**Step 2: Wire into the segment loop**

After the existing header-split produces `segments` (local.ts:1361-1367), map each segment through `splitMultiPriceRow` (flattening the result), then run the existing per-segment TextLine construction on every resulting sub-segment. `priceEndX`, `hasPrice`, `isCentered` etc. are computed per sub-segment exactly as today (local.ts:1378-1421).

**Step 3: Guard against regressions in the existing corpus**

`menu_two_column.png` and `menu_tough_*` must parse identically (the split only fires on rows with 2+ standalone price tokens + a wide gap — ordinary name+price rows have one price token and are untouched).

### Task 5: Regression corpus — 3 new synthetic menus

**Objective:** Pin modes 1-3 so the harness catches any regression.

**Files:**
- Create (temporary): `test_gen_merged.py` (PIL, deleted after use — Pillow is installed per AGENTS.md)
- Create: `corpus/menu_merged_rows.png` — single-column menu whose rows LITERALLY contain two dishes per line ("Burger $10.50  Fries $4.00" style, name-price-name-price), simulating OCR fusion of adjacent rows
- Create: `corpus/menu_two_col_fused.png` — two-column menu with matched Y-rows in both columns (column gap ≥ 100px) so `groupIntoLines` fuses them today
- Create: `corpus/menu_price_leak.png` — `Dish One $12` / stray `$3.50` line / `Dish Two $15` / `Dish Three` (no price): pins Fix B (truth: One@12, Two@15, Three@0)
- Modify: `corpus/ground_truth.json` — add truth entries (category, name, price) for all three

**Step 1: Generate + verify visually** (open each PNG, confirm text is legible — the harness depends on OCR readability, not the generator's intent)

**Step 2: Add truth entries** in the same shape as existing entries (see `menu_double_price.png` entry for format).

### Task 6: Run the full harness + static checks

**Objective:** No regressions on the existing 17-menu corpus (baseline: 135/135 exact match); new menus fully green.

**Step 1: Full harness**

Run: `PYTHONPATH= OLLAMA_REFINE=0 OLLAMA_VISION=0 npx tsx test_batch.ts`
Expected: every existing menu "✅ ALL MATCH" (identical to baseline) + the 3 new menus match their truth. Summary line shows 0 name diffs / 0 price diffs / 0 missing / 0 extra.

If a new menu fails: the failure diff (MISSING / PRICE / EXTRA lines) tells you which fix is incomplete — do NOT weaken the fix; adjust the fix or the truth (only if the truth itself is wrong).

**Step 2: Static checks**

Run: `npm run typecheck` → 0 errors; `npm run lint` → no warnings.

### Task 7: Cleanup + docs

**Objective:** Leave the repo as found, minus the bug.

**Files:**
- Delete: `test_splitter.ts`, `test_gen_merged.py` (gitignored ad-hoc scripts)
- Modify: `AGENTS.md` — update the "Price handling" bullet in OCR internals: note that `splitMergedItemsFallback` is now iterative (handles N-dish fused rows) and that `parseColumn` clears orphan `pendingPrice` on priced lines; bump the corpus count (17 → 20 menus) and the regression total if it changed.

**Step 1:** Delete ad-hoc scripts; **Step 2:** update AGENTS.md; **Step 3:** `git status` — expect only `src/lib/ocr/local.ts`, `AGENTS.md`, `corpus/*` (gitignored) changed.

---

## Verification Summary

| Check | Command | Expected |
|---|---|---|
| Splitter unit probes | `PYTHONPATH= npx tsx test_splitter.ts` | all cases PASS (after Task 2) |
| Full OCR regression | `PYTHONPATH= OLLAMA_REFINE=0 OLLAMA_VISION=0 npx tsx test_batch.ts` | baseline 135/135 + 3 new menus green, 0 diffs |
| TypeScript | `npm run typecheck` | 0 errors |
| Lint | `npm run lint` | no warnings |
| Manual e2e (optional) | dev server → POST a new menu PNG to `/api/scan` | SSE returns clean dish list, no fused names |

## Risks & Tradeoffs

1. **False-positive splits (mode A/C)** — "Chicken 65", "Small $5 / Large $8", "Chicken $10 Add $2", "1/2 lb Burger" must NEVER split. Mitigation: mid-price REQUIRED (nothing after a trailing number), `DISH_PREFIX_WORDS` guard (with/extra/add/serves…), size-variant `/` separator check, wide-gap-only cuts in Fix C, letter-start requirement. The probe cases pin all of these.
2. **Fix C perturbs column geometry** — it only fires on rows with 2+ standalone price tokens + a wide internal gap; the existing `menu_two_column.png` corpus entry is the canary. If it regresses, narrow the gap threshold.
3. **Iteration cap (3)** — prevents pathological loops on adversarial text while covering realistic fusion (2-3 dishes per row). A 4-dish fused row would need a corpus case to justify raising it.
4. **Out of scope (documented, not fixed):** "Dish One Dish Two $12" (two names, NO mid price) — indistinguishable from long descriptive names without a mid-price signal; too risky to split. If the user reports that shape, revisit with a dedicated corpus case.

## Open Questions

- None blocking. If the user's real failing photos are available, add them to `corpus/` as `menu_real_*.png` — real-world fusion beats synthetic.
