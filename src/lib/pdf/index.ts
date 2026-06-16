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
export { standardFontFor, classifyFont, FontStore } from './fonts';
export {
  FONT_CATALOG,
  fontDef,
  baseFamilyOf,
  cssStackFor,
  fontFileUrl,
  injectFontFaces,
} from './fontCatalog';
export type { FontDef } from './fontCatalog';
export { readFields, applyFieldValues, finalizeForm, hasForm, formDiagnostics } from './forms';
export {
  loadPdfjs,
  renderPageToCanvas,
  extractTextRuns,
  groupRunsIntoLines,
  totalRotation,
  pageViewSize,
} from './render';
export type { PDFDocumentProxy, PDFPageProxy } from './render';
export * from './types';
