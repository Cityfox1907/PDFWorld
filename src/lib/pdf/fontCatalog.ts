import type { BaseFamily, FontFamilyKey } from './types';
import { compactFontName, prettyFontName, isGenericFontLabel, isInternalFontName, classifyFont } from './fonts';
import { embeddedFontFamily } from './embeddedFonts';

/**
 * Curated catalogue of the ~90 most-used document fonts.
 *
 * Each web entry is backed by an @fontsource package (served from the jsDelivr
 * CDN), which gives us two things from one stable, versionless URL scheme:
 *   • on-screen preview — injected @font-face rules render every option (and the
 *     edited text) in its real typeface, lazily downloading a file only when used.
 *   • lossless export — the bake layer fetches the exact same .woff2 and embeds
 *     it (subsetted) via fontkit, so the PDF matches the editor pixel for pixel.
 *
 * Everything degrades gracefully: if the CDN is unreachable the preview falls
 * back to the metric-compatible system stack and the export falls back to the
 * matching PDF standard font (Helvetica / Times / Courier). Export never breaks.
 */
export interface FontDef {
  /** stable id, stored on elements; also the @fontsource package id for web fonts */
  key: string;
  /** display name; doubles as the CSS font-family of the injected @font-face */
  label: string;
  /** metric family used for the standard-font fallback on screen and on export */
  base: BaseFamily;
  /** which section of the picker the font belongs to */
  group: 'system' | 'standard' | 'web';
  /** explicit CSS font-family stack (system fonts that render with the real OS face) */
  css?: string;
  /** present for real web fonts; absent for system + standard families */
  web?: {
    /** weights actually published by the @fontsource package */
    weights: number[];
    /** whether the package ships italic faces */
    italic: boolean;
  };
}

const SYS_SANS = 'Helvetica, Arial, "Liberation Sans", system-ui, sans-serif';
const SYS_SERIF = '"Times New Roman", Times, "Liberation Serif", Georgia, serif';
const SYS_MONO = '"Courier New", "Liberation Mono", ui-monospace, monospace';

function sysStack(base: BaseFamily): string {
  return base === 'serif' ? SYS_SERIF : base === 'mono' ? SYS_MONO : SYS_SANS;
}

const W = (weights: number[], italic = true) => ({ weights, italic });

/**
 * Common operating-system fonts. They render on screen with the user's *real*
 * installed face (so the name previews exactly as it looks) and export via the
 * metric-compatible PDF standard font. Arial is the editor default. These also
 * give the scan editor familiar, document-typical names to fall back to.
 */
const SYSTEM: FontDef[] = [
  { key: 'arial', label: 'Arial', base: 'sans', group: 'system', css: 'Arial, "Liberation Sans", "Helvetica Neue", Helvetica, sans-serif' },
  { key: 'helvetica', label: 'Helvetica', base: 'sans', group: 'system', css: '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif' },
  { key: 'verdana', label: 'Verdana', base: 'sans', group: 'system', css: 'Verdana, Geneva, "DejaVu Sans", sans-serif' },
  { key: 'tahoma', label: 'Tahoma', base: 'sans', group: 'system', css: 'Tahoma, Geneva, "DejaVu Sans", sans-serif' },
  { key: 'trebuchet', label: 'Trebuchet MS', base: 'sans', group: 'system', css: '"Trebuchet MS", "Lucida Grande", sans-serif' },
  { key: 'calibri', label: 'Calibri', base: 'sans', group: 'system', css: 'Calibri, Carlito, "Segoe UI", sans-serif' },
  { key: 'segoe-ui', label: 'Segoe UI', base: 'sans', group: 'system', css: '"Segoe UI", Calibri, "Helvetica Neue", sans-serif' },
  { key: 'times-new-roman', label: 'Times New Roman', base: 'serif', group: 'system', css: '"Times New Roman", "Liberation Serif", Times, serif' },
  { key: 'georgia', label: 'Georgia', base: 'serif', group: 'system', css: 'Georgia, "Times New Roman", serif' },
  { key: 'cambria', label: 'Cambria', base: 'serif', group: 'system', css: 'Cambria, "Caladea", Georgia, serif' },
  { key: 'garamond', label: 'Garamond', base: 'serif', group: 'system', css: 'Garamond, "EB Garamond", "Times New Roman", serif' },
  { key: 'courier-new', label: 'Courier New', base: 'mono', group: 'system', css: '"Courier New", "Liberation Mono", Courier, monospace' },
  { key: 'consolas', label: 'Consolas', base: 'mono', group: 'system', css: 'Consolas, "DejaVu Sans Mono", "Courier New", monospace' },
];

