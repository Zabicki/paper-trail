# Category Icons Replace Colors — Plan Brief

> Full plan: `context/changes/category-icons/plan.md`

## What & Why

A color swatch identifies a category only after you have memorised the mapping; an icon is self-describing at a glance. This is roadmap **S-09** (FR-018): a category gains a user-chosen icon, the per-category color leaves the UI entirely, and the reports charts derive their own fills instead of reading a stored hex. Riding along is a de-texting pass the user asked for — the dashboard's per-row `Edytuj` / `Usuń` labels become a pen and a trash can.

## Starting Point

A category's marker is a colored dot from a 12-hex palette, stored in `categories.color`, validated by a database CHECK, a zod enum and a TypeScript union, and rendered at eight sites in five different sizes and two shapes. `src/components/reports/distribution.ts` is the heavy consumer: roughly 200 of its 250 lines are HSL lightness-shift machinery that exists *only* because 12 fixed hexes with no uniqueness rule guarantee two categories will share one. On the button side, `button.tsx` has a `size="icon"` token at 36px — below the 44px tap target the rest of the codebase enforces, and already violated by `MonthCalendar`.

## Desired End State

The user picks an icon from a grouped, Polish-searchable grid in the category dialog, and that glyph identifies the category in the entry picker, the day list, the receipt review rows, the manager list, and the reports ranking and tooltips. No color swatch appears anywhere. Charts still color their arcs — from a value derived per category, stable across every range and reload. The day list and manager show a pen and a trash can, with a spinner while a delete is in flight.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Fate of `color` | Retire from the UI; charts derive their own | FR-018 says the icon supersedes the color as the marker, and removing user choice removes the collisions that justify `distribution.ts`'s shift math. |
| Icon set | Curated, 100+ names, named lucide imports | The user expects 50+ categories, so ~40 would force settling; named imports keep it tree-shaken where a searchable full catalogue would not. |
| Validation | `z.enum` only, no DB CHECK | One source of truth in `types.ts`; a 100-value CHECK plus a 100-value TS enum would drift, and adding an icon would need a migration. |
| Backfill | Name-matched mapping in the migration | The demo account and typical Polish category names look right on first load rather than showing 32 identical tags. |
| Deploy sequencing | Two changes — add and use now, drop later | CI applies migrations before `wrangler deploy`, so the previous Worker must never select a column that is already gone. |
| Chart color source | Derived from `categoryId` | A category keeps the same color across every range — the one property the stored hex actually bought — while the duplicate pre-pass disappears. |
| Collision resolution | Walk sorted by `categoryId`, not by total | Sorting by total would recolour the donut whenever the range or the recurring toggle changes. |
| Icon reach | Entry surfaces **and** chart swatches | The icon carries identity, the tint carries arc linkage; the ranking row's existing `leading` slot is the seam. |
| Picker UX | Grouped grid + Polish keyword filter | Browsable when the user is unsure, fast when they are not; English lucide names are unsearchable for the actual audience. |
| Icon button size | New `size="icon-touch"` at 44px | Makes the tap-target rule expressible instead of patched per call site; leaves `MonthCalendar` untouched. |
| Accessible naming | `aria-label` only, no tooltip | Matches the existing `MonthCalendar` / `PasswordToggle` convention; the repo adds UI primitives deliberately, not casually. |
| Delete safety | Keep `window.confirm`, spin the glyph | Preserves both signals the text gave — the warning and the in-flight state — with no new state machine. |

## Scope

**In scope:** `icon` column + name-matched backfill; `entries_category_summary` recreated to return `category_icon`; icon names in `types.ts` and the lucide catalogue in a UI-side module; three services; the icon picker replacing `ColorSwatchPicker`; all four entry-side render sites; `distribution.ts` deriving fills from `categoryId`; glyphs in the ranking rows and both chart tooltips; a 44px icon-button token and five button conversions; two extended pgTAP files.

