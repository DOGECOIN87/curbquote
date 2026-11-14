/**
 * Alco Products' skin: everything that makes the estimator Alco's. The names, offices, service area and
 * product lines are from alcoproductsinc.com (October 2026). To rebrand the app, copy this folder,
 * change the values and the logo files, and point `brand.js` at the copy: docs/26-skins.md.
 */
export default Object.freeze({
  id: 'alco',
  company: {
    name: 'Alco Products',
    short: 'Alco',
    legalName: 'Alco Products Company, Inc.',
    website: 'https://www.alcoproductsinc.com',
    terms: 'https://www.alcoproductsinc.com/terms',
    privacy: 'https://www.alcoproductsinc.com/privacy-policy',
    trust: 'Family-owned since 1956 · Limited lifetime labor warranty',
    trustSentence: 'Family-owned since 1956, with a limited lifetime labor warranty.'
  },
  app: {
    name: 'Alco Exterior Studio',
    shortName: 'Exterior Studio',
    title: 'CurbQuote by Alco Products — Know the scope before the quote'
  },
  // Files in this folder. `compactCrop` is the share of the logo's height that phones show (Alco's
  // tagline is cut off there); `shine` is the shape the light sweeps along, here the lime swoosh.
  logo: { src: 'logo.png', webp: 'logo.webp', onDark: 'logo-white.png', width: 300, height: 176, compactCrop: .8, shine: 'polygon(0 66%,76% 54.6%,0 81.2%)' },
  colors: {
    dark: '#13241c',      // Header, rail and other dark surfaces.
    primary: '#2f6621',   // Buttons and links.
    accent: '#89c63f',    // Highlights.
    // Alco's exact shades. Without these, each one is worked out from the three colours above.
    tokens: {
      '--brand-900': '#102303', '--brand-800': '#1a3410', '--brand-700': '#2b5a1c', '--brand-600': '#3d7a26', '--brand-500': '#5b9a37',
      '--lime-600': '#78b231', '--lime-100': '#eef6e4', '--lime-50': '#f6faf1', '--success': '#2f6b22', '--brand-muted': '#5b7d47',
      '--forest-ink': '#1b3024', '--studio-green-hover': '#27571b', '--studio-link': '#2f6a1f', '--studio-hotspot': '#4f9a2e',
      '--studio-lime': '#8fcd4f', '--studio-lime-line': '#7fbd4a', '--studio-pale': '#edf3e7', '--studio-pale-2': '#dfe9d3',
      '--accent-wash': '#e9f5df', '--accent-line': '#d9eac6', '--accent-glint': '#ecffbe',
      '--on-dark-accent': '#c4e6a6', '--on-dark-success': '#b6f09c', '--on-dark-soft': '#d9ead0'
    }
  },
  // The first office answers when an address has no office of its own.
  offices: [
    { name: 'North Bethesda showroom', phone: '(301) 593-1691', tel: '3015931691', address: '4921 Wyaconda Road, North Bethesda, MD 20852' },
    { name: 'Tysons Corner office', phone: '(703) 534-3349', tel: '7035343349', address: '1750 Tysons Blvd, Ste 1500, Tysons Corner, VA 22102', states: ['VA'] }
  ],
  serviceArea: {
    description: 'Washington, DC, the Maryland suburbs and Northern Virginia',
    region: 'the DC area',
    // Served everywhere, and how the note names the place.
    states: { DC: 'Washington, DC' },
    // Communities named on alcoproductsinc.com/service-areas.
    communities: {
      MD: ['Adelphi', 'Annapolis', 'Ashton', 'Bethesda', 'Burtonsville', 'Chevy Chase', 'Columbia', 'Ellicott City', 'Fort Washington', 'Gaithersburg', 'Germantown', 'Hyattsville', 'Kensington', 'North Bethesda', 'Olney', 'Potomac', 'Rockville', 'Silver Spring', 'Wheaton'],
      VA: ['Alexandria', 'Annandale', 'Arlington', 'Burke', 'Centreville', 'Dunn Loring', 'Fairfax', 'Falls Church', 'McLean', 'Oakton', 'Reston', 'Tysons', 'Tysons Corner', 'Vienna']
    },
    // ZIP prefixes around those communities: "call to confirm" when the town isn't listed.
    nearbyZip3: { MD: ['206', '207', '208', '209', '210', '211', '212', '214'], VA: ['201', '220', '221', '222', '223'] }
  },
  // The lines Alco installs; the first choice of each trade is its default. `short` is used where room is tight.
  // Names read as "new <window name> windows" and "a new <door name>" in the photo concept, so window names
  // leave out "windows" and door names end in "door". The rates are authored examples, never Alco's prices: they
  // stay labelled illustrative until Alco's price book replaces them. Roofing and gutter rates are from
  // DC-metro cost guides (October 2026): architectural shingles with one layer torn off, per roofing
  // square; seamless gutters with downspouts, per foot. Sources: docs/02-estimation.md.
  catalog: {
    version: 'alco-products-2026-10-v2',
    products: {
      siding: { fiber: { name: 'James Hardie fiber cement', short: 'James Hardie siding', rates: [10, 20] }, vinyl: { name: 'CertainTeed vinyl siding', rates: [7, 14] } },
      windows: { fiberglass: { name: 'Marvin fiberglass', rates: [900, 1800] }, wood: { name: 'Marvin wood-clad', rates: [1000, 2200] }, vinyl: { name: 'Vytex vinyl', rates: [500, 1300] } },
      doors: { fiberglass: { name: 'ProVia fiberglass door', rates: [1800, 4200] }, steel: { name: 'ProVia steel door', rates: [1200, 3000] }, wood: { name: 'Marvin wood door', rates: [2500, 6000] } },
      roofing: { architectural: { name: 'CertainTeed architectural shingles', short: 'CertainTeed shingles', rates: [550, 900] } },
      gutters: { seamless: { name: 'Seamless gutters', rates: [14, 26] } }
    }
  }
});