/** The three built-in standard families render with zero network cost. */
const STANDARD: FontDef[] = [
  { key: 'sans', label: 'Sans (Helvetica)', base: 'sans', group: 'standard' },
  { key: 'serif', label: 'Serif (Times)', base: 'serif', group: 'standard' },
  { key: 'mono', label: 'Mono (Courier)', base: 'mono', group: 'standard' },
];

/** 87 popular web fonts. `key` === @fontsource package id. */
const WEB: Omit<FontDef, 'group'>[] = [
  // ── sans ──
  { key: 'inter', label: 'Inter', base: 'sans', web: W([400, 500, 700]) },
  { key: 'roboto', label: 'Roboto', base: 'sans', web: W([400, 500, 700]) },
  { key: 'open-sans', label: 'Open Sans', base: 'sans', web: W([400, 600, 700]) },
  { key: 'lato', label: 'Lato', base: 'sans', web: W([400, 700]) },
  { key: 'montserrat', label: 'Montserrat', base: 'sans', web: W([400, 600, 700]) },
  { key: 'poppins', label: 'Poppins', base: 'sans', web: W([400, 500, 700]) },
  { key: 'raleway', label: 'Raleway', base: 'sans', web: W([400, 600, 700]) },
  { key: 'nunito', label: 'Nunito', base: 'sans', web: W([400, 600, 700]) },
  { key: 'nunito-sans', label: 'Nunito Sans', base: 'sans', web: W([400, 600, 700]) },
  { key: 'work-sans', label: 'Work Sans', base: 'sans', web: W([400, 500, 700]) },
  { key: 'rubik', label: 'Rubik', base: 'sans', web: W([400, 500, 700]) },
  { key: 'noto-sans', label: 'Noto Sans', base: 'sans', web: W([400, 700]) },
  { key: 'ubuntu', label: 'Ubuntu', base: 'sans', web: W([400, 500, 700]) },
  { key: 'source-sans-3', label: 'Source Sans 3', base: 'sans', web: W([400, 600, 700]) },
  { key: 'dm-sans', label: 'DM Sans', base: 'sans', web: W([400, 500, 700]) },
  { key: 'mulish', label: 'Mulish', base: 'sans', web: W([400, 600, 700]) },
  { key: 'barlow', label: 'Barlow', base: 'sans', web: W([400, 500, 700]) },
  { key: 'fira-sans', label: 'Fira Sans', base: 'sans', web: W([400, 500, 700]) },
  { key: 'karla', label: 'Karla', base: 'sans', web: W([400, 700]) },
  { key: 'cabin', label: 'Cabin', base: 'sans', web: W([400, 600, 700]) },
  { key: 'titillium-web', label: 'Titillium Web', base: 'sans', web: W([400, 600, 700]) },
  { key: 'pt-sans', label: 'PT Sans', base: 'sans', web: W([400, 700]) },
  { key: 'josefin-sans', label: 'Josefin Sans', base: 'sans', web: W([400, 600, 700]) },
  { key: 'quicksand', label: 'Quicksand', base: 'sans', web: W([400, 500, 700], false) },
  { key: 'comfortaa', label: 'Comfortaa', base: 'sans', web: W([400, 500, 700], false) },
  { key: 'oswald', label: 'Oswald', base: 'sans', web: W([400, 500, 700], false) },
  { key: 'bebas-neue', label: 'Bebas Neue', base: 'sans', web: W([400], false) },
  { key: 'anton', label: 'Anton', base: 'sans', web: W([400], false) },
  // ── serif ──
  { key: 'merriweather', label: 'Merriweather', base: 'serif', web: W([400, 700]) },
  { key: 'playfair-display', label: 'Playfair Display', base: 'serif', web: W([400, 600, 700]) },
  { key: 'lora', label: 'Lora', base: 'serif', web: W([400, 500, 700]) },
  { key: 'pt-serif', label: 'PT Serif', base: 'serif', web: W([400, 700]) },
  { key: 'roboto-slab', label: 'Roboto Slab', base: 'serif', web: W([400, 500, 700], false) },
  { key: 'libre-baskerville', label: 'Libre Baskerville', base: 'serif', web: W([400, 700]) },
  { key: 'crimson-text', label: 'Crimson Text', base: 'serif', web: W([400, 600, 700]) },
  // ── mono ──
  { key: 'roboto-mono', label: 'Roboto Mono', base: 'mono', web: W([400, 500, 700]) },
  { key: 'source-code-pro', label: 'Source Code Pro', base: 'mono', web: W([400, 500, 700]) },
  { key: 'jetbrains-mono', label: 'JetBrains Mono', base: 'mono', web: W([400, 500, 700]) },
  { key: 'inconsolata', label: 'Inconsolata', base: 'mono', web: W([400, 500, 700], false) },
  // ── +50 most-used fonts (weights & italics verified against the source) ──
  // sans
  { key: 'manrope', label: 'Manrope', base: 'sans', web: W([400, 700], false) },
  { key: 'figtree', label: 'Figtree', base: 'sans', web: W([400, 700]) },
  { key: 'plus-jakarta-sans', label: 'Plus Jakarta Sans', base: 'sans', web: W([400, 700]) },
  { key: 'sora', label: 'Sora', base: 'sans', web: W([400, 700], false) },
  { key: 'epilogue', label: 'Epilogue', base: 'sans', web: W([400, 700]) },
  { key: 'space-grotesk', label: 'Space Grotesk', base: 'sans', web: W([400, 700], false) },
  { key: 'archivo', label: 'Archivo', base: 'sans', web: W([400, 700]) },
  { key: 'archivo-narrow', label: 'Archivo Narrow', base: 'sans', web: W([400, 700]) },
  { key: 'assistant', label: 'Assistant', base: 'sans', web: W([400, 700], false) },
  { key: 'heebo', label: 'Heebo', base: 'sans', web: W([400, 700], false) },
  { key: 'hind', label: 'Hind', base: 'sans', web: W([400, 700], false) },
  { key: 'cairo', label: 'Cairo', base: 'sans', web: W([400, 700], false) },
  { key: 'exo-2', label: 'Exo 2', base: 'sans', web: W([400, 700]) },
  { key: 'kanit', label: 'Kanit', base: 'sans', web: W([400, 700]) },
  { key: 'saira', label: 'Saira', base: 'sans', web: W([400, 700]) },
  { key: 'signika', label: 'Signika', base: 'sans', web: W([400, 700], false) },
  { key: 'asap', label: 'Asap', base: 'sans', web: W([400, 700]) },
  { key: 'catamaran', label: 'Catamaran', base: 'sans', web: W([400, 700], false) },
  { key: 'dosis', label: 'Dosis', base: 'sans', web: W([400, 700], false) },
  { key: 'jost', label: 'Jost', base: 'sans', web: W([400, 700]) },
  { key: 'lexend', label: 'Lexend', base: 'sans', web: W([400, 700], false) },
  { key: 'maven-pro', label: 'Maven Pro', base: 'sans', web: W([400, 700], false) },
  { key: 'overpass', label: 'Overpass', base: 'sans', web: W([400, 700]) },
  { key: 'pt-sans-narrow', label: 'PT Sans Narrow', base: 'sans', web: W([400, 700], false) },
  { key: 'red-hat-display', label: 'Red Hat Display', base: 'sans', web: W([400, 700]) },
  { key: 'urbanist', label: 'Urbanist', base: 'sans', web: W([400, 700]) },
  { key: 'be-vietnam-pro', label: 'Be Vietnam Pro', base: 'sans', web: W([400, 700]) },
  { key: 'libre-franklin', label: 'Libre Franklin', base: 'sans', web: W([400, 700]) },
  { key: 'mukta', label: 'Mukta', base: 'sans', web: W([400, 700], false) },
  { key: 'varela-round', label: 'Varela Round', base: 'sans', web: W([400], false) },
  { key: 'fjalla-one', label: 'Fjalla One', base: 'sans', web: W([400], false) },
  { key: 'khand', label: 'Khand', base: 'sans', web: W([400, 700], false) },
  { key: 'm-plus-rounded-1c', label: 'M PLUS Rounded 1c', base: 'sans', web: W([400, 700], false) },
  { key: 'ibm-plex-sans', label: 'IBM Plex Sans', base: 'sans', web: W([400, 700]) },
  { key: 'roboto-condensed', label: 'Roboto Condensed', base: 'sans', web: W([400, 700]) },
  // serif
  { key: 'bitter', label: 'Bitter', base: 'serif', web: W([400, 700]) },
  { key: 'domine', label: 'Domine', base: 'serif', web: W([400, 700], false) },
  { key: 'arvo', label: 'Arvo', base: 'serif', web: W([400, 700]) },
  { key: 'cormorant', label: 'Cormorant', base: 'serif', web: W([400, 700]) },
  { key: 'eb-garamond', label: 'EB Garamond', base: 'serif', web: W([400, 700]) },
  { key: 'noto-serif', label: 'Noto Serif', base: 'serif', web: W([400, 700]) },
  { key: 'source-serif-4', label: 'Source Serif 4', base: 'serif', web: W([400, 700]) },
  { key: 'spectral', label: 'Spectral', base: 'serif', web: W([400, 700]) },
  { key: 'zilla-slab', label: 'Zilla Slab', base: 'serif', web: W([400, 700]) },
  { key: 'alegreya', label: 'Alegreya', base: 'serif', web: W([400, 700]) },
  { key: 'ibm-plex-serif', label: 'IBM Plex Serif', base: 'serif', web: W([400, 700]) },
  // mono
  { key: 'space-mono', label: 'Space Mono', base: 'mono', web: W([400, 700]) },
  { key: 'ibm-plex-mono', label: 'IBM Plex Mono', base: 'mono', web: W([400, 700]) },
  { key: 'fira-code', label: 'Fira Code', base: 'mono', web: W([400, 700], false) },
  { key: 'ubuntu-mono', label: 'Ubuntu Mono', base: 'mono', web: W([400, 700]) },

  // ── +metric-compatible faces (the closest possible web match for the most common
  //    document fonts, so Arial/Times/Calibri/Georgia/Cambria can be embedded 1:1) ──
  { key: 'arimo', label: 'Arimo (Arial-kompatibel)', base: 'sans', web: W([400, 700]) },
  { key: 'tinos', label: 'Tinos (Times-kompatibel)', base: 'serif', web: W([400, 700]) },
  { key: 'cousine', label: 'Cousine (Courier-kompatibel)', base: 'mono', web: W([400, 700]) },
  { key: 'carlito', label: 'Carlito (Calibri-kompatibel)', base: 'sans', web: W([400, 700]) },
  { key: 'caladea', label: 'Caladea (Cambria-kompatibel)', base: 'serif', web: W([400, 700]) },
  { key: 'gelasio', label: 'Gelasio (Georgia-kompatibel)', base: 'serif', web: W([400, 700]) },

  // ── +another wave of widely-used document & UI fonts ──
  // sans
  { key: 'outfit', label: 'Outfit', base: 'sans', web: W([400, 700], false) },
  { key: 'onest', label: 'Onest', base: 'sans', web: W([400, 700], false) },
  { key: 'chivo', label: 'Chivo', base: 'sans', web: W([400, 700]) },
  { key: 'league-spartan', label: 'League Spartan', base: 'sans', web: W([400, 700], false) },
  { key: 'public-sans', label: 'Public Sans', base: 'sans', web: W([400, 700]) },
  { key: 'hanken-grotesk', label: 'Hanken Grotesk', base: 'sans', web: W([400, 700]) },
  { key: 'instrument-sans', label: 'Instrument Sans', base: 'sans', web: W([400, 700]) },
  { key: 'schibsted-grotesk', label: 'Schibsted Grotesk', base: 'sans', web: W([400, 700]) },
  { key: 'bricolage-grotesque', label: 'Bricolage Grotesque', base: 'sans', web: W([400, 700], false) },
  { key: 'syne', label: 'Syne', base: 'sans', web: W([400, 700], false) },
  { key: 'sofia-sans', label: 'Sofia Sans', base: 'sans', web: W([400, 700]) },
  { key: 'readex-pro', label: 'Readex Pro', base: 'sans', web: W([400, 700], false) },
  { key: 'albert-sans', label: 'Albert Sans', base: 'sans', web: W([400, 700]) },
  { key: 'darker-grotesque', label: 'Darker Grotesque', base: 'sans', web: W([400, 700], false) },
  { key: 'oxygen', label: 'Oxygen', base: 'sans', web: W([400, 700], false) },
  { key: 'questrial', label: 'Questrial', base: 'sans', web: W([400], false) },
  { key: 'abel', label: 'Abel', base: 'sans', web: W([400], false) },
  { key: 'acme', label: 'Acme', base: 'sans', web: W([400], false) },
  { key: 'didact-gothic', label: 'Didact Gothic', base: 'sans', web: W([400], false) },
  { key: 'fredoka', label: 'Fredoka', base: 'sans', web: W([400, 700], false) },
  { key: 'baloo-2', label: 'Baloo 2', base: 'sans', web: W([400, 700], false) },
  { key: 'prompt', label: 'Prompt', base: 'sans', web: W([400, 700]) },
  { key: 'sarabun', label: 'Sarabun', base: 'sans', web: W([400, 700]) },
  { key: 'tajawal', label: 'Tajawal', base: 'sans', web: W([400, 700], false) },
  { key: 'teko', label: 'Teko', base: 'sans', web: W([400, 700], false) },
  { key: 'rajdhani', label: 'Rajdhani', base: 'sans', web: W([400, 700], false) },
  { key: 'antonio', label: 'Antonio', base: 'sans', web: W([400, 700], false) },
  { key: 'staatliches', label: 'Staatliches', base: 'sans', web: W([400], false) },
  { key: 'orbitron', label: 'Orbitron', base: 'sans', web: W([400, 700], false) },
  { key: 'jura', label: 'Jura', base: 'sans', web: W([400, 700], false) },
  { key: 'encode-sans', label: 'Encode Sans', base: 'sans', web: W([400, 700], false) },
  { key: 'barlow-condensed', label: 'Barlow Condensed', base: 'sans', web: W([400, 700]) },
  { key: 'barlow-semi-condensed', label: 'Barlow Semi Condensed', base: 'sans', web: W([400, 700]) },
  { key: 'saira-condensed', label: 'Saira Condensed', base: 'sans', web: W([400, 700], false) },
  { key: 'pathway-gothic-one', label: 'Pathway Gothic One', base: 'sans', web: W([400], false) },
  // serif
  { key: 'vollkorn', label: 'Vollkorn', base: 'serif', web: W([400, 700]) },
  { key: 'cardo', label: 'Cardo', base: 'serif', web: W([400, 700]) },
  { key: 'cormorant-garamond', label: 'Cormorant Garamond', base: 'serif', web: W([400, 700]) },
  { key: 'dm-serif-display', label: 'DM Serif Display', base: 'serif', web: W([400]) },
  { key: 'dm-serif-text', label: 'DM Serif Text', base: 'serif', web: W([400]) },
  { key: 'bree-serif', label: 'Bree Serif', base: 'serif', web: W([400], false) },
  { key: 'rokkitt', label: 'Rokkitt', base: 'serif', web: W([400, 700], false) },
  { key: 'aleo', label: 'Aleo', base: 'serif', web: W([400, 700]) },
  { key: 'frank-ruhl-libre', label: 'Frank Ruhl Libre', base: 'serif', web: W([400, 700], false) },
  { key: 'newsreader', label: 'Newsreader', base: 'serif', web: W([400, 700]) },
  { key: 'literata', label: 'Literata', base: 'serif', web: W([400, 700]) },
  { key: 'libre-caslon-text', label: 'Libre Caslon Text', base: 'serif', web: W([400, 700]) },
  { key: 'old-standard-tt', label: 'Old Standard TT', base: 'serif', web: W([400, 700]) },
  { key: 'noticia-text', label: 'Noticia Text', base: 'serif', web: W([400, 700]) },
  { key: 'crimson-pro', label: 'Crimson Pro', base: 'serif', web: W([400, 700]) },
  { key: 'petrona', label: 'Petrona', base: 'serif', web: W([400, 700]) },
  { key: 'neuton', label: 'Neuton', base: 'serif', web: W([400, 700], false) },
  { key: 'gentium-plus', label: 'Gentium Plus', base: 'serif', web: W([400, 700]) },
  { key: 'sorts-mill-goudy', label: 'Sorts Mill Goudy', base: 'serif', web: W([400]) },
  // mono
  { key: 'fira-mono', label: 'Fira Mono', base: 'mono', web: W([400, 700], false) },
  { key: 'pt-mono', label: 'PT Mono', base: 'mono', web: W([400], false) },
  { key: 'dm-mono', label: 'DM Mono', base: 'mono', web: W([400]) },
  { key: 'overpass-mono', label: 'Overpass Mono', base: 'mono', web: W([400, 700], false) },
  { key: 'red-hat-mono', label: 'Red Hat Mono', base: 'mono', web: W([400, 700]) },
  { key: 'anonymous-pro', label: 'Anonymous Pro', base: 'mono', web: W([400, 700]) },
  { key: 'b612-mono', label: 'B612 Mono', base: 'mono', web: W([400, 700]) },
  { key: 'spline-sans-mono', label: 'Spline Sans Mono', base: 'mono', web: W([400, 700]) },
  // handwriting / script — common in signatures & informal documents
  { key: 'caveat', label: 'Caveat', base: 'sans', web: W([400, 700], false) },
  { key: 'dancing-script', label: 'Dancing Script', base: 'serif', web: W([400, 700], false) },
  { key: 'pacifico', label: 'Pacifico', base: 'serif', web: W([400], false) },
  { key: 'lobster', label: 'Lobster', base: 'serif', web: W([400], false) },
  { key: 'satisfy', label: 'Satisfy', base: 'serif', web: W([400], false) },
  { key: 'great-vibes', label: 'Great Vibes', base: 'serif', web: W([400], false) },
  { key: 'sacramento', label: 'Sacramento', base: 'serif', web: W([400], false) },
  { key: 'shadows-into-light', label: 'Shadows Into Light', base: 'sans', web: W([400], false) },
  { key: 'indie-flower', label: 'Indie Flower', base: 'sans', web: W([400], false) },
  { key: 'permanent-marker', label: 'Permanent Marker', base: 'sans', web: W([400], false) },
  { key: 'courgette', label: 'Courgette', base: 'serif', web: W([400], false) },
  { key: 'kalam', label: 'Kalam', base: 'sans', web: W([400, 700], false) },
];

