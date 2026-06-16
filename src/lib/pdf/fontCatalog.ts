import type { BaseFamily } from './types';

/**
 * Curated catalogue of the ~40 most-used document fonts.
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
  /** present for real web fonts; absent for the three built-in standard families */
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

/** The three built-in standard families render with zero network cost. */
const STANDARD: FontDef[] = [
  { key: 'sans', label: 'Sans (Helvetica)', base: 'sans' },
  { key: 'serif', label: 'Serif (Times)', base: 'serif' },
  { key: 'mono', label: 'Mono (Courier)', base: 'mono' },
];

/** 37 popular web fonts. `key` === @fontsource package id. */
const WEB: FontDef[] = [
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
];

export const FONT_CATALOG: FontDef[] = [...STANDARD, ...WEB];

const BY_KEY = new Map(FONT_CATALOG.map((f) => [f.key, f]));

/** Resolve a font key to its definition, defaulting to Sans for unknown keys. */
export function fontDef(key: string): FontDef {
  return BY_KEY.get(key) ?? FONT_CATALOG[0];
}

export function baseFamilyOf(key: string): BaseFamily {
  return fontDef(key).base;
}

/** CSS font-family stack for previewing a font on screen (real font + system fallback). */
export function cssStackFor(key: string): string {
  const f = fontDef(key);
  const sys = sysStack(f.base);
  return f.web ? `"${f.label}", ${sys}` : sys;
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
