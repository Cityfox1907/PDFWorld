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

/** The three metric families that always map to an embeddable PDF standard font. */
export type BaseFamily = 'sans' | 'serif' | 'mono';

/**
 * A font identity. This is a key into the font catalogue (see fontCatalog.ts):
 * the three base families ('sans' | 'serif' | 'mono') plus the curated set of
 * popular web fonts ('roboto', 'montserrat', …). Kept as a widened string so the
 * catalogue can grow without touching the data model.
 */
export type FontFamilyKey = string;

export type ElementType =
  | 'text'
  | 'rect'
  | 'highlight'
  | 'ellipse'
  | 'shape'
  | 'callout'
  | 'image'
  | 'signature'
  | 'ink';

/**
 * The vector shapes offered under the "Elemente" menu, in addition to the
 * dedicated rectangle and ellipse element types. Each is drawn from a single
 * geometry helper (see shapes.ts) so screen and export match exactly.
 */
export type ShapeKind = 'triangle' | 'diamond' | 'star' | 'arrow' | 'line';

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
  /**
   * Clockwise rotation in degrees around the element's own centre (screen space).
   * Optional/absent means 0 (no rotation) so existing data and the engine tests
   * stay byte-for-byte unchanged.
   */
  rotation?: number;
  /**
   * When true the element is locked: it can't be moved, resized or edited until it
   * is unlocked again, so a finished placement can't be nudged by accident.
   */
  locked?: boolean;
  /**
   * When true the element is hidden: it isn't rendered on the canvas and is skipped
   * on export. Toggled from the Elements/Layers panel so a stack of edits can be
   * hidden to declutter the page without deleting anything.
   */
  hidden?: boolean;
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
   * Optional list rendering: every line is prefixed with a bullet ('•') or an
   * incrementing number ('1.', '2.', …) on screen and on export. Absent/'none'
   * keeps plain text.
   */
  list?: 'none' | 'bullet' | 'number';
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

export interface ShapeElement extends BaseElement {
  type: 'shape';
  shape: ShapeKind;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  /** stroke style for outlines and the line/arrow shapes */
  dash?: 'solid' | 'dashed' | 'dotted';
  /** for the 'line' shape: true ⇒ runs top-right → bottom-left (drag direction) */
  flip?: boolean;
}

/**
 * A speech-bubble / comment annotation: a rounded bubble with a small tail that
 * holds editable text — for remarks placed on the page like a sticky note.
 */
export interface CalloutElement extends BaseElement {
  type: 'callout';
  text: string;
  family: FontFamilyKey;
  size: number;
  bold: boolean;
  italic: boolean;
  /** text colour */
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  /** bubble fill */
  fill: string;
  /** bubble border (null = no border) */
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
  /** optional decorative border drawn around the image (screen + export) */
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
}

export interface InkElement extends BaseElement {
  type: 'ink';
  /** points are stored in view-point space, absolute (not offset) */
  points: { x: number; y: number }[];
  color: string;
  strokeWidth: number;
  /**
   * When true this freehand stroke is a *highlighter* (the marker tool's pen mode):
   * it is drawn semi-transparent with a Multiply blend so the text underneath stays
   * readable, exactly like a real highlighter. Absent/false means a normal opaque
   * ink line (the pen/draw tool or the background brush).
   */
  highlight?: boolean;
  /**
   * Stroke style for the drawing tool. 'solid' (or absent) is a continuous line;
   * 'dashed' and 'dotted' render a patterned stroke both on screen and on export.
   */
  dash?: 'solid' | 'dashed' | 'dotted';
}

export type AnyElement =
  | TextElement
  | RectElement
  | EllipseElement
  | ShapeElement
  | CalloutElement
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
  /** id of the captured original font (see embeddedFonts.ts), when embedded */
  embeddedFontId?: string;
  /** human-friendly typeface name read from the PDF (subset prefix stripped) */
  fontLabel?: string;
  /** true when the source PDF embeds this font (so it can be reused 1:1) */
  embedded?: boolean;
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
