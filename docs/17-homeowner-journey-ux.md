# 17 — Homeowner journey UI/UX pass (v0.11)

Review of the v0.10.0 page, the findings behind this pass, what changed, and what was deliberately
left alone. Screenshots in this document were captured from the running app at 320, 390, 768, 1024
and 1440 px with fixture imagery and no 3D credential configured.

Comparison images in [`assets/ui-review`](assets/ui-review) put v0.10.0 (left) next to this build
(right).

## How this was reviewed

`npm run dev`, then a Playwright script driving Chromium at 320, 390, 768, 1024 and 1440 px through:
an empty first visit, a typed U.S. address, "Try an exterior example", steps 2–5, material/tier/
color changes, measurement changes, the Before/After comparison, the example-home and photo tabs,
save → reload → restore, the pre-1978 advisory, an unavailable-imagery error, a lookup failure, and
a WebGL2-less / no-credential path. Every step was screenshotted. The v0.10.0 originals were
re-captured from the merge commit in a separate worktree so the comparisons are like-for-like.

## What the old design actually did

Ordered by how much it cost the homeowner; the effort column is the size of the fix.

### Flow and friction

| Finding | Impact | Effort |
|---|---|---|
| The 3D remodel studio exists only inside step 5, below the itemized estimate, the "how this was calculated" table, the exclusions notice, the save row, the download/print row and the assistant drawer. On a 390 px phone the studio began roughly 2,000 px down the step. | High — the product's best moment is the hardest thing to find | Small |
| Steps 3 and 4 give no cost feedback. The total only appears after "See my estimate". | High — the homeowner answers measurement and material questions blind | Small |
| Step 5 ended at a Back button. "Save", "Download" and "Print" were the only forward actions. | Medium — a dead end for anyone not ready to save | Small |
| The step-2 choices showed no indication of what each scope covers. | Low | Small |

### Discoverability of the 3D features

