# 25 — Every device shape: a denser phone scale and a layout sweep

Phones felt oversized, and a few edge-case screens broke. This pass makes phones denser and adds a
sweep that checks every step on 27 device shapes, so a layout change can't quietly break one.

## Phones (under 600 px wide)

| Part | Before | After |
|---|---|---|
| Header | 106 px | 94 px, with a smaller logo, name and step dots |
| Price and Continue | 148 px, in two rows on tall phones | 64 px, one row; the price wraps rather than being cut off |
| 3D controls | Two rows on Steps 3–4 | One row: zoom buttons hidden (pinch zooms), Rotate label hidden on Steps 3–4 (drag turns) |
| Floating pills, headings, swatches | 52 px pills, 23 px headings, 50 px swatches | 48 px, 20 px, 44 px |
| Step 1 | 34 px headline, 166 px address panel | 30 px headline, slimmer address bar |
| Step 5 and project sheet | 22 px card padding, 110 px price lines | Tighter cards and lines |

Every target stays at least 44 px, the minimum comfortable size for a finger.

**Under 340 px (fold cover screens):**
- the price and Continue stack again;
- the header shows only the step dots;
- the address label keeps its words whole;
- the typical-home card puts its button underneath.

**Hotspot rings** now hide when they would land under the 3D view / Photo toggle, the control pills or
the "Concept model" badge. That happened in small views, such as a phone on its side.

## The sweep: `npm run test:layouts`

`qa/layout-browser.mjs` checks seven views at every shape: Steps 1–5, the phone project sheet and the
Saved projects dialog. The 27 shapes:

- **Phones:** 280 px and 344 px fold cover screens; small, compact, tall and large phones up to 430 × 932.
- **Phones on their side:** four landscape phones.
- **Larger screens:** unfolded folds, a square window, tablets in both orientations, short and regular
  laptops, Full HD, and ultrawide monitors up to 3440 × 1440.

**What it checks:**
- **No sideways scrolling.**
- **No control runs off the screen.**
- **Nothing is covered.** Every visible control must be tappable: anything on top of it fails, unless
  scrolling brings the control out, as it does for content passing under the sticky price bar.
- **The main action can be reached.** Continue, See my estimate or Send to Alco can be scrolled fully
  into view and pressed.
- **The house keeps room.** On Steps 2–4, the 3D view must get at least 150 px and 22% of the screen.

`--report` lists problems instead of failing. Screenshots of every view go to `qa-output/layouts/`. A
full run takes about half an hour with software rendering.

### What the first sweep found and fixed

- **Phone header:** the back arrow sat 2 px off the left edge, on every step, after the compact padding.
- **Small phone on its side, Steps 3–4:** the Before / Split / After pill ran off the narrow house
  panel. Controls wrap there now.
- **Small phone on its side, Step 4:** the door hotspot sat under the reset button.
