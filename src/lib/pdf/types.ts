/**
 * PDFWorld data model.
 *
 * Geometry convention for all overlay elements:
 *   - Coordinates are stored in "view points": PDF points (1/72 inch) at scale 1,
 *     with a TOP-LEFT origin (x →, y ↓), inside the *rotated, visible* page frame.
 *   - This makes geometry zoom-independent: a CSS pixel = point * (baseScale * zoom).
 *   - On export, the bake layer converts these to pdf-lib content-space coordinates
 *     (bottom-left origin) via the page's own pdf.js viewport, so page rotation is
 *     handled correctly and the original page content is never rasterised.
 */

export type FontFamilyKey = 'sans' | 'serif' | 'mono';

export type ElementType =
  | 'text'
  | 'rect'
  | 'highlight'
  | 'ellipse'
  | 'image'
  | 'signature'
  | 'ink';

export interface BaseElement {
  id: string;
  type: ElementType;
  /** view-point geometry (top-left origin, scale 1) */
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  /** z-order within the page; higher renders on top */
  z: number;
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  family: FontFamilyKey;
  /** font size in points */
  size: number;
  bold: boolean;
  italic: boolean;
  /** hex color e.g. #1a1a1a */
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  /**
   * Set when this text element *replaces* existing PDF text. The bake layer first
   * paints `coverColor` behind the text to hide the original glyphs (true
   * in-place editing). The color is sampled from the page background by the editor.
   */
  coverColor?: string;
  /**
   * Optional id of an extracted embedded font (see fonts.ts FontStore). When present
   * the bake layer embeds the *original* font so the replacement matches exactly.
   */
  embeddedFontId?: string;
}

export interface RectElement extends BaseElement {
  type: 'rect';
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  radius: number;
}

export interface EllipseElement extends BaseElement {
  type: 'ellipse';
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
}

export interface HighlightElement extends BaseElement {
  type: 'highlight';
  /** hex color; alpha is applied via opacity + multiply blend */
  color: string;
}

export interface ImageElement extends BaseElement {
  type: 'image' | 'signature';
  /** data URL (png or jpeg) */
  src: string;
  /** intrinsic aspect ratio, used to keep proportions while resizing */
  aspect: number;
}

export interface InkElement extends BaseElement {
  type: 'ink';
  /** points are stored in view-point space, absolute (not offset) */
  points: { x: number; y: number }[];
  color: string;
  strokeWidth: number;
}

export type AnyElement =
  | TextElement
  | RectElement
  | EllipseElement
  | HighlightElement
  | ImageElement
  | InkElement;

type AllKeys<T> = T extends unknown ? keyof T : never;
type Lookup<T, K extends PropertyKey> = T extends unknown ? (K extends keyof T ? T[K] : never) : never;

/**
 * A partial update for any element: every key optional, each value typed as the
 * union of that key across element types. Unlike `Partial<AnyElement>` (which only
 * exposes the keys common to all members) this lets callers patch type-specific
 * props like `fill`, `text` or `points` while staying type-safe.
 */
export type ElementPatch = { [K in AllKeys<AnyElement>]?: Lookup<AnyElement, K> };

/** Per-page editable state held outside the binary PDF until export. */
export interface PageModel {
  /** stable id so reordering never confuses React keys */
  id: string;
  /** index into the *current* pdf-lib document */
  sourceIndex: number;
  /** rotation applied on top of the page's own /Rotate, in degrees (0/90/180/270) */
  addedRotation: number;
  width: number;
  height: number;
  elements: AnyElement[];
}

/** A detected run of existing PDF text (from pdf.js), in view-point space. */
export interface TextRun {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  family: FontFamilyKey;
  bold: boolean;
  italic: boolean;
  /** pdf.js internal font name, used for embedded-font extraction */
  fontName: string;
}

/** A fillable AcroForm field. */
export interface FormField {
  name: string;
  kind: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'optionlist' | 'button' | 'signature';
  value: string | boolean | string[];
  options?: string[];
  readOnly: boolean;
  pageIndex: number;
  /** widget rect in view-point space for the field's first widget */
  rect?: { x: number; y: number; width: number; height: number };
}

export type ExportQuality = 'original';