export const FONT_CATALOG: FontDef[] = [
  ...SYSTEM,
  ...STANDARD,
  ...WEB.map((f) => ({ ...f, group: 'web' as const })),
];

/** The editor's default font for new text (matches the user's expectation of Arial). */
export const DEFAULT_FONT_KEY = 'arial';

const BY_KEY = new Map(FONT_CATALOG.map((f) => [f.key, f]));

/** Resolve a font key to its definition, defaulting to Arial for unknown keys. */
export function fontDef(key: string): FontDef {
  return BY_KEY.get(key) ?? BY_KEY.get(DEFAULT_FONT_KEY) ?? FONT_CATALOG[0];
}

export function baseFamilyOf(key: string): BaseFamily {
  return fontDef(key).base;
}

/**
 * Common PostScript/PDF font names that don't equal a catalogue label once
 * compacted. Mapping them explicitly means a scanned line reports the *correct*
 * named font (Arial, Times New Roman, …) instead of falling back to a generic
 * family — so the panel name and the typeface actually used never disagree.
 */
const FONT_ALIASES: Record<string, string> = {
  // Arial & metric clones. Deliberately NOT aliased: Arial Narrow / Arial Black —
  // their metrics differ substantially from Arial, so claiming "Arial" would make
  // replaced text run visibly wider/narrower than the original glyphs.
  arialmt: 'arial',
  arial: 'arial',
  arialunicodems: 'arial',
  liberationsans: 'arial',
  nimbussans: 'arial',
  nimbussansl: 'arial',
  arimo: 'arimo',
  // Helvetica
  helvetica: 'helvetica',
  helveticaneue: 'helvetica',
  helveticalt: 'helvetica',
  helveticaltstd: 'helvetica',
  // Times & metric clones
  times: 'times-new-roman',
  timesroman: 'times-new-roman',
  timesnewroman: 'times-new-roman',
  timesnewromanps: 'times-new-roman',
  liberationserif: 'times-new-roman',
  nimbusroman: 'times-new-roman',
  nimbusromanno9l: 'times-new-roman',
  tinos: 'tinos',
  // Courier & metric clones
  couriernew: 'courier-new',
  couriernewps: 'courier-new',
  courier: 'courier-new',
  courierstd: 'courier-new',
  liberationmono: 'courier-new',
  nimbusmono: 'courier-new',
  cousine: 'cousine',
  // common OS / Office faces
  trebuchetms: 'trebuchet',
  segoeui: 'segoe-ui',
  calibri: 'calibri',
  carlito: 'carlito',
  cambria: 'cambria',
  caladea: 'caladea',
  consolas: 'consolas',
  georgia: 'georgia',
  gelasio: 'gelasio',
  verdana: 'verdana',
  tahoma: 'tahoma',
  garamond: 'garamond',
  ebgaramond: 'eb-garamond',
  // popular web faces whose PostScript name compacts differently from the label
  robotocondensed: 'roboto-condensed',
  ptsans: 'pt-sans',
  ptserif: 'pt-serif',
  notosans: 'noto-sans',
  notoserif: 'noto-serif',
  sourcesanspro: 'source-sans-3',
  sourceserifpro: 'source-serif-4',
  sourcecodepro: 'source-code-pro',
  ibmplexsans: 'ibm-plex-sans',
  ibmplexserif: 'ibm-plex-serif',
  ibmplexmono: 'ibm-plex-mono',
};