| Finding | Impact | Effort |
|---|---|---|
| Five different visual things (aerial photo, optional Google 3D, the one-property lidar example, the concept remodel house, the homeowner's photo) appear in different places with no explanation of how they relate or which is "real". | High — the trust story is the product's differentiator | Medium |
| "Now in 3D" was a badge, not a way in; the studio placeholder repeated a second "Show my home in 3D" button that duplicated nothing. | Medium | Small |
| "Download this view" was enabled before any scene existed, so pressing it early did nothing. | Medium — silent failure | Small |

### Estimate comprehension and trust

| Finding | Impact | Effort |
|---|---|---|
| Step 4 asked for a material, a window style, a door style and a quality tier without showing what any of it costs. The example rates only existed inside a collapsed "More options" section. | High | Small |
| "Before" and "After" had no explanation of what they meant or what changes between them. | Medium | Small |
| Additions said "not priced" 250 px below the checkboxes, after the status line, so the caveat was easy to miss at the moment of clicking. | Medium | Small |
| The studio never said in its own heading area that the house is a concept model, not the property. That sentence was the last paragraph in the panel. | High — trust | Small |
| The tier picker asked "Standard / Enhanced / Premium" with no price consequence visible until step 5. | Medium | Small |

### Visual hierarchy and consistency

| Finding | Impact | Effort |
|---|---|---|
| The stepper read "Your home", which truncated to "Your ho…" at 768 px. | Low | Trivial |
| The hero body copy described a budgeting tool and never mentioned the 3D result, so the "wow" was unsignalled. | Medium | Trivial |
| Step 4 was a flat stack of ten controls with identical weight; materials, quality and colour all read as equally important. | Medium | Small |
| The 3D studio column stretched to the height of the estimate column, leaving a large empty area under the controls. | Low | Small |

### Mobile usability

| Finding | Impact | Effort |
|---|---|---|
| At 768 px the hero's two columns squeezed the "Find property" button below the input, and the property preview started 800 px down. | Medium | Small |
| Preset example prices in step 4's selects were clipped at 390 px in a cramped three-column grid. | Medium | Small |
| Colour swatches were 28–31 px across — below the 44 px touch target guidance. | Medium | Small |
| The address input and button stacked at ≤440 px, pushing the preview further down. | Low | Small |

### Accessibility

| Finding | Impact | Effort |
|---|---|---|
| Stepper buttons lost their visible name below 720 px (only the number remained) and had no accessible name giving the step. | Medium | Small |
| The colour picker was a bare `div` with an `aria-label` rather than a labelled group. | Low | Small |
| The colour readout was not a live region, so a screen reader did not announce the change. | Low | Trivial |
| Canvas 3D has no text alternative. The studio's status paragraph partly covers this but not the scene's content. | Medium — partially addressed | Medium |
| Focus, reduced motion and heading order were already correct; nothing to change. | — | — |

### Loading feedback and performance

| Finding | Impact | Effort |
|---|---|---|
| The studio placeholder looked like a finished state, with no progress indication once the lazy Three.js bundle started downloading. | Low | Small |
| Everything else (lazy Three.js, paused rendering off-screen, 25 s imagery deadline, error/retry states) was already solid. | — | — |

## Design direction

Keep the page. It is a four-part conversation — *where is my house → what am I changing → what will
it cost → what will it look like* — and the Alco forest-green/lime system already carries it. The
pass therefore does three things and nothing else:

1. **Move the visual payoff earlier and make it findable.** A running estimate on steps 3 and 4 with
   a "Preview in 3D" control beside it, a jump from the total to the studio, and a studio that
   introduces itself before it shows a house.
2. **Make every visual answer "what am I looking at, and what can it not tell me".** One sentence in
   the studio intro, a "What each property view shows" panel on the property card, and one-line
   Before/After captions.
3. **Answer the price question at the moment it is asked.** Example installed prices under each
   material select, a live range in the same strip, and a next-steps block at the end of the
   estimate instead of a dead end.

No eyebrows were introduced (no uppercase or letter-spaced kickers); every heading stands alone and
context sits in a sentence-case line below or above in body text.

## What changed

| Area | Change |
|---|---|
| `index.html` | "Home" step label; hero copy names the 3D result; "Try an exterior example" is a bordered secondary action; `details` summary "What each property view shows" on the property card; scope tiles gained one-line descriptions and a reassurance line; step 3 gained a live estimate strip and a labelled footprint diagram; step 4 gained a live strip, per-product example prices, a colour explanation and a labelled colour group; step 5 gained a "See your home in 3D" jump, a next-steps block, and a studio intro, one-line Before/After captions, a live before/after sentence and a "Visual only — not priced" legend; the download button starts disabled; footer attribution wording made accurate. |
| `styles.css` | Styles for everything above; tablet hero collapses at 900 px with a tighter copy block; the property photo keeps its 8:5 shape and the card's spare space is trimmed; phone address field stacks; step 4 goes to one column at ≤720 px; swatches are 38 px (44 px on phones); the studio column no longer stretches; a studio progress bar while the runtime loads. |
| `main.js` | `paintChoiceHints()` keeps example prices in step 4 current with the tier and scope; `paintLiveRange()` mirrors the calculated total into steps 3 and 4; `syncRemodelControls()` writes an honest Before/After sentence and controls the download button state; `openStudio()`/`data-open-studio`/`#jump-to-3d` route into the studio from anywhere; studio `onReady`/`onError` callbacks. |
| `wizard.js` | `data-step-link` delegation lets in-page buttons move between steps while the step list stays the single source of navigation; `data-goto` still works on the step buttons. |
| `remodel-3d.js` | Reports readiness and failure so the download control can reflect reality. |
| Tests | New `tests/wizard.test.js` (3 tests) covers step control, delegated in-page links, and the presence of the new hooks plus the no-uppercase rule. Browser QA gained 1 check covering the live range, per-choice prices and the direct studio route (37 app + 10 map + 4 remodel = 51). |

Nothing was removed: the estimate maths, the assistant, photo tooling, saved projects, the map,
the lidar exterior and the Google 3D path are untouched.

## Verification

```
npm run check          # 77 Node tests pass, build writes 38 browser assets
npm run test:python    # 5 tests pass
npm run test:browser   # 37 app + 10 map + 4 remodel checks pass
npm run test:exterior  # 6 checks pass
```

Overflow and clipped-text sweeps were re-run at 320, 360, 390, 560, 768, 921, 1024, 1440, 2560 and
844×390 (landscape), including maximum legal input values: `document.scrollWidth` never exceeds the
viewport and no label, range, price or heading overflows its box.

## Remaining limitations

- The 3D studio still appears only on step 5. A dedicated preview step, or an inline 3D card on
  step 3, would need the lazy Three.js runtime to load earlier; that is a deliberate follow-up, not
  a CSS change.
- Porch, dormer and shutter additions remain visual only and are still unpriced.
- The concept house is sized from typed measurements; it is not the property's real footprint.
  Google tiles remain display-only and are never traced or measured.
- The canvas scene has no full text equivalent beyond the size/materials status line.
- Preset example prices in step 4 are illustrative catalogue values, not Alco's price book.
