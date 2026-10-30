# 24 — Alco Products: real product lines, service area and offices

The app now uses what Alco Products actually sells and where it works, taken from
alcoproductsinc.com in October 2026 (the `.io` address is an unfinished preview of a new site).
Prices are still authored examples, not Alco's price book.

## Products

The catalog keeps its internal ids, so saved projects and the planner keep working; only the names
and the line-up changed. The defaults are the first line in each list.

| Trade | Lines, default first | Example installed rate |
|---|---|---|
| Siding | James Hardie fiber cement, CertainTeed vinyl siding | $10–$20, $7–$14 per sq ft |
| Windows | Marvin fiberglass, Marvin wood-clad, Vytex vinyl | $900–$1,800, $1,000–$2,200, $500–$1,300 each |
| Doors | ProVia fiberglass door, ProVia steel door, Marvin wood door | $1,800–$4,200, $1,200–$3,000, $2,500–$6,000 each |

- **Engineered wood is gone.** Alco doesn't install it. A project saved with it reopens as James
  Hardie fiber cement.
- **The typical-home range rose** from $19,020–$53,453 to $28,372–$75,933, because the defaults moved
  from vinyl siding, vinyl windows and a steel door to Alco's premium lines. Choosing CertainTeed
  vinyl, Vytex vinyl and ProVia steel gives the old figure.

## Service area and offices

`alco.js` holds the offices, the communities named on Alco's service-area page and the check:

- **Served:** all of Washington, DC, and the listed Maryland and Northern Virginia communities. The
  note says so, with the nearer office's number.
- **Call to confirm:** another Maryland or Virginia ZIP around DC (for example Laurel, MD).
- **Outside:** anywhere else. The note says the address looks outside the area, and that the
  homeowner can still explore an estimate and call to check.

The note sits under the address, and stays visible once the address bar docks at the top. It never
blocks the estimate. The Austin example home gets no note.

Every "Call Alco Products" link and the Send to Alco dialog use the Tysons Corner number,
(703) 534-3349, for Virginia addresses, and the North Bethesda number, (301) 593-1691, otherwise.

## Trust line, website and consent

- **Trust line.** "Family-owned since 1956 · Limited lifetime labor warranty" appears in the Send to
  Alco dialog, and on Step 5 beside the call link.
- **Website.** The account menu links to alcoproductsinc.com.
- **Consent.** The consent box uses wording modelled on Alco's own form: contact about the estimate by
  email, and by calls or texts to the phone given, including by autodialer. It also links Alco's Terms
  and Privacy Policy. Have counsel confirm it before launch.

Promotions and financing rates are left out on purpose: offers change often, and quoting loan terms
can trigger lending-disclosure rules.

## Verification

- **`npm run check`:** 122 Node tests and the build pass. `tests/alco.test.js` covers address parsing
  in Census and Google formats, the three service statuses and office routing.
- **`npm run test:browser`:** the browser suite now also checks the DC note, its "served" status and
  the call links.