/** Compacted catalogue label *and* key → key, for exact hits like "roboto". */
const CATALOG_BY_COMPACT = new Map<string, string>();
for (const f of FONT_CATALOG) {
  CATALOG_BY_COMPACT.set(compactFontName(f.label), f.key);
  CATALOG_BY_COMPACT.set(compactFontName(f.key), f.key);
}

/**
 * Trailing weight/style/foundry tokens that aren't part of a family's identity.
 * Stripped one at a time with an exact re-check after each strip, so "Arial-BoldMT"
 * → "arial" and "Roboto-Medium" → "roboto" while a real name like "timesnewroman"
 * is never eroded (we only ever require an *exact* match). MUST be tried
 * longest-first — the sort below guarantees it — otherwise "…semibold" loses only
 * its "bold" tail and the leftover "…semi" never matches anything.
 */
const TRAILING_TOKENS = ['psmt', 'mt', 'ps', 'bolditalic', 'boldoblique', 'semibolditalic', 'italic', 'oblique', 'bold', 'semibold', 'demibold', 'demi', 'extrabold', 'ultrabold', 'heavy', 'black', 'medium', 'light', 'extralight', 'ultralight', 'thin', 'hairline', 'regular', 'normal'].sort((a, b) => b.length - a.length);

/**
 * Resolve a raw PDF/CSS font name to a specific catalogue key (e.g. "ArialMT" →
 * "arial", "TimesNewRomanPS-BoldMT" → "times-new-roman"), or null when the name
 * isn't a known font. Callers then fall back to the metric classification.
 */
