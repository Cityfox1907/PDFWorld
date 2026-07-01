import { create } from 'zustand';
import {
  PdfEngine,
  BLANK_SOURCE,
  A4_PORTRAIT,
  type ExportPageSpec,
  type AnyElement,
  type ElementPatch,
  type FormField,
  type FontFamilyKey,
  type ShapeKind,
} from '../lib/pdf';
import { readFileBytes } from '../lib/utils/file';
import { uid } from '../lib/utils/id';
import { toHex } from '../lib/utils/color';

export type ToolId =
  | 'select'
  | 'edit-text'
  | 'text'
  | 'callout'
  | 'cut'
  | 'brush'
  | 'highlight'
  | 'draw'
  | 'rect'
  | 'ellipse'
  | 'shape'
  | 'redact'
  | 'image'
  | 'signature';

/** Highest magnification, mirrored by the clamp in PageCanvas. 2000 %. */
export const MAX_ZOOM = 20;
export const MIN_ZOOM = 0.25;

export interface EditorPage {
  id: string;
  sourceKey: string;
  sourceIndex: number;
  /** base /Rotate of the underlying page (sync, from pdf-lib) */
  baseRotation: number;
  /** extra rotation the user applied, multiple of 90 */
  addedRotation: number;
  /** unrotated media size in points */
  mediaWidth: number;
  mediaHeight: number;
  blank?: boolean;
  elements: AnyElement[];
}

export interface ToolDefaults {
  textColor: string;
  textFamily: FontFamilyKey;
  textSize: number;
  highlightColor: string;
  /** marker tool shape: a dragged rectangle, or a freehand highlighter pen */
  highlightMode: 'rect' | 'brush';
  /** width of the highlighter pen stroke, in view points */
  highlightWidth: number;
  drawColor: string;
  drawWidth: number;
  /** stroke opacity for the pen (0.05–1) */
  drawOpacity: number;
  /** line style for the pen: solid, dashed or dotted */
  drawDash: 'solid' | 'dashed' | 'dotted';
  shapeFill: string;
  shapeStroke: string;
  /** which vector shape the "Elemente" → shape tool draws */
  shapeKind: ShapeKind;
  /** region tool ("Ausschneiden") shape: a rectangle marquee or a freehand lasso */
  cutMode: 'rect' | 'lasso';
  /** region tool action: 'cut' covers the source area with the page background so the
   *  piece really moves away; 'copy' leaves the original visible (duplicate) */
  cutAction: 'cut' | 'copy';
  /** background brush shape: a freehand stroke, or a borderless filled rectangle */
  brushMode: 'brush' | 'rect';
  /** width of the background cover brush, in view points */
  brushWidth: number;
  /** last colour the brush sampled from the page (for the inspector preview) */
  brushColor: string;
}

interface Snapshot {
  pages: EditorPage[];
  formValues: Record<string, string | boolean | string[]>;
  selectedElementId: string | null;
  selectedElementIds: string[];
  currentPageId: string | null;
}

/**
 * A captured typeface armed by the scan tool ("In dieser Schrift schreiben"). Instead
 * of dropping a field immediately, the next click on the page places an empty text box
 * carrying exactly these properties — so the user chooses *where* the text lands.
 */
export interface PendingTextStyle {
  family: FontFamilyKey;
  size: number;
  bold: boolean;
  italic: boolean;
  color: string;
  lineHeight: number;
  embeddedFontId?: string;
  /** real typeface name of the adopted line, shown in the inspector after placing */
  fontLabel?: string;
}

interface StoreState {
  engine: PdfEngine;
  status: 'empty' | 'loading' | 'ready';
  error: string | null;
  fileName: string;
  fileSize: number;

  pages: EditorPage[];
  currentPageId: string | null;
  /** the "primary" selected element (drives the inspector); mirrors the last of the set */
  selectedElementId: string | null;
  /** every selected element id — a marquee or shift-click can select several at once */
  selectedElementIds: string[];
  /** A one-shot request (raised by the touch chrome, where there is no double-click) to
   *  begin inline text editing of an element. PageCanvas owns the real editing state and
   *  consumes this; the nonce lets the same element be re-requested. Not part of history. */
  editRequest: { id: string; n: number } | null;
  activeTool: ToolId;
  zoom: number;
  /** Active magnification clamp. Defaults to the module constants; the mobile shell
   *  raises minZoom to 1 so the page can never be pinched smaller than "fit". */
  minZoom: number;
  maxZoom: number;

