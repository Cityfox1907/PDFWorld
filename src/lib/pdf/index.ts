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
export { makeToPdfPoint, placeBox, axisAngleDeg, snapRightAngle } from './coords';
export type { ToPdfPoint, BoxPlacement } from './coords';
export { standardFontFor, classifyFont, prettyFontName, FontStore, BASELINE_RATIO } from './fonts';
export {
  FONT_CATALOG,
  DEFAULT_FONT_KEY,
  fontDef,
  baseFamilyOf,
  cssStackFor,
  fontFileUrl,
  injectFontFaces,
} from './fontCatalog';
export type { FontDef } from './fontCatalog';
export { registerEmbeddedFont, embeddedFontFamily, getEmbeddedFont } from './embeddedFonts';
export type { EmbeddedFont } from './embeddedFonts';
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