export function matchCatalogFontKey(rawName: string | undefined | null): string | null {
  let c = compactFontName(rawName);
  if (!c) return null;
  if (FONT_ALIASES[c]) return FONT_ALIASES[c];
  if (CATALOG_BY_COMPACT.has(c)) return CATALOG_BY_COMPACT.get(c)!;

  let changed = true;
  while (changed && c.length > 2) {
    changed = false;
    for (const t of TRAILING_TOKENS) {
      if (c.length > t.length && c.endsWith(t)) {
        c = c.slice(0, -t.length);
        if (FONT_ALIASES[c]) return FONT_ALIASES[c];
        if (CATALOG_BY_COMPACT.has(c)) return CATALOG_BY_COMPACT.get(c)!;
        changed = true;
        break;
      }
    }
  }
  return null;
}

/**
 * Resolve a raw PDF/CSS font name to the catalogue key (or metric family) the editor
 * should STORE on an element and render for it — the same identity the inspector then
 * shows. It prefers an exact catalogue match (Arial, Roboto, Times New Roman …, which we
 * reproduce 1:1) and otherwise classifies the *real* name into its metric family
 * (serif / sans / mono).
 *
 * Feed it the font's real /BaseFont name, NOT pdf.js's per-run style family: pdf.js only
 * ever reports a generic "serif"/"sans-serif"/"monospace" there (from descriptor flags),
 * so a flag-less or non-embedded serif like DejaVu Serif would otherwise be filed — and
 * shown, and fall back on export — as a sans (Helvetica). This single rule keeps the
 * stored family, the inspector's font control and the export fallback all in agreement.
 */