  formFields: FormField[];
  formValues: Record<string, string | boolean | string[]>;
  flattenForm: boolean;
  /** true when the PDF carries an XFA form pdf-lib cannot fill (helps the UI explain it) */
  xfaForm: boolean;

  tool: ToolDefaults;
  /** Recently used / sampled colours, newest first — shared by every colour picker
   *  so a tone picked with the brush (or eyedropper) is reusable in new text. */
  recentColors: string[];
  /** Copied elements kept for paste (Cmd/Ctrl+C → V), across pages. */
  clipboard: AnyElement[];
  /** A typeface armed from the scan panel; the next click places a field in it. */
  pendingTextStyle: PendingTextStyle | null;
  /** Open image editor (crop), targeting an image element. */
  imageEditor: { id: string } | null;

  past: Snapshot[];
  future: Snapshot[];

  exporting: boolean;
  toast: { id: string; message: string; kind: 'info' | 'success' | 'error' } | null;

  // ── lifecycle ──
  loadFile: (file: File) => Promise<void>;
  mergeFile: (file: File) => Promise<void>;
  /** Start a brand-new, empty document with a single blank A4 page. */
  newDocument: () => Promise<void>;
  reset: () => Promise<void>;

  // ── tools / view ──
  setTool: (tool: ToolId) => void;
  setZoom: (zoom: number) => void;
  /** Adjust the magnification clamp (and re-clamp the current zoom into it). */
  setZoomLimits: (min: number, max: number) => void;
  setCurrentPage: (id: string) => void;
  selectElement: (id: string | null) => void;
  /** Replace the whole selection set (marquee / programmatic multi-select). */
  selectElements: (ids: string[]) => void;
  /** Ask PageCanvas to begin inline editing of a text/callout element (touch path). */
  requestTextEdit: (id: string) => void;
  /** Add or remove one element from the current selection (shift-click). */
  toggleElementSelection: (id: string) => void;
  setToolDefaults: (patch: Partial<ToolDefaults>) => void;
  /** Remember a colour at the front of the recent list (deduped, capped). */
  addRecentColor: (color: string) => void;
  /** Arm (or clear) the typeface that the next page click writes in. */
  setPendingTextStyle: (style: PendingTextStyle | null) => void;
  /** Open / close the image editor (crop) for an element. */
  openImageEditor: (id: string) => void;
  closeImageEditor: () => void;

  // ── elements ──
  addElement: (pageId: string, el: AnyElement) => void;
  /** Add several elements in ONE history step; selects `selectId` (else the last). */
  addElements: (pageId: string, els: AnyElement[], selectId?: string) => void;
  updateElement: (pageId: string, id: string, patch: ElementPatch) => void;
  deleteElement: (pageId: string, id: string) => void;
  /** Delete several elements in ONE history step (multi-selection). */
  deleteElements: (pageId: string, ids: string[]) => void;
  duplicateElement: (pageId: string, id: string) => void;
  /** Duplicate several elements in ONE history step (multi-selection). */
  duplicateElements: (pageId: string, ids: string[]) => void;
  reorderElement: (pageId: string, id: string, dir: 'front' | 'back') => void;
  /** Copy the selected element(s) to the in-app clipboard (no history change). */
  copyElements: (pageId: string, ids: string[]) => void;
  /** Paste the clipboard elements onto a page (slightly offset, selected). */
  pasteClipboard: (pageId: string) => void;

  // ── pages ──
  reorderPages: (fromIndex: number, toIndex: number) => void;
  /** Move a set of pages (kept in their current order) as one block in front of
   *  `beforeId`, or to the end when `beforeId` is null. One history step. */
  movePages: (ids: string[], beforeId: string | null) => void;
  deletePage: (id: string) => void;
  /** Delete several pages in ONE history step (never the very last remaining page). */
  deletePages: (ids: string[]) => void;
  duplicatePage: (id: string) => void;
  /** Duplicate several pages in ONE history step; the copies follow the block. */
  duplicatePages: (ids: string[]) => void;
  rotatePage: (id: string, delta: number) => void;
  /** Rotate several pages in ONE history step. */
  rotatePages: (ids: string[], delta: number) => void;
  insertBlankAfter: (id: string | null) => void;

