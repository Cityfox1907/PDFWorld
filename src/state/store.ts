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
} from '../lib/pdf';
import { readFileBytes, downloadBytes, baseName } from '../lib/utils/file';
import { uid } from '../lib/utils/id';

export type ToolId =
  | 'select'
  | 'edit-text'
  | 'text'
  | 'highlight'
  | 'draw'
  | 'rect'
  | 'ellipse'
  | 'redact'
  | 'image'
  | 'signature'
  | 'forms';

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
  drawColor: string;
  drawWidth: number;
  shapeFill: string;
  shapeStroke: string;
}

interface Snapshot {
  pages: EditorPage[];
  formValues: Record<string, string | boolean | string[]>;
  selectedElementId: string | null;
  currentPageId: string | null;
}

interface StoreState {
  engine: PdfEngine;
  status: 'empty' | 'loading' | 'ready';
  error: string | null;
  fileName: string;
  fileSize: number;

  pages: EditorPage[];
  currentPageId: string | null;
  selectedElementId: string | null;
  activeTool: ToolId;
  zoom: number;

  formFields: FormField[];
  formValues: Record<string, string | boolean | string[]>;
  flattenForm: boolean;

  tool: ToolDefaults;

  past: Snapshot[];
  future: Snapshot[];

  exporting: boolean;
  toast: { id: string; message: string; kind: 'info' | 'success' | 'error' } | null;

  // ── lifecycle ──
  loadFile: (file: File) => Promise<void>;
  mergeFile: (file: File) => Promise<void>;
  reset: () => Promise<void>;

  // ── tools / view ──
  setTool: (tool: ToolId) => void;
  setZoom: (zoom: number) => void;
  setCurrentPage: (id: string) => void;
  selectElement: (id: string | null) => void;
  setToolDefaults: (patch: Partial<ToolDefaults>) => void;

  // ── elements ──
  addElement: (pageId: string, el: AnyElement) => void;
  updateElement: (pageId: string, id: string, patch: ElementPatch) => void;
  deleteElement: (pageId: string, id: string) => void;
  duplicateElement: (pageId: string, id: string) => void;
  reorderElement: (pageId: string, id: string, dir: 'front' | 'back') => void;

  // ── pages ──
  reorderPages: (fromIndex: number, toIndex: number) => void;
  deletePage: (id: string) => void;
  duplicatePage: (id: string) => void;
  rotatePage: (id: string, delta: number) => void;
  insertBlankAfter: (id: string | null) => void;

  // ── forms ──
  setFormValue: (name: string, value: string | boolean | string[]) => void;
  setFlattenForm: (v: boolean) => void;

  // ── history ──
  commit: () => void;
  undo: () => void;
  redo: () => void;

  // ── export ──
  exportPdf: () => Promise<void>;

  showToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
}

const DEFAULT_TOOL: ToolDefaults = {
  textColor: '#111111',
  textFamily: 'sans',
  textSize: 16,
  highlightColor: '#ffd84d',
  drawColor: '#1a1a1a',
  drawWidth: 2.5,
  shapeFill: '#ffffff',
  shapeStroke: '#111111',
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

function snapshot(s: StoreState): Snapshot {
  return {
    pages: clonePages(s.pages),
    formValues: structuredClone(s.formValues),
    selectedElementId: s.selectedElementId,
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
  activeTool: 'select',
  zoom: 1,

  formFields: [],
  formValues: {},
  flattenForm: false,

  tool: { ...DEFAULT_TOOL },

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
      const formValues: Record<string, string | boolean | string[]> = {};
      for (const f of formFields) formValues[f.name] = f.value;
      set({
        status: 'ready',
        fileName: file.name,
        fileSize: file.size,
        pages,
        currentPageId: pages[0]?.id ?? null,
        selectedElementId: null,
        activeTool: 'select',
        zoom: 1,
        formFields,
        formValues,
        flattenForm: false,
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
      activeTool: 'select',
      zoom: 1,
      formFields: [],
      formValues: {},
      flattenForm: false,
      past: [],
      future: [],
    });
  },

  setTool(tool) {
    set({ activeTool: tool, selectedElementId: tool === 'select' ? get().selectedElementId : null });
  },
  setZoom(zoom) {
    set({ zoom: Math.max(0.25, Math.min(4, Number(zoom.toFixed(2)))) });
  },
  setCurrentPage(id) {
    set({ currentPageId: id, selectedElementId: null });
  },
  selectElement(id) {
    set({ selectedElementId: id });
  },
  setToolDefaults(patch) {
    set((s) => ({ tool: { ...s.tool, ...patch } }));
  },

  addElement(pageId, el) {
    get().commit();
    set((s) => ({
      pages: s.pages.map((p) => (p.id === pageId ? { ...p, elements: [...p.elements, el] } : p)),
      selectedElementId: el.id,
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
    }));
  },
  duplicateElement(pageId, id) {
    const page = get().pages.find((p) => p.id === pageId);
    const el = page?.elements.find((e) => e.id === id);
    if (!el) return;
    const copy = { ...structuredClone(el), id: uid('el'), x: el.x + 12, y: el.y + 12, z: maxZ(page!.elements) + 1 };
    get().addElement(pageId, copy);
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
      return { pages, currentPageId, selectedElementId: null };
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
  rotatePage(id, delta) {
    get().commit();
    set((s) => ({
      pages: s.pages.map((p) => (p.id === id ? { ...p, addedRotation: (((p.addedRotation + delta) % 360) + 360) % 360 } : p)),
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
        currentPageId: next.currentPageId ?? s.currentPageId,
      };
    });
  },

  async exportPdf() {
    const { engine, pages, formValues, flattenForm, fileName } = get();
    if (!pages.length) return;
    set({ exporting: true });
    try {
      const specs: ExportPageSpec[] = pages.map((p) => ({
        sourceKey: p.sourceKey,
        sourceIndex: p.sourceIndex,
        addedRotation: p.addedRotation,
        blankSize: p.blank ? { width: p.mediaWidth, height: p.mediaHeight } : undefined,
        elements: p.elements,
      }));
      const bytes = await engine.export(specs, { formValues, flattenForm });
      downloadBytes(bytes, `${baseName(fileName) || 'dokument'}-bearbeitet.pdf`);
      get().showToast(`Gespeichert · ${(bytes.length / 1024 / 1024).toFixed(2)} MB`, 'success');
    } catch (err) {
      console.error(err);
      get().showToast('Export fehlgeschlagen.', 'error');
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
