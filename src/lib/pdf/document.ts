import { PDFDocument } from 'pdf-lib';
import { loadPdfjs, type PDFDocumentProxy, type PDFPageProxy } from './render';
import { readFields, formDiagnostics } from './forms';
import {
  exportRebuild,
  exportInPlace,
  isIdentityArrangement,
  BLANK_SOURCE,
  type ExportPageSpec,
  type ExportOptions,
} from './pages';
import type { FormField } from './types';

interface Source {
  key: string;
  bytes: Uint8Array;
  pdflib: PDFDocument; // cached, read-only (form reading, page sizes)
  pdfjs: PDFDocumentProxy; // rendering + text extraction
  pageCount: number;
}

export interface LoadedSource {
  key: string;
  pageCount: number;
}

/**
 * Engine that keeps pdf-lib (editing) and pdf.js (rendering) in sync for one or
 * more source PDFs. The original bytes are retained per source so every export
 * starts from a pristine, un-mutated document — exports never compound.
 */
export class PdfEngine {
  private sources = new Map<string, Source>();
  private importSeq = 0;

  get main(): Source {
    const m = this.sources.get('main');
    if (!m) throw new Error('Kein Dokument geladen');
    return m;
  }

  hasMain(): boolean {
    return this.sources.has('main');
  }

  async loadMain(bytes: Uint8Array): Promise<LoadedSource> {
    await this.disposeAll();
    const src = await this.makeSource('main', bytes);
    this.sources.set('main', src);
    return { key: 'main', pageCount: src.pageCount };
  }

  async addImport(bytes: Uint8Array): Promise<LoadedSource> {
    const key = `import:${++this.importSeq}`;
    const src = await this.makeSource(key, bytes);
    this.sources.set(key, src);
    return { key, pageCount: src.pageCount };
  }

  private async makeSource(key: string, bytes: Uint8Array): Promise<Source> {
    const pdflib = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const pdfjs = await loadPdfjs(bytes);
    return { key, bytes, pdflib, pdfjs, pageCount: pdflib.getPageCount() };
  }

  getSource(key: string): Source | undefined {
    return this.sources.get(key);
  }

  async getPage(sourceKey: string, index: number): Promise<PDFPageProxy> {
    const src = this.sources.get(sourceKey);
    if (!src) throw new Error(`Unbekannte Quelle ${sourceKey}`);
    return src.pdfjs.getPage(index + 1);
  }

  pageSize(sourceKey: string, index: number): { width: number; height: number } {
    const src = this.sources.get(sourceKey);
    if (!src) throw new Error(`Unbekannte Quelle ${sourceKey}`);
    return src.pdflib.getPage(index).getSize();
  }

  readFormFields(): FormField[] {
    if (!this.hasMain()) return [];
    try {
      return readFields(this.main.pdflib);
    } catch (err) {
      console.warn('readFormFields failed', err);
      return [];
    }
  }

  /** Why a form may show no editable fields (e.g. XFA-only documents). */
  formInfo(): { acroFieldCount: number; hasXfa: boolean } {
    if (!this.hasMain()) return { acroFieldCount: 0, hasXfa: false };
    try {
      return formDiagnostics(this.main.pdflib);
    } catch {
      return { acroFieldCount: 0, hasXfa: false };
    }
  }

  /** Produce the final, edited PDF bytes for download. */
  async export(specs: ExportPageSpec[], options: ExportOptions = {}): Promise<Uint8Array> {
    const usedKeys = new Set(specs.map((s) => s.sourceKey).filter((k) => k !== BLANK_SOURCE));
    // A new document with no source PDF (only blank pages) always takes the rebuild
    // path, which assembles fresh blank pages and bakes the overlays onto them.
    const identity = this.hasMain() && isIdentityArrangement(specs, this.main.pageCount) && usedKeys.size <= 1;

    if (identity) {
      const fresh = await PDFDocument.load(this.main.bytes, { ignoreEncryption: true, updateMetadata: false });
      return exportInPlace(fresh, specs, options);
    }

    const fresh: Record<string, PDFDocument> = {};
    for (const key of usedKeys) {
      const src = this.sources.get(key);
      if (src) fresh[key] = await PDFDocument.load(src.bytes, { ignoreEncryption: true, updateMetadata: false });
    }
    return exportRebuild(specs, fresh, options);
  }

  async disposeAll(): Promise<void> {
    for (const s of this.sources.values()) {
      try {
        await (s.pdfjs as unknown as { destroy(): Promise<void> }).destroy();
      } catch {
        /* ignore */
      }
    }
    this.sources.clear();
    this.importSeq = 0;
  }
}