  // ── forms ──
  setFormValue: (name: string, value: string | boolean | string[]) => void;
  setFlattenForm: (v: boolean) => void;

  // ── history ──
  commit: () => void;
  undo: () => void;
  redo: () => void;

  // ── export ──
  /** Build the final edited PDF bytes (the SaveDialog then writes/downloads them). */
  buildExportBytes: () => Promise<Uint8Array | null>;

  showToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
}

const DEFAULT_TOOL: ToolDefaults = {
  textColor: '#000000',
  textFamily: 'arial',
  textSize: 9,
  highlightColor: '#ffd84d',
  highlightMode: 'brush',
  highlightWidth: 16,
  drawColor: '#1a1a1a',
  drawWidth: 2.5,
  drawOpacity: 1,
  drawDash: 'solid',
  shapeFill: '#ffffff',
  shapeStroke: '#111111',
  shapeKind: 'triangle',
  cutMode: 'rect',
  cutAction: 'cut',
  brushMode: 'brush',
  brushWidth: 18,
  brushColor: '#ffffff',
};

function visibleSize(p: EditorPage): { width: number; height: number } {
  const rot = (((p.baseRotation + p.addedRotation) % 360) + 360) % 360;
  return rot % 180 === 0
    ? { width: p.mediaWidth, height: p.mediaHeight }
    : { width: p.mediaHeight, height: p.mediaWidth };
}

function clonePages(pages: EditorPage[]): EditorPage[] {
  return structuredClone(pages);
}

/**
 * A duplicated or pasted element must never inherit the page-anchored replacement
 * state of its source (scan tool): the copy is a free text box, not a second cover
 * over the same original line — otherwise deleting the original edit would still
 * leave the copy's invisible cover hiding the PDF text underneath.
 */
export function stripReplacement(el: AnyElement): AnyElement {
  if (el.type !== 'text' || (!el.coverColor && !el.replacesRun)) return el;
  const t = { ...el };
  delete t.coverColor;
  delete t.coverRect;
  delete t.replacesRun;
  return t;
}

/**
 * Deep copy of an element shifted by (dx, dy) — the base for duplicate & paste.
 * Ink points are absolute view-points, so they must shift WITH the box; otherwise the
 * copy's stroke stays glued to the original's position (and exports there) while its
 * selection box sits at the new one.
 */
function offsetCopy(el: AnyElement, dx: number, dy: number): AnyElement {
  const c = stripReplacement(structuredClone(el));
  c.x += dx;
  c.y += dy;
  if (c.type === 'ink') c.points = c.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  return c;
}

function snapshot(s: StoreState): Snapshot {
  return {
    pages: clonePages(s.pages),
    formValues: structuredClone(s.formValues),
    selectedElementId: s.selectedElementId,
    selectedElementIds: [...s.selectedElementIds],
    currentPageId: s.currentPageId,
  };
}