export function resolveFamilyKey(rawName: string | undefined | null): FontFamilyKey {
  return matchCatalogFontKey(rawName) ?? classifyFont(rawName).family;
}

/**
 * Resolve the *display name* for a scanned line's font — the single source of truth
 * the font panel and inspector show. The rule keeps the shown name honest, so the
 * preview and the text actually written never disagree:
 *
 *   • a name in our catalogue → the canonical label (Arial, Roboto, Times New Roman …)
 *     — we can reproduce it exactly with the matching web/standard font.
 *   • a font the PDF embeds → its cleaned real name — we reuse the original 1:1.
 *   • a bare generic family (pdf.js fallback) → a friendly family name (Sans-Serif …),
 *     which we render with the metric-matching standard font.
 *   • anything else (a specific face we can neither match nor embed, or an internal
 *     pdf.js placeholder) → "Unbekannt", since we can't reproduce it faithfully.
 */
export function fontDisplayName(rawName: string | undefined | null, embedded: boolean): string {
  // Generic CSS families first: a bare "serif"/"sans-serif" from pdf.js is a fallback
  // marker, not a font identity — it must read as the friendly "Serif"/"Sans-Serif",
  // never as the standard catalogue entry "Serif (Times)" the compact map would hit.
  if (isGenericFontLabel(rawName)) return prettyFontName(rawName);
  const key = matchCatalogFontKey(rawName);
  if (key) return fontDef(key).label;
  if (isInternalFontName(rawName)) return 'Unbekannt';
  const pretty = prettyFontName(rawName);
  if (!pretty || pretty === 'Unbekannt') return 'Unbekannt';
  // A specific, real face: only claim it when we can actually reproduce it (the PDF
  // embeds the original); otherwise we'd show one font and write another.
  return embedded ? pretty : 'Unbekannt';
}

