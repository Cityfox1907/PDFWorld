// Patch a crash in pdfjs-dist 6.0.227 that breaks text scanning on some PDFs.
//
// pdf.js's compileType3Glyph() does `for (const elem of img)` over a Type3 glyph's
// image data. When a Type3 font has a glyph whose image `data` is undefined, that loop
// throws "undefined is not a function" inside the worker, which makes page.getTextContent()
// reject — so the scan tool reports "Text konnte nicht gescannt werden" and finds nothing.
//
// The fix is a one-line guard: return null when the data is missing. The caller already
// handles a null result gracefully (it warns "Cannot compile Type3 glyph" and carries on),
// so this turns a hard crash into the existing, harmless fallback path. It is applied to
// both worker builds; the app loads the minified one.
//
// Runs from "postinstall" so it survives `npm install` locally and on the deploy host.
// Idempotent and non-fatal: if a future pdfjs version no longer matches (e.g. after an
// upgrade), it logs a notice and exits 0 rather than breaking the install — at which point
// this script should be revisited (the upstream bug may have been fixed).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const targets = [
  {
    file: 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
    anchor: 'function compileType3Glyph({data:e,width:t,height:a}){',
    guard: 'if(!e)return null;',
  },
  {
    file: 'node_modules/pdfjs-dist/build/pdf.worker.mjs',
    anchor: 'function compileType3Glyph({\n  data: img,\n  width,\n  height\n}) {\n',
    guard: '  if (!img) {\n    return null;\n  }\n',
  },
];

let patched = 0;
let missing = 0;
for (const { file, anchor, guard } of targets) {
  if (!existsSync(file)) {
    console.warn(`[patch-pdfjs] ${file} not found — skipping.`);
    missing++;
    continue;
  }
  const src = readFileSync(file, 'utf8');
  if (src.includes(anchor + guard)) continue; // already patched
  if (!src.includes(anchor)) {
    console.warn(`[patch-pdfjs] anchor not found in ${file} — pdfjs may have changed; skipping.`);
    missing++;
    continue;
  }
  writeFileSync(file, src.replace(anchor, anchor + guard));
  patched++;
}

if (patched) console.log(`[patch-pdfjs] applied Type3-glyph crash guard to ${patched} worker file(s).`);
if (missing) console.warn('[patch-pdfjs] some targets were skipped — review scripts/patch-pdfjs.mjs after a pdfjs upgrade.');