export const useStore = create<StoreState>((set, get) => ({
  engine: new PdfEngine(),
  status: 'empty',
  error: null,
  fileName: '',
  fileSize: 0,

  pages: [],
  currentPageId: null,
  selectedElementId: null,
  selectedElementIds: [],
  editRequest: null,
  activeTool: 'select',
  zoom: 1,
  minZoom: MIN_ZOOM,
  maxZoom: MAX_ZOOM,

  formFields: [],
  formValues: {},
  flattenForm: false,
  xfaForm: false,

  tool: { ...DEFAULT_TOOL },
  recentColors: [],
  clipboard: [],
  pendingTextStyle: null,
  imageEditor: null,

  past: [],
  future: [],

  exporting: false,
  toast: null,

  async loadFile(file) {
    const { engine } = get();
    set({ status: 'loading', error: null });
    try {
      const bytes = await readFileBytes(file);
      const loaded = await engine.loadMain(bytes);
      const pages: EditorPage[] = [];
      for (let i = 0; i < loaded.pageCount; i++) {
        const size = engine.pageSize('main', i);
        const baseRotation = engine.getSource('main')!.pdflib.getPage(i).getRotation().angle;
        pages.push({
          id: uid('pg'),
          sourceKey: 'main',
          sourceIndex: i,
          baseRotation,
          addedRotation: 0,
          mediaWidth: size.width,
          mediaHeight: size.height,
          elements: [],
        });
      }
      const formFields = engine.readFormFields();
      const { hasXfa } = engine.formInfo();
      const formValues: Record<string, string | boolean | string[]> = {};
      for (const f of formFields) formValues[f.name] = f.value;
      set({
        status: 'ready',
        fileName: file.name,
        fileSize: file.size,
        pages,
        currentPageId: pages[0]?.id ?? null,
        selectedElementId: null,
        selectedElementIds: [],
        activeTool: 'select',
        zoom: 1,
        formFields,
        formValues,
        flattenForm: false,
        xfaForm: hasXfa && formFields.length === 0,
        past: [],
        future: [],
      });
      get().showToast(`${file.name} geladen · ${loaded.pageCount} Seite${loaded.pageCount > 1 ? 'n' : ''}`, 'success');
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error && /password|encrypt/i.test(err.message) ? 'PDF ist passwortgeschützt.' : 'PDF konnte nicht geöffnet werden.';
      set({ status: get().pages.length ? 'ready' : 'empty', error: msg });
      get().showToast(msg, 'error');
    }
  },

  async mergeFile(file) {
    const { engine } = get();
    try {
      const bytes = await readFileBytes(file);
      const loaded = await engine.addImport(bytes);
      const src = engine.getSource(loaded.key)!;
      const newPages: EditorPage[] = [];
      for (let i = 0; i < loaded.pageCount; i++) {
        const size = engine.pageSize(loaded.key, i);
        const baseRotation = src.pdflib.getPage(i).getRotation().angle;
        newPages.push({
          id: uid('pg'),
          sourceKey: loaded.key,
          sourceIndex: i,
          baseRotation,
          addedRotation: 0,
          mediaWidth: size.width,
          mediaHeight: size.height,
          elements: [],
        });
      }
      get().commit();
      set((s) => ({ pages: [...s.pages, ...newPages] }));
      get().showToast(`${file.name} angefügt · +${loaded.pageCount} Seite${loaded.pageCount > 1 ? 'n' : ''}`, 'success');
    } catch (err) {
      console.error(err);
      get().showToast('PDF konnte nicht angefügt werden.', 'error');
    }
  },

  async newDocument() {
    // A fresh document needs no source PDF: a single blank page is enough, and the
    // export path assembles blank pages without any source (see PdfEngine.export).
    await get().engine.disposeAll();
    const id = uid('pg');
    set({
      status: 'ready',
      error: null,
      fileName: 'Neues Dokument.pdf',
      fileSize: 0,
      pages: [
        {
          id,
          sourceKey: BLANK_SOURCE,
          sourceIndex: 0,
          baseRotation: 0,
          addedRotation: 0,
          mediaWidth: A4_PORTRAIT.width,
          mediaHeight: A4_PORTRAIT.height,
          blank: true,
          elements: [],
        },
      ],
      currentPageId: id,
      selectedElementId: null,
      selectedElementIds: [],
      activeTool: 'select',
      zoom: 1,
      formFields: [],
      formValues: {},
      flattenForm: false,
      xfaForm: false,
      past: [],
      future: [],
    });
  },

  async reset() {
    await get().engine.disposeAll();
    set({
      status: 'empty',
      error: null,
      fileName: '',
      fileSize: 0,
      pages: [],
      currentPageId: null,
      selectedElementId: null,
      selectedElementIds: [],
      activeTool: 'select',
      zoom: 1,
      formFields: [],
      formValues: {},
      flattenForm: false,
      xfaForm: false,
      past: [],
      future: [],
    });
  },

  setTool(tool) {
    const keepSel = tool === 'select';
    set({
      activeTool: tool,
      selectedElementId: keepSel ? get().selectedElementId : null,
      selectedElementIds: keepSel ? get().selectedElementIds : [],
      // An armed scan typeface only survives while the text tool is active (it is placed
      // on the next click); choosing any other tool discards it.
      pendingTextStyle: tool === 'text' ? get().pendingTextStyle : null,
    });
  },
  setZoom(zoom) {
    // Up to 2000 % magnification. The lower bound is mode-dependent (desktop 25 %, mobile
    // 100 % = "fit") so a phone can never shrink the page into a useless speck. The page
    // bitmap is resolution-capped in PageCanvas, so an extreme zoom stays visible.
    const { minZoom, maxZoom } = get();
    set({ zoom: Math.max(minZoom, Math.min(maxZoom, Number(zoom.toFixed(2)))) });
  },
  setZoomLimits(min, max) {
    set((s) => ({ minZoom: min, maxZoom: max, zoom: Math.max(min, Math.min(max, s.zoom)) }));
  },
  setCurrentPage(id) {
    set({ currentPageId: id, selectedElementId: null, selectedElementIds: [] });
  },
  selectElement(id) {
    set({ selectedElementId: id, selectedElementIds: id ? [id] : [] });
  },
  selectElements(ids) {
    const unique = [...new Set(ids)];
    set({ selectedElementIds: unique, selectedElementId: unique.length ? unique[unique.length - 1] : null });
  },
  requestTextEdit(id) {
    set((s) => ({ editRequest: { id, n: (s.editRequest?.n ?? 0) + 1 } }));
  },
  toggleElementSelection(id) {
    set((s) => {
      const has = s.selectedElementIds.includes(id);
      const next = has ? s.selectedElementIds.filter((x) => x !== id) : [...s.selectedElementIds, id];
      return { selectedElementIds: next, selectedElementId: next.length ? next[next.length - 1] : null };
    });
  },
  setToolDefaults(patch) {
    set((s) => ({ tool: { ...s.tool, ...patch } }));
  },
  addRecentColor(color) {
    const hex = toHex(color);
    set((s) => ({ recentColors: [hex, ...s.recentColors.filter((c) => c !== hex)].slice(0, 9) }));
  },
  setPendingTextStyle(style) {
    set({ pendingTextStyle: style });
  },
  openImageEditor(id) {
    set({ imageEditor: { id }, selectedElementId: id, selectedElementIds: [id] });
  },
  closeImageEditor() {
    set({ imageEditor: null });
  },

  addElement(pageId, el) {
    get().commit();
    set((s) => ({
      pages: s.pages.map((p) => (p.id === pageId ? { ...p, elements: [...p.elements, el] } : p)),
      selectedElementId: el.id,
      selectedElementIds: [el.id],
    }));
  },
  addElements(pageId, els, selectId) {
    if (!els.length) return;
    get().commit();
    const sel = selectId ?? els[els.length - 1].id;
    set((s) => ({
      pages: s.pages.map((p) => (p.id === pageId ? { ...p, elements: [...p.elements, ...els] } : p)),
      selectedElementId: sel,
      selectedElementIds: [sel],
    }));
  },
  updateElement(pageId, id, patch) {
    set((s) => ({
      pages: s.pages.map((p) =>
        p.id === pageId
          ? { ...p, elements: p.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as AnyElement) : e)) }
          : p,
      ),
    }));
  },
  deleteElement(pageId, id) {
    get().commit();
    set((s) => ({
      pages: s.pages.map((p) => (p.id === pageId ? { ...p, elements: p.elements.filter((e) => e.id !== id) } : p)),
      selectedElementId: null,
      selectedElementIds: [],
    }));
  },
  deleteElements(pageId, ids) {
    if (!ids.length) return;
    get().commit();
    const remove = new Set(ids);
    set((s) => ({
      pages: s.pages.map((p) => (p.id === pageId ? { ...p, elements: p.elements.filter((e) => !remove.has(e.id)) } : p)),
      selectedElementId: null,
      selectedElementIds: [],
    }));
  },
  duplicateElement(pageId, id) {
    const page = get().pages.find((p) => p.id === pageId);
    const el = page?.elements.find((e) => e.id === id);
    if (!el) return;
    // A duplicate is always free to move, even if the original was locked.
    const copy = { ...offsetCopy(el, 12, 12), id: uid('el'), z: maxZ(page!.elements) + 1, locked: false };
    get().addElement(pageId, copy);
  },
  duplicateElements(pageId, ids) {
    const page = get().pages.find((p) => p.id === pageId);
    if (!page) return;
    const idSet = new Set(ids);
    const chosen = page.elements.filter((e) => idSet.has(e.id));
    if (!chosen.length) return;
    const zTop = maxZ(page.elements);
    const copies = chosen.map((e, i) => ({ ...offsetCopy(e, 12, 12), id: uid('el'), z: zTop + 1 + i, locked: false }) as AnyElement);
    get().addElements(pageId, copies);
    get().selectElements(copies.map((c) => c.id));
  },
  copyElements(pageId, ids) {
    const page = get().pages.find((p) => p.id === pageId);
    if (!page) return;
    const idSet = new Set(ids);
    const els = page.elements.filter((e) => idSet.has(e.id)).map((e) => structuredClone(e));
    if (els.length) set({ clipboard: els });
  },
  pasteClipboard(pageId) {
    const { clipboard } = get();
    const page = get().pages.find((p) => p.id === pageId);
    if (!clipboard.length || !page) return;
    const zTop = maxZ(page.elements);
    const copies = clipboard.map((c, i) => ({ ...offsetCopy(c, 14, 14), id: uid('el'), z: zTop + 1 + i, locked: false }) as AnyElement);
    get().addElements(pageId, copies);
    get().selectElements(copies.map((c) => c.id));
  },
  reorderElement(pageId, id, dir) {
    get().commit();
    set((s) => ({
      pages: s.pages.map((p) => {
        if (p.id !== pageId) return p;
        const max = maxZ(p.elements);
        const min = minZ(p.elements);
        return {
          ...p,
          elements: p.elements.map((e) => (e.id === id ? { ...e, z: dir === 'front' ? max + 1 : min - 1 } : e)),
        };
      }),
    }));
  },

  reorderPages(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    get().commit();
    set((s) => {
      const pages = [...s.pages];
      const [moved] = pages.splice(fromIndex, 1);
      pages.splice(toIndex, 0, moved);
      return { pages };
    });
  },
  movePages(ids, beforeId) {
    const idSet = new Set(ids);
    if (!idSet.size) return;
    get().commit();
    set((s) => {
      // Keep the moved pages in their current relative order.
      const moving = s.pages.filter((p) => idSet.has(p.id));
      const rest = s.pages.filter((p) => !idSet.has(p.id));
      if (!moving.length) return s;
      let at = beforeId ? rest.findIndex((p) => p.id === beforeId) : rest.length;
      if (at < 0) at = rest.length;
      // Dragging the block downward: insert AFTER the target so it lands where dropped.
      const firstMovingIdx = s.pages.findIndex((p) => idSet.has(p.id));
      const overIdx = beforeId ? s.pages.findIndex((p) => p.id === beforeId) : s.pages.length;
      if (firstMovingIdx < overIdx) at += 1;
      rest.splice(at, 0, ...moving);
      return { pages: rest };
    });
  },
  deletePage(id) {
    if (get().pages.length <= 1) {
      get().showToast('Die letzte Seite kann nicht gelöscht werden.', 'error');
      return;
    }
    get().commit();
    set((s) => {
      const idx = s.pages.findIndex((p) => p.id === id);
      const pages = s.pages.filter((p) => p.id !== id);
      const currentPageId = s.currentPageId === id ? pages[Math.min(idx, pages.length - 1)]?.id ?? null : s.currentPageId;
      return { pages, currentPageId, selectedElementId: null, selectedElementIds: [] };
    });
  },
  deletePages(ids) {
    const idSet = new Set(ids);
    if (!idSet.size) return;
    if (get().pages.every((p) => idSet.has(p.id))) {
      get().showToast('Es muss mindestens eine Seite übrig bleiben.', 'error');
      return;
    }
    get().commit();
    set((s) => {
      const firstIdx = s.pages.findIndex((p) => idSet.has(p.id));
      const pages = s.pages.filter((p) => !idSet.has(p.id));
      const currentGone = s.currentPageId != null && idSet.has(s.currentPageId);
      const currentPageId = currentGone ? pages[Math.min(firstIdx, pages.length - 1)]?.id ?? null : s.currentPageId;
      return { pages, currentPageId, selectedElementId: null, selectedElementIds: [] };
    });
  },
  duplicatePage(id) {
    get().commit();
    set((s) => {
      const idx = s.pages.findIndex((p) => p.id === id);
      if (idx < 0) return s;
      const src = s.pages[idx];
      const copy: EditorPage = { ...structuredClone(src), id: uid('pg') };
      const pages = [...s.pages];
      pages.splice(idx + 1, 0, copy);
      return { pages };
    });
  },
  duplicatePages(ids) {
    const idSet = new Set(ids);
    if (!idSet.size) return;
    get().commit();
    set((s) => {
      // Insert all copies (in page order) right after the last selected page.
      const ordered = s.pages.filter((p) => idSet.has(p.id));
      const copies = ordered.map((src) => ({ ...structuredClone(src), id: uid('pg') }) as EditorPage);
      let lastIdx = -1;
      s.pages.forEach((p, i) => {
        if (idSet.has(p.id)) lastIdx = i;
      });
      const pages = [...s.pages];
      pages.splice(lastIdx + 1, 0, ...copies);
      return { pages };
    });
  },
  rotatePage(id, delta) {
    get().commit();
    set((s) => ({
      pages: s.pages.map((p) => (p.id === id ? { ...p, addedRotation: (((p.addedRotation + delta) % 360) + 360) % 360 } : p)),
    }));
  },
  rotatePages(ids, delta) {
    const idSet = new Set(ids);
    if (!idSet.size) return;
    get().commit();
    set((s) => ({
      pages: s.pages.map((p) => (idSet.has(p.id) ? { ...p, addedRotation: (((p.addedRotation + delta) % 360) + 360) % 360 } : p)),
    }));
  },
  insertBlankAfter(id) {
    get().commit();
    set((s) => {
      const idx = id ? s.pages.findIndex((p) => p.id === id) : s.pages.length - 1;
      const ref = s.pages[idx];
      const blank: EditorPage = {
        id: uid('pg'),
        sourceKey: BLANK_SOURCE,
        sourceIndex: 0,
        baseRotation: 0,
        addedRotation: 0,
        mediaWidth: ref ? ref.mediaWidth : A4_PORTRAIT.width,
        mediaHeight: ref ? ref.mediaHeight : A4_PORTRAIT.height,
        blank: true,
        elements: [],
      };
      const pages = [...s.pages];
      pages.splice(idx + 1, 0, blank);
      return { pages, currentPageId: blank.id };
    });
  },

  setFormValue(name, value) {
    set((s) => ({ formValues: { ...s.formValues, [name]: value } }));
  },
  setFlattenForm(v) {
    set({ flattenForm: v });
  },

  commit() {
    set((s) => ({ past: [...s.past.slice(-49), snapshot(s)], future: [] }));
  },
  undo() {
    set((s) => {
      if (!s.past.length) return s;
      const prev = s.past[s.past.length - 1];
      return {
        past: s.past.slice(0, -1),
        future: [snapshot(s), ...s.future].slice(0, 50),
        pages: prev.pages,
        formValues: prev.formValues,
        selectedElementId: prev.selectedElementId,
        selectedElementIds: prev.selectedElementIds ?? (prev.selectedElementId ? [prev.selectedElementId] : []),
        currentPageId: prev.currentPageId ?? s.currentPageId,
      };
    });
  },
  redo() {
    set((s) => {
      if (!s.future.length) return s;
      const next = s.future[0];
      return {
        future: s.future.slice(1),
        past: [...s.past, snapshot(s)],
        pages: next.pages,
        formValues: next.formValues,
        selectedElementId: next.selectedElementId,
        selectedElementIds: next.selectedElementIds ?? (next.selectedElementId ? [next.selectedElementId] : []),
        currentPageId: next.currentPageId ?? s.currentPageId,
      };
    });
  },

  async buildExportBytes() {
    const { engine, pages, formValues, flattenForm } = get();
    if (!pages.length) return null;
    set({ exporting: true });
    try {
      const specs: ExportPageSpec[] = pages.map((p) => ({
        sourceKey: p.sourceKey,
        sourceIndex: p.sourceIndex,
        addedRotation: p.addedRotation,
        blankSize: p.blank ? { width: p.mediaWidth, height: p.mediaHeight } : undefined,
        elements: p.elements,
      }));
      return await engine.export(specs, { formValues, flattenForm });
    } catch (err) {
      console.error(err);
      get().showToast('Export fehlgeschlagen.', 'error');
      return null;
    } finally {
      set({ exporting: false });
    }
  },

  showToast(message, kind = 'info') {
    const id = uid('t');
    set({ toast: { id, message, kind } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 3200);
  },
}));

function maxZ(els: AnyElement[]): number {
  return els.reduce((m, e) => Math.max(m, e.z), 0);
}
function minZ(els: AnyElement[]): number {
  return els.reduce((m, e) => Math.min(m, e.z), 1);
}

export { visibleSize };