/**
 * Whether a family can be written with a REAL bold / italic face on export. Web fonts
 * that ship only one weight (or no italics) would render faux-bold/italic on screen
 * but flatten to the plain face in the saved PDF — the UI disables those toggles so
 * screen and export never disagree. System and standard families always map to the
 * PDF standard fonts, which ship true bold/italic faces.
 */
export function fontCapabilities(key: string): { bold: boolean; italic: boolean } {
  const f = fontDef(key);
  if (!f.web) return { bold: true, italic: true };
  return { bold: f.web.weights.some((w) => w >= 600), italic: f.web.italic };
}

/** CSS font-family stack for previewing a font on screen (real font + system fallback). */
export function cssStackFor(key: string): string {
  const f = fontDef(key);
  if (f.css) return f.css;
  const sys = sysStack(f.base);
  return f.web ? `"${f.label}", ${sys}` : sys;
}

/** The on-screen CSS face (family + weight + style) for a styled text element. */
export interface TextFaceCss {
  fontFamily: string;
  fontWeight: 400 | 700;
  fontStyle: 'normal' | 'italic';
}

/**
 * THE single rule for how the editor paints a text element on screen — used by the
 * field, its in-place editor, the scan line-boxes, the scan preview AND the inspector's
 * font control, so what you see can never disagree between them.
 *
 * Two cases that must stay distinct:
 *   • An embedded ORIGINAL face was captured for this element (scan editor, 1:1 reuse):
 *     the captured font program ALREADY encodes the exact weight and slant of the source
 *     glyphs. We therefore render it verbatim and force weight/style to normal. Asking
 *     the browser for bold/italic on top would make it FAUX-synthesise a *second* slant
 *     (or extra weight) over an already-italic/already-bold face — the over-slanted look
 *     that made adopted text differ from its original (and from the export, which never
 *     synthesises). Forcing normal keeps screen and export pixel-identical.
 *   • A catalogue/standard family: render that family and let the browser apply the
 *     requested bold/italic (a real shipped face when available, else a faithful
 *     synthetic) — exactly the normal text-field behaviour.
 *
 * When an embedded id is present but its program isn't available this session (e.g. a
 * reloaded document), we fall back to the metric family — the same fallback the export
 * uses — so the two still match.
 */
