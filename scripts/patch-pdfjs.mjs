// Stage pdf.js's standard fonts + CMaps into public/ so the app can hand pdf.js a
// `standardFontDataUrl` / `cMapUrl` (see loadPdfjs in src/lib/pdf/render.ts). PDFs that use
// the 14 non-embedded standard fonts (Helvetica, Times, …) need this data to resolve their
// fonts. Copied here (gitignored, regenerated on every install) rather than committing the
// ~185 binary files. Runs from "postinstall" so it is present locally and on the deploy host.
import { existsSync, cpSync, mkdirSync } from 'node:fs';

const assetCopies = [
  ['node_modules/pdfjs-dist/standard_fonts', 'public/pdfjs/standard_fonts'],
  ['node_modules/pdfjs-dist/cmaps', 'public/pdfjs/cmaps'],
];

let copied = 0;
for (const [from, to] of assetCopies) {
  if (!existsSync(from)) {
    console.warn(`[patch-pdfjs] ${from} not found — skipping (pdfjs layout may have changed).`);
    continue;
  }
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  copied++;
}
if (copied) console.log('[patch-pdfjs] staged pdf.js standard fonts + CMaps into public/pdfjs/.');
