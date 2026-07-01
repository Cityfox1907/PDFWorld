import { StandardFonts } from 'pdf-lib';
import type { BaseFamily, TextElement } from './types';

/**
 * Where a line's baseline sits below the top of its glyph box, as a fraction of
 * the font size. Shared by the text extractor (render.ts) and the bake layer
 * (bake.ts) so a scanned line is re-drawn on EXACTLY its original baseline —
 * keeping replaced text in the same vertical position as the original glyphs.
 */
export const BASELINE_RATIO = 0.8;

/**
 * Distance (in points) from a text box's top to the baseline of its FIRST line, for an
 * overlay text element rendered with `lineHeight`. The browser centres each glyph row in
 * its line-box, so the baseline sits half a line of leading — `size·(lineHeight−1)/2` —
 * below the line top, plus the font ascent (`size·BASELINE_RATIO`).
 *
 * Using this single definition for the on-screen text, the alignment guide/snap target
 * AND the exported baseline keeps all three pixel-identical — so the horizontal guide
 * lands exactly on the letters it is aligning (waagrechte Ausrichtung), instead of a
 * fraction of a line too high. (Scanned PDF lines keep their true baseline, with no
 * leading, since their glyphs are real PDF content, not a CSS line-box.)
 */
export function firstBaselineOffset(size: number, lineHeight: number): number {
  return size * ((lineHeight - 1) / 2 + BASELINE_RATIO);
}

/**
 * Line height used for text created by the scan tool's in-place editing. One shared
 * constant keeps the transient run editor, the created element and the export on the
 * exact same baseline.
 */
export const SCAN_LINE_HEIGHT = 1.2;

/**
 * How far a replacing text element's background cover extends past its cover region,
 * in points. Anti-aliased fringes of the original glyphs (and slight metric drift of
 * the extraction) would otherwise peek out around the edges.
 */
function coverInsets(size: number): { x: number; y: number } {
  return { x: Math.max(1.5, size * 0.2), y: Math.max(1, size * 0.12) };
}

/**
 * The final, already-inflated page region a replacing text element's cover paints
 * over (view-points). THE single geometry rule shared by the editor's on-screen
 * cover (CoverView), the transient run editor AND the export baker — one source, so
 * screen and PDF can never disagree about what is hidden. Falls back to the
 * element's own box for legacy elements without a page-anchored coverRect.
 */
export function coverRectFor(
  el: Pick<TextElement, 'x' | 'y' | 'width' | 'height' | 'size' | 'coverRect'>,
): { x: number; y: number; width: number; height: number } {
  const pad = coverInsets(el.size);
  const r = el.coverRect ?? { x: el.x, y: el.y, width: el.width, height: el.height };
  return { x: r.x - pad.x, y: r.y - pad.y, width: r.width + pad.x * 2, height: r.height + pad.y * 2 };
}

/**
 * How far above a scanned run's glyph-box top the replacing text box starts: half a
 * line of leading, so the box's first baseline lands EXACTLY on the run's original
 * baseline. Shared by the transient run editor and the element it commits.
 */
export function scanBoxOffset(size: number): number {
  return (size * (SCAN_LINE_HEIGHT - 1)) / 2;
}

/**
 * Map a base family + style to one of the 14 PDF standard fonts.
 * The standard fonts are metric-similar to Arial/Times/Courier and cover the full
 * WinAnsi range (incl. German umlauts, ß and €), so they reproduce the vast majority
 * of business documents faithfully with zero embedding cost. They are also the
 * fallback whenever a chosen web font cannot be fetched and embedded.
 */
