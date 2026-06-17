/**
 * Headless engine tests (run with `npm run test:engine`).
 *
 * These exercise the pure, DOM-free core: coordinate transforms, the bake layer,
 * page assembly (reorder / merge / blank / duplicate / rotate) and form flatten.
 * Text is read back with pdf.js to PROVE the original content survives export —
 * the whole point of the "no quality loss" requirement.
 */
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { makeToPdfPoint, placeBox, placeRotatedBox } from '../src/lib/pdf/coords.ts';
import { exportInPlace, exportRebuild, isIdentityArrangement, BLANK_SOURCE, type ExportPageSpec } from '../src/lib/pdf/pages.ts';
import { cssStackFor, fontDef, DEFAULT_FONT_KEY, baseFamilyOf, matchCatalogFontKey } from '../src/lib/pdf/fontCatalog.ts';
import { classifyFont, prettyFontName } from '../src/lib/pdf/fonts.ts';
import { registerEmbeddedFont, getEmbeddedFont, embeddedFontFamily } from '../src/lib/pdf/embeddedFonts.ts';
import type { AnyElement } from '../src/lib/pdf/types.ts';

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗ ${name}\x1b[0m ${detail}`);
  }
}

function approx(a: number, b: number, eps = 0.01): boolean {
  return Math.abs(a - b) <= eps;
}

async function makeSamplePdf(labels: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const label of labels) {
    const page = doc.addPage([400, 600]);
    page.drawText(label, { x: 50, y: 540, size: 24, font, color: rgb(0, 0, 0) });
  }
  return doc.save();
}

async function makeFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 600]);
  const form = doc.getForm();
  const field = form.createTextField('vorname');
  field.addToPage(page, { x: 50, y: 500, width: 200, height: 24 });
  return doc.save();
}

/** Extract concatenated text per page using the Node-compatible pdf.js build. */
async function extractText(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: true });
  const doc = await task.promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    out.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  await task.destroy();
  return out;
}

const textEl = (over: Partial<AnyElement> = {}): AnyElement =>
  ({
    id: 't1',
    type: 'text',
    x: 50,
    y: 50,
    width: 200,
    height: 30,
    opacity: 1,
    z: 1,
    text: 'HELLO',
    family: 'sans',
    size: 18,
    bold: false,
    italic: false,
    color: '#000000',
    align: 'left',
    lineHeight: 1.2,
    ...over,
  }) as AnyElement;

async function run(): Promise<void> {
  console.log('\n\x1b[1mPDFWorld engine tests\x1b[0m\n');

  // ── coordinate transforms ──
  console.log('coords');
  {
    const W = 400;
    const H = 600;
    const r0 = makeToPdfPoint(W, H, 0);
    ok('rot0 maps top-left to (0,H)', approx(r0(0, 0)[0], 0) && approx(r0(0, 0)[1], 600));
    ok('rot0 maps bottom-left to (0,0)', approx(r0(0, 600)[0], 0) && approx(r0(0, 600)[1], 0));

    const r90 = makeToPdfPoint(W, H, 90);
    ok('rot90 maps (vx,vy)->(vy,vx)', approx(r90(10, 20)[0], 20) && approx(r90(10, 20)[1], 10));

    const r180 = makeToPdfPoint(W, H, 180);
    ok('rot180 maps (vx,vy)->(W-vx,vy)', approx(r180(10, 20)[0], 390) && approx(r180(10, 20)[1], 20));

    const r270 = makeToPdfPoint(W, H, 270);
    ok('rot270 maps (vx,vy)->(W-vy,H-vx)', approx(r270(10, 20)[0], 380) && approx(r270(10, 20)[1], 590));

    const box0 = placeBox(r0, 50, 50, 200, 30);
    ok('placeBox rot0 size+pos', approx(box0.x, 50) && approx(box0.y, 520) && approx(box0.width, 200) && approx(box0.height, 30) && box0.rotateDeg === 0);

    const box90 = placeBox(r90, 50, 50, 200, 30);
    ok('placeBox rot90 width/height preserved', approx(box90.width, 200) && approx(box90.height, 30) && box90.rotateDeg === 90);

    // Free element rotation composes on top of the page's right angle.
    const rb0 = placeRotatedBox(r0, 50, 50, 200, 30, 0);
    ok('placeRotatedBox(0°) equals placeBox', approx(rb0.x, 50) && approx(rb0.y, 520) && approx(rb0.width, 200) && approx(rb0.height, 30) && approx(rb0.rotateDeg, 0));
    const rb90 = placeRotatedBox(r0, 50, 50, 200, 30, 90);
    // A clockwise screen rotation is CCW in content space (y is flipped on export).
    ok('placeRotatedBox(90°) tilts to -90° in content space', approx(rb90.rotateDeg, -90) && approx(rb90.width, 200) && approx(rb90.height, 30));
    const rb45 = placeRotatedBox(r0, 50, 50, 200, 30, 45);
    ok('placeRotatedBox keeps side lengths under tilt', approx(rb45.width, 200) && approx(rb45.height, 30) && approx(rb45.rotateDeg, -45));
  }

  // ── font catalogue + original-font capture ──
  console.log('\nfonts (catalogue + original-font capture)');
  {
    ok('default font is Arial', DEFAULT_FONT_KEY === 'arial');
    ok('Arial maps to the sans metric family', baseFamilyOf('arial') === 'sans');
    ok('Arial preview stack names Arial', /arial/i.test(cssStackFor('arial')));
    ok('Times New Roman is a serif system font', fontDef('times-new-roman').base === 'serif' && fontDef('times-new-roman').group === 'system');
    ok('unknown font key falls back to Arial', fontDef('does-not-exist').key === 'arial');

    const data = new Uint8Array([1, 2, 3, 4]);
    registerEmbeddedFont({ id: 'src#0#f7', data, mimetype: 'font/opentype' });
    ok('captured original font bytes are retrievable for export', getEmbeddedFont('src#0#f7')?.data === data);
    ok('no @font-face family without a DOM (graceful)', embeddedFontFamily('src#0#f7') === undefined);
    ok('uncaptured id returns nothing', getEmbeddedFont('missing') === undefined);
  }

  // ── scan font classification + catalogue matching (the "two fonts" bug) ──
  console.log('\nfonts (scan classification + name matching)');
  {
    // The core regression: the generic CSS family "sans-serif" must NOT be read as
    // serif just because its compact form "sansserif" contains "serif".
    ok('generic "sans-serif" classifies as sans', classifyFont('sans-serif').family === 'sans');
    ok('generic "serif" classifies as serif', classifyFont('serif').family === 'serif');
    ok('generic "monospace" classifies as mono', classifyFont('monospace').family === 'mono');
    ok('subset Arial classifies as sans + bold', classifyFont('ABCDEE+Arial-BoldMT').family === 'sans' && classifyFont('ABCDEE+Arial-BoldMT').bold);
    ok('Times New Roman italic classifies as serif + italic', classifyFont('TimesNewRomanPS-ItalicMT').family === 'serif' && classifyFont('TimesNewRomanPS-ItalicMT').italic);
    ok('Courier classifies as mono', classifyFont('CourierNewPSMT').family === 'mono');

    // Precise name → catalogue key, so the panel shows the real font (not a generic).
    ok('ArialMT → arial', matchCatalogFontKey('ArialMT') === 'arial');
    ok('subset Arial-BoldMT → arial', matchCatalogFontKey('XYZABC+Arial-BoldMT') === 'arial');
    ok('TimesNewRomanPS-BoldMT → times-new-roman', matchCatalogFontKey('TimesNewRomanPS-BoldMT') === 'times-new-roman');
    ok('Helvetica-Oblique → helvetica', matchCatalogFontKey('Helvetica-Oblique') === 'helvetica');
    ok('Roboto-Medium → roboto', matchCatalogFontKey('Roboto-Medium') === 'roboto');
    ok('CalibriBold → calibri', matchCatalogFontKey('CalibriBold') === 'calibri');
    ok('a matched key carries the right metric family', baseFamilyOf(matchCatalogFontKey('TimesNewRomanPSMT')!) === 'serif');
    ok('generic "sans-serif" is NOT mis-matched to a font', matchCatalogFontKey('sans-serif') === null);

    // Friendly labels keep a generic family readable instead of "sans serif".
    ok('prettyFontName maps generic sans-serif → Sans-Serif', prettyFontName('sans-serif') === 'Sans-Serif');
    ok('prettyFontName strips subset prefix', prettyFontName('ABCDEE+Arial') === 'Arial');
  }

  // ── in-place export preserves original text + adds overlay ──
  console.log('\nexportInPlace (identity, form-safe path)');
  {
    const sample = await makeSamplePdf(['ALPHA', 'BETA']);
    const fresh = await PDFDocument.load(sample);
    const specs: ExportPageSpec[] = [
      { sourceKey: 'main', sourceIndex: 0, addedRotation: 0, elements: [textEl()] },
      { sourceKey: 'main', sourceIndex: 1, addedRotation: 0, elements: [] },
    ];
    ok('arrangement detected as identity', isIdentityArrangement(specs, 2));
    const out = await exportInPlace(fresh, specs, {});
    const reread = await PDFDocument.load(out);
    ok('page count preserved (2)', reread.getPageCount() === 2);
    const text = await extractText(out);
    ok('original text ALPHA preserved', text[0].includes('ALPHA'));
    ok('overlay text HELLO baked onto page 1', text[0].includes('HELLO'));
    ok('page 2 text BETA preserved', text[1].includes('BETA'));
  }

  // ── rebuild: reorder ──
  console.log('\nexportRebuild (reorder)');
  {
    const sample = await makeSamplePdf(['ALPHA', 'BETA']);
    const main = await PDFDocument.load(sample);
    const specs: ExportPageSpec[] = [
      { sourceKey: 'main', sourceIndex: 1, addedRotation: 0, elements: [] },
      { sourceKey: 'main', sourceIndex: 0, addedRotation: 0, elements: [] },
    ];
    ok('reorder is NOT identity', !isIdentityArrangement(specs, 2));
    const out = await exportRebuild(specs, { main }, {});
    const text = await extractText(out);
    ok('page 1 now BETA', text[0].includes('BETA'));
    ok('page 2 now ALPHA', text[1].includes('ALPHA'));
  }

  // ── rebuild: blank insertion ──
  console.log('\nexportRebuild (blank insert)');
  {
    const sample = await makeSamplePdf(['ALPHA', 'BETA']);
    const main = await PDFDocument.load(sample);
    const specs: ExportPageSpec[] = [
      { sourceKey: 'main', sourceIndex: 0, addedRotation: 0, elements: [] },
      { sourceKey: BLANK_SOURCE, sourceIndex: 0, addedRotation: 0, blankSize: { width: 400, height: 600 }, elements: [textEl({ text: 'INSERTED' })] },
      { sourceKey: 'main', sourceIndex: 1, addedRotation: 0, elements: [] },
    ];
    const out = await exportRebuild(specs, { main }, {});
    const reread = await PDFDocument.load(out);
    ok('three pages after insert', reread.getPageCount() === 3);
    const text = await extractText(out);
    ok('inserted blank carries overlay text', text[1].includes('INSERTED'));
  }

  // ── rebuild: duplicate ──
  console.log('\nexportRebuild (duplicate page)');
  {
    const sample = await makeSamplePdf(['ALPHA', 'BETA']);
    const main = await PDFDocument.load(sample);
    const specs: ExportPageSpec[] = [
      { sourceKey: 'main', sourceIndex: 0, addedRotation: 0, elements: [] },
      { sourceKey: 'main', sourceIndex: 0, addedRotation: 0, elements: [] },
    ];
    const out = await exportRebuild(specs, { main }, {});
    const reread = await PDFDocument.load(out);
    ok('duplicate yields 2 pages', reread.getPageCount() === 2);
    const text = await extractText(out);
    ok('both pages are ALPHA', text[0].includes('ALPHA') && text[1].includes('ALPHA'));
  }

  // ── merge two sources ──
  console.log('\nexportRebuild (merge sources)');
  {
    const a = await PDFDocument.load(await makeSamplePdf(['ALPHA']));
    const b = await PDFDocument.load(await makeSamplePdf(['GAMMA']));
    const specs: ExportPageSpec[] = [
      { sourceKey: 'main', sourceIndex: 0, addedRotation: 0, elements: [] },
      { sourceKey: 'import:1', sourceIndex: 0, addedRotation: 0, elements: [] },
    ];
    const out = await exportRebuild(specs, { main: a, 'import:1': b }, {});
    const text = await extractText(out);
    ok('merged page 1 ALPHA', text[0].includes('ALPHA'));
    ok('merged page 2 GAMMA from second source', text[1].includes('GAMMA'));
  }

  // ── rotation ──
  console.log('\nrotation');
  {
    const sample = await makeSamplePdf(['ALPHA']);
    const fresh = await PDFDocument.load(sample);
    const specs: ExportPageSpec[] = [
      { sourceKey: 'main', sourceIndex: 0, addedRotation: 90, elements: [textEl({ text: 'ROT' })] },
    ];
    const out = await exportInPlace(fresh, specs, {});
    const reread = await PDFDocument.load(out);
    ok('page rotation is 90', reread.getPage(0).getRotation().angle === 90);
    const text = await extractText(out);
    ok('text still present after rotation', text[0].includes('ALPHA') && text[0].includes('ROT'));
  }

  // ── free element rotation bakes without throwing and keeps text ──
  console.log('\nfree rotation (per-element)');
  {
    const fresh = await PDFDocument.load(await makeSamplePdf(['ALPHA']));
    const els: AnyElement[] = [
      textEl({ id: 'rt', text: 'TILTED', x: 60, y: 200, rotation: 30 } as Partial<AnyElement>),
      { id: 'rr', type: 'rect', x: 200, y: 200, width: 80, height: 40, opacity: 1, z: 2, fill: '#3366ff', stroke: null, strokeWidth: 0, radius: 0, rotation: -20 } as AnyElement,
      { id: 'rk', type: 'ink', x: 40, y: 360, width: 100, height: 50, opacity: 1, z: 3, points: [{ x: 40, y: 360 }, { x: 140, y: 410 }], color: '#cc0033', strokeWidth: 3, rotation: 15 } as AnyElement,
    ];
    const out = await exportInPlace(fresh, [{ sourceKey: 'main', sourceIndex: 0, addedRotation: 0, elements: els }], {});
    const reread = await PDFDocument.load(out);
    ok('rotated elements still load', reread.getPageCount() === 1);
    const text = await extractText(out);
    ok('rotated text baked + original intact', text[0].includes('TILTED') && text[0].includes('ALPHA'));
  }

  // ── every element type bakes without throwing and stays loadable ──
  console.log('\nbake all element types');
  {
    const PNG_1x1 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const fresh = await PDFDocument.load(await makeSamplePdf(['ALPHA']));
    const els: AnyElement[] = [
      { id: 'r', type: 'rect', x: 20, y: 20, width: 80, height: 40, opacity: 0.8, z: 1, fill: '#ffcc00', stroke: '#333333', strokeWidth: 2, radius: 0 },
      { id: 'e', type: 'ellipse', x: 120, y: 20, width: 60, height: 60, opacity: 1, z: 2, fill: null, stroke: '#0a84ff', strokeWidth: 1.5 },
      { id: 'h', type: 'highlight', x: 40, y: 120, width: 120, height: 18, opacity: 0.4, z: 3, color: '#ffe24d' },
      { id: 'k', type: 'ink', x: 40, y: 200, width: 100, height: 50, opacity: 1, z: 4, points: [ { x: 40, y: 200 }, { x: 90, y: 250 }, { x: 140, y: 200 } ], color: '#cc0033', strokeWidth: 3 },
      // Highlighter pen: a single translucent Multiply stroke (drawSvgPath path).
      { id: 'hp', type: 'ink', x: 40, y: 160, width: 130, height: 24, opacity: 0.4, z: 4.5, points: [ { x: 40, y: 168 }, { x: 100, y: 176 }, { x: 168, y: 162 } ], color: '#ffe24d', strokeWidth: 14, highlight: true },
      { id: 'i', type: 'image', x: 200, y: 200, width: 60, height: 60, opacity: 1, z: 5, src: PNG_1x1, aspect: 1 },
      { id: 's', type: 'signature', x: 200, y: 300, width: 120, height: 40, opacity: 1, z: 6, src: PNG_1x1, aspect: 3 },
      textEl({ id: 'm', text: 'MULTI\nLINE', align: 'center', x: 60, y: 300 }),
      textEl({ id: 'cov', text: 'REPLACED', x: 60, y: 360, coverColor: '#ffffff' }),
      // A scanned edit referencing an original font that ISN'T available here:
      // the bake layer must fall back to the standard font, never break export.
      { ...textEl({ id: 'emb', text: 'ORIGINAL', x: 60, y: 420, coverColor: '#ffffff' }), embeddedFontId: 'missing#0#g_d0_f1' } as AnyElement,
    ];
    const out = await exportInPlace(fresh, [{ sourceKey: 'main', sourceIndex: 0, addedRotation: 0, elements: els }], {});
    const reread = await PDFDocument.load(out);
    ok('document still loads with all element types', reread.getPageCount() === 1);
    const text = await extractText(out);
    ok('original text + baked multiline text present', text[0].includes('ALPHA') && text[0].includes('MULTI'));
    ok('cover-replaced text baked', text[0].includes('REPLACED'));
    ok('missing embedded font falls back to standard', text[0].includes('ORIGINAL'));
  }

  // ── forms: fill + flatten ──
  console.log('\nforms (fill + flatten on rebuild)');
  {
    const formDoc = await PDFDocument.load(await makeFormPdf());
    const specs: ExportPageSpec[] = [
      { sourceKey: 'main', sourceIndex: 0, addedRotation: 0, elements: [] },
      { sourceKey: BLANK_SOURCE, sourceIndex: 0, addedRotation: 0, blankSize: { width: 400, height: 600 }, elements: [] },
    ];
    const out = await exportRebuild(specs, { main: formDoc }, { formValues: { vorname: 'Fikret' } });
    const reread = await PDFDocument.load(out);
    ok('form flattened (no fields remain)', reread.getForm().getFields().length === 0);
    const text = await extractText(out);
    ok('filled value Fikret baked into page', text[0].includes('Fikret'));
  }

  console.log(`\n\x1b[1mResult:\x1b[0m \x1b[32m${passed} passed\x1b[0m, ${failed ? `\x1b[31m${failed} failed\x1b[0m` : '0 failed'}\n`);
  if (failed) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
