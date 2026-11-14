/**
 * A made-up company, to show what a skin holds and to prove the app is not tied to one brand. Nothing
 * here is real: copy this folder to start a new skin, then change every value (docs/26-skins.md).
 * Preview it with `SKIN=example npm run dev`.
 */
export default Object.freeze({
  id: 'example',
  company: {
    name: 'Example Exteriors',
    short: 'Example',
    legalName: 'Example Exteriors Co.',
    website: 'https://www.example.com',
    terms: 'https://www.example.com/terms',
    privacy: 'https://www.example.com/privacy',
    trust: 'Locally owned · Two-year workmanship warranty',
    trustSentence: 'Locally owned, with a two-year workmanship warranty.'
  },
  app: {
    name: 'Example Exterior Studio',
    shortName: 'Exterior Studio',
    title: 'Example Exteriors — Know the scope before the quote'
  },
  // A wide wordmark with no tagline: nothing is cut off on phones and no light sweeps along it.
  logo: { src: 'logo.svg', onDark: 'logo-white.svg', width: 360, height: 80 },
  // Three colours are enough: every other shade is worked out from them.
  colors: { dark: '#14213d', primary: '#1d4e89', accent: '#f6a821' },
  fonts: { accent: "Georgia, 'Times New Roman', serif" },
  offices: [
    { name: 'Springfield office', phone: '(217) 555-0143', tel: '2175550143', address: '100 Example Street, Springfield, IL 62701' }
  ],
  serviceArea: {
    description: 'Springfield and the towns around it',
    region: 'the Springfield area',
    communities: { IL: ['Springfield', 'Chatham', 'Rochester', 'Sherman'] },
    nearbyZip3: { IL: ['625', '626', '627'] }
  },
  catalog: {
    version: 'example-2026-11-v1',
    products: {
      siding: { fiber: { name: 'Example fiber cement', rates: [9, 18] }, vinyl: { name: 'Example vinyl siding', rates: [6, 12] } },
      windows: { fiberglass: { name: 'Example fiberglass', rates: [800, 1600] }, wood: { name: 'Example wood-clad', rates: [950, 2000] }, vinyl: { name: 'Example vinyl', rates: [450, 1100] } },
      doors: { fiberglass: { name: 'Example fiberglass door', rates: [1600, 3800] }, steel: { name: 'Example steel door', rates: [1100, 2700] }, wood: { name: 'Example wood door', rates: [2200, 5500] } },
      roofing: { architectural: { name: 'Example architectural shingles', short: 'Example shingles', rates: [500, 850] } },
      gutters: { seamless: { name: 'Seamless gutters', rates: [12, 24] } }
    }
  }
});