export function standardFontFor(family: BaseFamily, bold: boolean, italic: boolean): StandardFonts {
  switch (family) {
    case 'serif':
      if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
      if (bold) return StandardFonts.TimesRomanBold;
      if (italic) return StandardFonts.TimesRomanItalic;
      return StandardFonts.TimesRoman;
    case 'mono':
      if (bold && italic) return StandardFonts.CourierBoldOblique;
      if (bold) return StandardFonts.CourierBold;
      if (italic) return StandardFonts.CourierOblique;
      return StandardFonts.Courier;
    case 'sans':
    default:
      if (bold && italic) return StandardFonts.HelveticaBoldOblique;
      if (bold) return StandardFonts.HelveticaBold;
      if (italic) return StandardFonts.HelveticaOblique;
      return StandardFonts.Helvetica;
  }
}

/** Lowercased, alphanumeric-only core of a font name (subset prefix stripped). */
export function compactFontName(rawName: string | undefined | null): string {
  return (rawName ?? '')
    .toLowerCase()
    .replace(/^[a-z]{6}\+/, '') // strip subset prefix "abcdee+"
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Generic CSS family names pdf.js emits when it can't name a (non-embedded) face.
 * These MUST be resolved exactly and first: the classic trap is "sans-serif",
 * whose compact form "sansserif" contains the substring "serif" and would
 * otherwise be misread as a serif font — the very bug that made one detected line
 * preview in two different typefaces.
 */
const GENERIC_FAMILY: Record<string, BaseFamily> = {
  serif: 'serif',
  uiserif: 'serif',
  sansserif: 'sans',
  uisansserif: 'sans',
  sans: 'sans',
  systemui: 'sans',
  cursive: 'serif',
  fantasy: 'sans',
  monospace: 'mono',
  uimonospace: 'mono',
  mono: 'mono',
};

/** Friendly labels for the generic families, shown when no real name is known. */
const GENERIC_LABEL: Record<string, string> = {
  serif: 'Serif',
  uiserif: 'Serif',
  sansserif: 'Sans-Serif',
  uisansserif: 'Sans-Serif',
  sans: 'Sans-Serif',
  systemui: 'System',
  cursive: 'Schreibschrift',
  fantasy: 'Dekorativ',
  monospace: 'Monospace',
  uimonospace: 'Monospace',
  mono: 'Monospace',
};

// Substring hints, checked AFTER the exact generic map. Mono is tested first (a
// "…SansMono" name is monospace, not sans), then sans before serif so any "…sans…"
// name wins over the "serif" hidden inside it.
const MONO_HINTS = ['courier', 'consol', 'menlo', 'monaco', 'inconsolata', 'sourcecodepro', 'liberationmono', 'robotomono', 'jetbrainsmono', 'firacode', 'spacemono', 'ibmplexmono', 'ubuntumono', 'dejavusansmono', 'dejavumono', 'nimbusmono', 'cousine', 'monospace'];
const SANS_HINTS = ['sans', 'arial', 'helvetic', 'verdana', 'tahoma', 'segoe', 'calibri', 'candara', 'corbel', 'trebuchet', 'frutiger', 'myriad', 'gill', 'futura', 'avenir', 'gotham', 'proxima', 'dejavusans', 'liberationsans', 'nimbussans', 'opensans', 'notosans', 'sourcesans', 'firasans', 'worksans', 'ptsans', 'grotesk', 'grotesque', 'franklin', 'univers', 'akzidenz'];
const SERIF_HINTS = ['times', 'georgia', 'garamond', 'minion', 'roman', 'serif', 'cambria', 'palatino', 'merriweather', 'baskerville', 'caslon', 'didot', 'bodoni', 'slab', 'playfair', 'lora', 'spectral', 'cormorant', 'bookman', 'liberationserif', 'nimbusroman', 'charter', 'utopia', 'schoolbook', 'tinos', 'plantin', 'sabon', 'goudy'];

/** Decide the metric family for an already-compacted font name. */
function familyForCompact(compact: string): BaseFamily {
  if (GENERIC_FAMILY[compact]) return GENERIC_FAMILY[compact];
  if (MONO_HINTS.some((h) => compact.includes(h))) return 'mono';
  if (SANS_HINTS.some((h) => compact.includes(h))) return 'sans';
  if (SERIF_HINTS.some((h) => compact.includes(h))) return 'serif';
  return 'sans';
}

/**
 * Classify a raw PDF/CSS font name into a metric family + style flags.
 * Handles the messy names pdf.js emits (e.g. "ABCDEE+TimesNewRomanPS-BoldMT") and
 * the bare generic families ("sans-serif", "serif", "monospace") it falls back to
 * when a font is not embedded.
 */
export function classifyFont(rawName: string | undefined | null): {
  family: BaseFamily;
  bold: boolean;
  italic: boolean;
} {
  const name = (rawName ?? '').toLowerCase();
  const cleaned = name.replace(/^[a-z]{6}\+/, ''); // strip subset prefix "ABCDEE+"
  const compact = cleaned.replace(/[^a-z0-9]/g, '');

  const bold = /bold|black|heavy|semibold|\bbd\b|700|800|900/.test(cleaned) || /bold|black|heavy/.test(compact);
  const italic = /italic|oblique|\bit\b/.test(cleaned) || /italic|oblique/.test(compact);

  return { family: familyForCompact(compact), bold, italic };
}

/** True for the generic CSS family names ("sans-serif", "serif", …). */
export function isGenericFontLabel(name: string | undefined | null): boolean {
  return !!GENERIC_FAMILY[compactFontName(name)];
}

/**
 * True for pdf.js internal placeholder ids like "g_d0_f1" or "f3" that carry no
 * human-readable typeface name — so the UI can prefer a real name instead.
 */
export function isInternalFontName(name: string | undefined | null): boolean {
  const s = (name ?? '').trim();
  return /^g[_\s]?d?\d/i.test(s) || /_f\d/i.test(s) || /^[a-z]{1,3}\d+$/i.test(s);
}

/**
 * Turn the raw PDF font name pdf.js reports (e.g. "ABCDEE+TimesNewRomanPS-BoldMT")
 * into a clean, readable label for the scan editor's font panel.
 *
 * It strips the 6-letter subset prefix and the PostScript "MT"/"PS" suffixes,
 * normalises separators AND splits the run-together CamelCase names that PDFs love
 * ("PaalalabasDisplayCondensedBETA" → "Paalalabas Display Condensed BETA"), and maps
 * the bare generic families to friendly names. Returns "Unbekannt" only when nothing
 * usable remains, so the panel never shows an empty or cryptic blob.
 */
export function prettyFontName(rawName: string | undefined | null): string {
  let s = (rawName ?? '').trim();
  if (!s) return 'Unbekannt';
  const generic = GENERIC_LABEL[compactFontName(s)];
  if (generic) return generic;
  s = s.replace(/^[A-Za-z]{6}\+/, ''); // drop subset prefix "ABCDEE+"
  s = s.replace(/[-_]+/g, ' '); // separators → spaces
  // Split the run-together names PDFs embed so each word reads on its own:
  //   lower/digit → Upper  ("DisplayCondensed" → "Display Condensed")
  //   ACRONYM → Word       ("BETABold"        → "BETA Bold")
  //   word → number        ("Exo2"            → "Exo 2")
  s = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  s = s.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  s = s.replace(/([a-zA-Z])([0-9])/g, '$1 $2');
  // PostScript / foundry suffixes that aren't part of the readable name.
  s = s.replace(/\bPSMT\b/gi, '').replace(/\bMT\b/g, '').replace(/\bPS\b/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s || 'Unbekannt';
}

/**
 * Store for embedded font programs extracted from a source PDF (via pdf.js).
 * Lets in-place text edits reuse the *original* glyphs when extraction succeeds.
 */
export class FontStore {
  private fonts = new Map<string, Uint8Array>();

  has(id: string): boolean {
    return this.fonts.has(id);
  }

  put(id: string, data: Uint8Array): void {
    this.fonts.set(id, data);
  }

  get(id: string): Uint8Array | undefined {
    return this.fonts.get(id);
  }

  clear(): void {
    this.fonts.clear();
  }
}