export function textFaceCss(
  family: string,
  embeddedFontId: string | undefined,
  bold: boolean,
  italic: boolean,
): TextFaceCss {
  const embedded = embeddedFontFamily(embeddedFontId);
  if (embedded) return { fontFamily: embedded, fontWeight: 400, fontStyle: 'normal' };
  return {
    fontFamily: cssStackFor(family),
    fontWeight: bold ? 700 : 400,
    fontStyle: italic ? 'italic' : 'normal',
  };
}

const CDN = 'https://cdn.jsdelivr.net/npm/@fontsource';

/** Snap a desired weight to the nearest one the package actually ships. */
function pickWeight(available: number[], want: number): number {
  if (available.includes(want)) return want;
  return available.reduce((best, w) => (Math.abs(w - want) < Math.abs(best - want) ? w : best), available[0]);
}

/** URL of the .woff2 file for a given weight/style, or null for standard families. */
export function fontFileUrl(key: string, weight: number, italic: boolean): string | null {
  const f = fontDef(key);
  if (!f.web) return null;
  const w = pickWeight(f.web.weights, weight);
  const style = italic && f.web.italic ? 'italic' : 'normal';
  return `${CDN}/${f.key}/files/${f.key}-latin-${w}-${style}.woff2`;
}

/**
 * Inject one <style> with @font-face rules for every web font so previews render
 * in their real typeface. Rules are inert until an element actually uses the
 * family, so the browser downloads each file lazily and at most once.
 */
export function injectFontFaces(): void {
  if (typeof document === 'undefined' || document.getElementById('pdfworld-fontfaces')) return;

  const face = (family: string, weight: number, style: 'normal' | 'italic', url: string) =>
    `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};` +
    `font-display:swap;src:url('${url}') format('woff2');}`;

  let css = '';
  for (const f of WEB) {
    if (!f.web) continue;
    for (const w of f.web.weights) {
      css += face(f.label, w, 'normal', `${CDN}/${f.key}/files/${f.key}-latin-${w}-normal.woff2`);
      if (f.web.italic) css += face(f.label, w, 'italic', `${CDN}/${f.key}/files/${f.key}-latin-${w}-italic.woff2`);
    }
  }

  const pre = document.createElement('link');
  pre.rel = 'preconnect';
  pre.href = 'https://cdn.jsdelivr.net';
  pre.crossOrigin = 'anonymous';
  document.head.appendChild(pre);

  const style = document.createElement('style');
  style.id = 'pdfworld-fontfaces';
  style.textContent = css;
  document.head.appendChild(style);
}
