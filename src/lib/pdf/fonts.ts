import { StandardFonts } from 'pdf-lib';
import type { BaseFamily } from './types';

/**
 * Where a line's baseline sits below the top of its glyph box, as a fraction of
 * the font size. Shared by the text extractor (render.ts) and the bake layer
 * (bake.ts) so a scanned line is re-drawn on EXACTLY its original baseline —
 * keeping replaced text in the same vertical position as the original glyphs.
 */
export const BASELINE_RATIO = 0.8;

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

// Substring hints, checked AFTER the exact generic map. Sans is deliberately
// tested before serif so any "…sans…" name wins over the "serif" hidden inside it.
const MONO_HINTS = ['courier', 'consol', 'menlo', 'monaco', 'inconsolata', 'sourcecodepro', 'liberationmono', 'robotomono', 'jetbrainsmono', 'firacode', 'spacemono', 'ibmplexmono', 'ubuntumono', 'monospace'];
const SANS_HINTS = ['sans', 'arial', 'helvetic', 'verdana', 'tahoma', 'segoe', 'calibri', 'candara', 'corbel', 'trebuchet', 'frutiger', 'myriad', 'gill', 'futura', 'avenir', 'gotham', 'proxima', 'dejavusans', 'liberationsans', 'opensans', 'notosans', 'sourcesans', 'firasans', 'worksans', 'ptsans'];
const SERIF_HINTS = ['times', 'georgia', 'garamond', 'minion', 'roman', 'serif', 'cambria', 'palatino', 'merriweather', 'baskerville', 'caslon', 'didot', 'bodoni', 'slab', 'playfair', 'lora', 'spectral', 'cormorant', 'bookman', 'liberationserif'];

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
 * into a readable label for the scan editor's font panel. Strips the 6-letter
 * subset prefix and the PostScript "MT"/"PS" suffixes, normalises separators, and
 * maps the bare generic families to friendly names. Never empty — falls back to
 * the raw name so the user always sees *something*.
 */
export function prettyFontName(rawName: string | undefined | null): string {
  let s = (rawName ?? '').trim();
  if (!s) return 'Unbekannt';
  const generic = GENERIC_LABEL[compactFontName(s)];
  if (generic) return generic;
  s = s.replace(/^[A-Za-z]{6}\+/, ''); // drop subset prefix "ABCDEE+"
  s = s.replace(/[-_]+/g, ' '); // separators → spaces
  s = s.replace(/PSMT\b/gi, '').replace(/MT\b/g, '').replace(/PS\b/g, ''); // PostScript suffixes
  s = s.replace(/\s+/g, ' ').trim();
  return s || (rawName ?? 'Unbekannt');
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
