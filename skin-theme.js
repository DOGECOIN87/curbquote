/**
 * Turns a skin's three brand colours into every colour the app uses. A skin names `dark` (header and
 * rail), `primary` (buttons and links) and `accent` (highlights); the shades below are worked out from
 * them, and `colors.tokens` can pin any shade exactly. Runs in the browser and in Node, so the page,
 * the stylesheet and the checks all read the same values.
 */
const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export const isHex = value => typeof value === 'string' && HEX.test(value);
export const parseHex = hex => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
export const toHex = rgb => `#${rgb.map(channel => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
/** `from` moved `share` of the way to `to`. */
export const mix = (from, to, share) => { const a = parseHex(from), b = parseHex(to); return toHex(a.map((channel, i) => channel + (b[i] - channel) * share)); };

function toHsl(hex) {
  const [r, g, b] = parseHex(hex).map(channel => channel / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, d / (1 - Math.abs(2 * l - 1)), l];
}
function fromHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return toHex([r, g, b].map(channel => (channel + m) * 255));
}
/** The same hue at another lightness (0 black, 1 white). */
export const shade = (hex, lightness) => { const [h, s] = toHsl(hex); return fromHsl(h, s, clamp(lightness)); };
const lighter = (hex, by) => { const [h, s, l] = toHsl(hex); return fromHsl(h, s, clamp(l + by)); };

/** WCAG relative luminance and contrast ratio (1 to 21). */
export function luminance(hex) {
  const [r, g, b] = parseHex(hex).map(channel => { const v = channel / 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  return .2126 * r + .7152 * g + .0722 * b;
}
export const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + .05) / (lo + .05); };
const readableOn = (background, dark) => contrast('#ffffff', background) >= contrast(dark, background) ? '#ffffff' : dark;

/** Every brand colour token, as CSS custom property names and hex values. */
export function themeTokens(skin) {
  const { dark, primary, accent, tokens = {} } = skin.colors;
  const brightAccent = lighter(accent, .05), wash = mix(mix(accent, primary, .5), '#ffffff', .88);
  return {
    '--brand-900': shade(primary, .07), '--brand-800': shade(primary, .13), '--brand-700': shade(primary, .23), '--brand-600': shade(primary, .31), '--brand-500': shade(primary, .41),
    '--lime': accent, '--lime-600': lighter(accent, -.06), '--lime-100': mix(accent, '#ffffff', .86), '--lime-50': mix(accent, '#ffffff', .93),
    '--success': primary, '--brand-muted': mix(shade(primary, .38), '#808080', .4),
    '--forest': dark, '--forest-ink': lighter(dark, .04),
    '--studio-green': primary, '--studio-green-hover': lighter(primary, -.04), '--studio-link': primary, '--studio-hotspot': shade(primary, .39),
    '--studio-lime': brightAccent, '--studio-lime-line': accent,
    '--studio-pale': wash, '--studio-pale-2': mix(mix(accent, primary, .5), '#ffffff', .78),
    // Text that sits on the button colour and on the highlight colour.
    '--on-primary': readableOn(primary, dark), '--on-accent': readableOn(brightAccent, dark),
    // Pale tints of the highlight on white, and readable tints of it on the dark surfaces.
    '--accent-wash': mix(accent, '#ffffff', .8), '--accent-line': mix(accent, '#ffffff', .7), '--accent-glint': mix(accent, '#ffffff', .6),
    '--on-dark-accent': mix(accent, '#ffffff', .5), '--on-dark-success': mix(accent, '#ffffff', .45), '--on-dark-soft': mix(accent, '#ffffff', .72),
    ...tokens
  };
}

/** "137,198,63" for `rgba(var(--lime-rgb),.5)`: every token gets one, so any shade can be made see-through. */
export const rgbList = hex => parseHex(hex).join(',');

// Text and background pairs that must stay readable (WCAG AA: 4.5 for text, 3 for large text and controls).
const PAIRS = Object.freeze([
  ['--on-primary', '--studio-green', 4.5, 'button text on the primary colour'],
  ['--on-primary', '--studio-green-hover', 4.5, 'button text on the pressed primary colour'],
  ['--on-accent', '--studio-lime', 4.5, 'text on the accent colour'],
  ['#f3f6f2', '--forest', 7, 'light text on the dark colour'],
  ['#f3f6f2', '--forest-ink', 7, 'light text on the dark colour'],
  ['--studio-green', '#ffffff', 4.5, 'primary-coloured text on white'],
  ['--studio-link', '#ffffff', 4.5, 'links on white'],
  ['--brand-600', '#ffffff', 4.5, 'links on white'],
  ['--brand-900', '--lime-100', 7, 'dark text on the pale accent'],
  ['--on-dark-accent', '--forest', 4.5, 'accent-tinted text on the dark colour'],
  ['--on-dark-success', '--forest', 4.5, 'accent-tinted text on the dark colour'],
  ['--studio-lime', '--forest', 3, 'the accent colour on the dark colour']
]);
/** Colour problems in a skin, as plain sentences; empty when every pair is readable. */
export function colorProblems(skin) {
  const { dark, primary, accent, tokens = {} } = skin.colors ?? {}, problems = [];
  for (const [name, value] of Object.entries({ dark, primary, accent, ...tokens })) if (!isHex(value)) problems.push(`colors: "${name}" must be a six-digit hex colour like #13241c.`);
  if (problems.length) return problems;
  const theme = themeTokens(skin), value = name => name.startsWith('--') ? theme[name] : name;
  for (const [text, background, minimum, what] of PAIRS) {
    const ratio = contrast(value(text), value(background));
    if (ratio < minimum) problems.push(`colors: ${what} is hard to read (${text} ${value(text)} on ${background} ${value(background)}: contrast ${ratio.toFixed(1)}, needs ${minimum}).`);
  }
  return problems;
}
