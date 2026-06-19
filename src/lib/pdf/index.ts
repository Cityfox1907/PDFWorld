export { PdfEngine } from './document';
export type { LoadedSource } from './document';
export {
  exportRebuild,
  exportInPlace,
  isIdentityArrangement,
  BLANK_SOURCE,
  A4_PORTRAIT,
} from './pages';
export type { ExportPageSpec, ExportOptions } from './pages';
export { Baker } from './bake';
export { makeToPdfPoint, placeBox, placeRotatedBox, rotateViewPoint, axisAngleDeg, snapRightAngle } from './coords';
export type { ToPdfPoint, BoxPlacement } from './coords';
export {
  standardFontFor,
  classifyFont,
  prettyFontName,
  compactFontName,
  isGenericFontLabel,
  isInternalFontName,
  FontStore,
  BASELINE_RATIO,
  firstBaselineOffset,
} from './fonts';
export {
  FONT_CATALOG,
  DEFAULT_FONT_KEY,
  fontDef,
  baseFamilyOf,
  cssStackFor,
  textFaceCss,
  fontFileUrl,
  matchCatalogFontKey,
  resolveFamilyKey,
  fontDisplayName,
  injectFontFaces,
} from './fontCatalog';
export type { FontDef, TextFaceCss } from './fontCatalog';
export { registerEmbeddedFont, embeddedFontFamily, getEmbeddedFont } from './embeddedFonts';
export type { EmbeddedFont } from './embeddedFonts';
export { shapeOutline, calloutOutline, calloutTailHeight, pointsToSvgPath, isStrokeOnlyShape, CALLOUT_PAD } from './shapes';
export type { Pt } from './shapes';
export { readFields, applyFieldValues, finalizeForm, hasForm, formDiagnostics } from './forms';
export {
  loadPdfjs,
  renderPageToCanvas,
  renderPageRegion,
  extractTextRuns,
  inspectFonts,
  groupRunsIntoLines,
  totalRotation,
  pageViewSize,
} from './render';
export type { PDFDocumentProxy, PDFPageProxy, FontInspection } from './render';
export * from './types';
