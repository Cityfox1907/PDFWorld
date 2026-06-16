import { StandardFonts } from 'pdf-lib';
import type { BaseFamily, FontFamilyKey } from './types';

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

/**
 * Classify a raw PDF/CSS font name into a family + style flags.
 * Handles the messy names pdf.js emits (e.g. "ABCDEE+TimesNewRomanPS-BoldMT").
 */
export function classifyFont(rawName: string | undefined | null): {
  family: FontFamilyKey;
  bold: boolean;
  italic: boolean;
} {
  const name = (rawName ?? '').toLowerCase();
  const cleaned = name.replace(/^[a-z]{6}\+/, ''); // strip subset prefix "ABCDEE+"
  const compact = cleaned.replace(/[^a-z0-9]/g, '');

  const bold = /bold|black|heavy|semibold|\bbd\b|700|800|900/.test(cleaned) || /bold/.test(compact);
  const italic = /italic|oblique|\bit\b/.test(cleaned) || /italic|oblique/.test(compact);

  let family: FontFamilyKey;

  const serifHints = ['times', 'georgia', 'garamond', 'minion', 'roman', 'serif', 'book', 'cambria', 'palatino', 'merriweather', 'ptserif', 'liberationserif'];
  const monoHints = ['courier', 'mono', 'consol', 'menlo', 'monaco', 'inconsolata', 'sourcecodepro', 'liberationmono'];

  if (monoHints.some((h) => compact.includes(h))) family = 'mono';
  else if (serifHints.some((h) => compact.includes(h))) family = 'serif';
  else family = 'sans';

  return { family, bold, italic };
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
