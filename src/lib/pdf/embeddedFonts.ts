/**
 * Registry of *original* fonts captured from a source PDF (via pdf.js).
 *
 * This is what makes the scan editor's text replacement truly 1:1: when the
 * source PDF embeds the font (the overwhelming majority of real-world files),
 * we keep its exact program here and reuse it in two places —
 *
 *   • on screen — a CSS `@font-face` is injected from the bytes (Blob URL) so the
 *     editable text renders in the original typeface, not an approximation.
 *   • on export — the bake layer fetches the same bytes and embeds them (fontkit),
 *     so the saved PDF matches the original glyph for glyph.
 *
 * Everything degrades gracefully: if a font isn't embedded or can't be parsed,
 * nothing is registered and callers fall back to the metric-compatible standard
 * font (Helvetica / Times / Courier) — exactly the previous behaviour, never worse.
 */

export interface EmbeddedFont {
  /** stable id: `${sourceKey}#${sourceIndex}#${pdfjsFontName}` */
  id: string;
  /** the reconstructed OpenType/TrueType program from pdf.js */
  data: Uint8Array;
  /** e.g. "font/opentype", "application/font-woff" */
  mimetype: string;
}

/** Bytes kept for lossless re-embed on export (read by the bake layer). */
const fontBytes = new Map<string, EmbeddedFont>();
/** Id → injected CSS family name (so on-screen text uses the original face). */
const cssFamilyById = new Map<string, string>();

let styleEl: HTMLStyleElement | null = null;
let seq = 0;

function mimeToFormat(mime: string): string {
  if (/woff2/i.test(mime)) return 'woff2';
  if (/woff/i.test(mime)) return 'woff';
  if (/truetype|ttf/i.test(mime)) return 'truetype';
  return 'opentype';
}

/**
 * Capture an original font. Stores its bytes (for export) and, in the browser,
 * injects an `@font-face` so the editor can render it. Returns the CSS family
 * name to use on screen (or undefined when no DOM is available).
 */
export function registerEmbeddedFont(font: EmbeddedFont): string | undefined {
  fontBytes.set(font.id, font);

  const existing = cssFamilyById.get(font.id);
  if (existing) return existing;
  if (typeof document === 'undefined') return undefined;

  const family = `pdfemb-${++seq}`;
  try {
    const ab = font.data.buffer.slice(
      font.data.byteOffset,
      font.data.byteOffset + font.data.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([ab], { type: font.mimetype || 'font/opentype' });
    const url = URL.createObjectURL(blob);

    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'pdfworld-embedded-fonts';
      document.head.appendChild(styleEl);
    }
    styleEl.appendChild(
      document.createTextNode(
        `@font-face{font-family:'${family}';font-display:swap;` +
          `src:url('${url}') format('${mimeToFormat(font.mimetype)}');}`,
      ),
    );
    cssFamilyById.set(font.id, family);
    return family;
  } catch {
    return undefined;
  }
}

/** CSS family registered for an embedded-font id, if any (used on screen). */
export function embeddedFontFamily(id: string | undefined): string | undefined {
  return id ? cssFamilyById.get(id) : undefined;
}

/** Raw bytes for an embedded-font id, if captured (used by the bake/export layer). */
export function getEmbeddedFont(id: string | undefined): EmbeddedFont | undefined {
  return id ? fontBytes.get(id) : undefined;
}
