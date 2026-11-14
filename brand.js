/**
 * The skin in use: the company's name, logo, colours, offices, service area and product lines.
 * To rebrand the app, point the import below at another folder in `skins/` (docs/26-skins.md).
 */
import skin from './skins/alco/skin.js';
import { themeTokens } from './skin-theme.js';

export const BRAND = skin;
/** Every brand colour, by CSS custom property name, for drawing on canvases and maps. */
export const THEME = Object.freeze(themeTokens(skin));
/** A name as an owner: "Acme's", "Acme Homes'". */
export const possessive = name => `${name}${/s$/i.test(name) ? "'" : "'s"}`;
