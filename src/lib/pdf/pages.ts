import { PDFDocument, PDFPage, degrees } from 'pdf-lib';
import type { AnyElement } from './types';
import { Baker } from './bake';
import { makeToPdfPoint } from './coords';
import { applyFieldValues, finalizeForm, hasForm } from './forms';

export const BLANK_SOURCE = '__blank__';
export const A4_PORTRAIT = { width: 595.28, height: 841.89 };

export interface ExportPageSpec {
  sourceKey: string;
  sourceIndex: number;
  addedRotation: number;
  blankSize?: { width: number; height: number };
  elements: AnyElement[];
}

export interface ExportOptions {
  formValues?: Record<string, string | boolean | string[]>;
  flattenForm?: boolean;
}

async function bakePage(out: Baker, page: PDFPage, addedRotation: number, elements: AnyElement[]): Promise<void> {
  if (addedRotation % 360 !== 0) {
    const base = page.getRotation().angle;
    page.setRotation(degrees((base + addedRotation) % 360));
  }
  const size = page.getSize();
  const rot = page.getRotation().angle;
  const toPdfPoint = makeToPdfPoint(size.width, size.height, rot);
  await out.bakePage(page, elements, toPdfPoint);
}

/**
 * Rebuild path: assemble a new document from (possibly reordered / merged /
 * duplicated / blank) pages via copyPages — the only lossless way to reorder and
 * merge. Original page content streams are copied intact; we only add overlays.
 * Interactive AcroForms cannot survive copyPages, so any form is flattened first.
 */
export async function exportRebuild(
  specs: ExportPageSpec[],
  sources: Record<string, PDFDocument>,
  options: ExportOptions = {},
): Promise<Uint8Array> {
  // Bake form values into source docs and flatten so they persist through copyPages.
  for (const [key, doc] of Object.entries(sources)) {
    if (!hasForm(doc)) continue;
    if (key === 'main' && options.formValues) applyFieldValues(doc, options.formValues);
    await finalizeForm(doc, true);
  }

  const out = await PDFDocument.create();
  const baker = new Baker(out);

  // Batch-copy unique pages per source to deduplicate shared fonts/images.
  const copiedBySource = new Map<string, Map<number, PDFPage>>();
  for (const [key, doc] of Object.entries(sources)) {
    const needed = new Set<number>();
    specs.forEach((s) => {
      if (s.sourceKey === key) needed.add(s.sourceIndex);
    });
    if (!needed.size) continue;
    const indices = [...needed].sort((a, b) => a - b);
    const copied = await out.copyPages(doc, indices);
    const map = new Map<number, PDFPage>();
    indices.forEach((idx, i) => map.set(idx, copied[i]));
    copiedBySource.set(key, map);
  }

  const used = new Map<string, Set<number>>();
  for (const spec of specs) {
    let page: PDFPage;
    if (spec.sourceKey === BLANK_SOURCE) {
      const size = spec.blankSize ?? A4_PORTRAIT;
      page = out.addPage([size.width, size.height]);
    } else {
      const usedSet = used.get(spec.sourceKey) ?? new Set<number>();
      let candidate = copiedBySource.get(spec.sourceKey)?.get(spec.sourceIndex);
      if (!candidate || usedSet.has(spec.sourceIndex)) {
        // Duplicated page: copy a fresh instance.
        const fresh = await out.copyPages(sources[spec.sourceKey], [spec.sourceIndex]);
        candidate = fresh[0];
      } else {
        usedSet.add(spec.sourceIndex);
        used.set(spec.sourceKey, usedSet);
      }
      page = out.addPage(candidate);
    }
    await bakePage(baker, page, spec.addedRotation, spec.elements);
  }

  return out.save({ useObjectStreams: true });
}

/**
 * In-place path: the page arrangement is unchanged (same single source, identity
 * order, no blanks). We keep the original document so interactive AcroForm fields
 * survive, only rotating pages, filling fields and baking overlays.
 */
export async function exportInPlace(
  mainDoc: PDFDocument,
  specs: ExportPageSpec[],
  options: ExportOptions = {},
): Promise<Uint8Array> {
  const baker = new Baker(mainDoc);
  const pages = mainDoc.getPages();

  for (const spec of specs) {
    const page = pages[spec.sourceIndex];
    if (!page) continue;
    await bakePage(baker, page, spec.addedRotation, spec.elements);
  }

  if (hasForm(mainDoc)) {
    if (options.formValues) applyFieldValues(mainDoc, options.formValues);
    await finalizeForm(mainDoc, options.flattenForm ?? false);
  }

  return mainDoc.save({ useObjectStreams: true });
}

/** True when the export can take the form-preserving in-place path. */
export function isIdentityArrangement(specs: ExportPageSpec[], mainPageCount: number): boolean {
  if (specs.length !== mainPageCount) return false;
  return specs.every((s, i) => s.sourceKey === 'main' && s.sourceIndex === i);
}