**Out of scope:** dropping `categories.color`, its CHECK, the palette exports, `category_color`, or the colour pgTAP assertions — all belong to the follow-up change; glyphs on the donut arcs; `MonthCalendar`'s `‹`/`›`; a tooltip primitive; replacing `window.confirm`; a DB CHECK on `icon`; a test framework; S-10.

## Architecture / Approach

`src/types.ts` holds the icon **names** and stays lucide-free, because services and API routes import it and must not drag ~100 React components server-side. The lucide component map, the eight Polish groups and the per-icon keywords live in `src/components/categories/icon-catalogue.ts`, co-located with the feature the way `distribution.ts` and `date-utils.ts` already are. A single `CategoryIcon` component turns a stored name into a glyph and falls back to `tag` for anything unrecognised, so a stale name degrades instead of crashing a render.

On the reports side the model inverts: instead of the database handing down a colour, `distribution.ts` computes one — base hex `CATEGORY_COLORS[id % 12]`, shade tier `floor(id / 12) % 3`, de-collided by walking the category list sorted by id. Thirty-six distinct values, invariant to range and to the recurring toggle. The band precondition documented at `distribution.ts:48-53` still binds and is carried forward.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Icon-only row actions | Pen and trash in the day list, manager and receipt review; 44px icon-button token | `jsx-a11y` is wired for `.astro` only, so a missing `aria-label` on a `.tsx` button will not fail lint — manual check is the only guard |
| 2. Icons end to end | Column, backfill, function recreate, catalogue, picker, all four entry surfaces | The function needs drop + recreate for its `returns table` change, and `c.icon` must be added to **both** grouping sets or the aggregate silently breaks |
| 3. Derived chart colors + glyphs in reports | `distribution.ts` derives fills from `categoryId`; glyphs in ranking and both tooltips | Colour stability across ranges is the property most likely to regress, and nothing automated can catch it |

**Prerequisites:** S-05 and S-07, both done and archived. S-08 landed at `6f700be`, so the working tree is clean apart from the roadmap flip. No new dependency — `lucide-react@^1.14.0` is installed and all 134 candidate names resolve against it. Run `npm ci` before any `npx supabase` command.

**Estimated effort:** ~3 sessions, one per phase, each ending in a manual browser pass. Phase 2 is the largest by some margin.

## Open Risks & Assumptions

- **The follow-up change must actually happen.** Until `category-color-drop` lands, production carries a dead column, a stale CHECK, an unread function field and two pgTAP assertions for behaviour nothing uses. The plan's Migration Notes enumerate every one of them.
- **The backfill is a one-shot convenience, not a feature.** A hardcoded Polish-name → icon table is unmaintainable and silently wrong for anyone whose "Dom" means something else; unmatched names fall back to `tag`, and the migration header says so.
- **Icon-name validity becomes app-layer-only.** With no DB CHECK, `z.enum` is the sole guard — a permanent manual re-verification requirement per `lessons.md`, and the third such invariant on this table alongside soft-delete visibility and `kind` immutability.
- **Bundle size is estimated, not measured.** ~100 named lucide imports should add tens of KB tree-shaken; the plan verifies the real delta against the pre-change build rather than assuming it.
- **Three tiers × 12 hues = 36 values against a target of 50+ categories.** Only eight are ever visible at once, and the de-collision walk covers the rest — but two categories 36 ids apart start from the same value.
- **No test framework**, so every behavioural claim in this change is verified by hand.

## Success Criteria (Summary)

- A user recognises a category by its own icon in the entry picker, the day list, the receipt review, the category manager and the reports ranking — and never sees a color swatch to pick.
- Switching range or toggling the recurring filter leaves every category's chart colour unchanged, and the donut's eight visible slices stay distinct at 30+ categories.
- The dashboard's row actions read as a pen and a trash can, each at least 44px, each announcing a Polish name, with the delete still guarded and still visibly in flight.
