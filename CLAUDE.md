# CurbQuote: working notes for Claude

## Design rules (from the product owner)

- **No eyebrows.** Never put small uppercase, letter-spaced labels (kickers or overlines) above
  headings, in any redesign or new UI. A heading stands on its own; if extra context is needed,
  use a normal sentence-case line below it.
- The 3D view is the preferred way to show a property; the top-down aerial photo is the fallback.

## Conventions

- Plain browser modules and Node 22, no framework or bundler. Match the existing compact style.
- Never commit, paste or log keys and tokens. Setup and every service are in `docs/SETUP.md`.
- The security headers in `lib/web.mjs` and `vercel.json` must stay identical (a test checks this).
  Don't add `unsafe-eval` or `unsafe-inline` to the CSP; allow a specific inline style by hash.
- Browser code must also work in the static GitHub Pages build (`config.js` `STATIC_SITE`): use relative URLs, and
  give anything that calls `api/` a static fallback.
- Before pushing, run `npm run check` (111 Node tests) and, for UI changes, `npm run test:browser` (62 checks) plus `npm run test:exterior` (9 checks).
