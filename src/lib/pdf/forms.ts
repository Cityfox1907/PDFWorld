import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFField,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
  PDFButton,
  PDFSignature,
  StandardFonts,
} from 'pdf-lib';
import type { FormField } from './types';

/**
 * Read one AcroForm field into our model. Isolated + guarded so a single
 * malformed field can never wipe out the whole list.
 */
function readOneField(field: PDFField, pageRefToIndex: Map<unknown, number>): FormField | null {
  const name = field.getName();
  const readOnly = field.isReadOnly();

  let pageIndex = 0;
  let rect: FormField['rect'];
  try {
    const widgets = field.acroField.getWidgets();
    if (widgets.length) {
      const w = widgets[0];
      const r = w.getRectangle();
      const pref = w.P();
      const idx = pref ? pageRefToIndex.get(pref) : undefined;
      if (idx !== undefined) pageIndex = idx;
      // content-space rect; the editor converts to view space when needed
      rect = { x: r.x, y: r.y, width: r.width, height: r.height };
    }
  } catch {
    /* widget geometry is optional */
  }

  if (field instanceof PDFTextField) {
    return { name, kind: 'text', value: field.getText() ?? '', readOnly, pageIndex, rect };
  }
  if (field instanceof PDFCheckBox) {
    return { name, kind: 'checkbox', value: field.isChecked(), readOnly, pageIndex, rect };
  }
  if (field instanceof PDFRadioGroup) {
    return { name, kind: 'radio', value: field.getSelected() ?? '', options: field.getOptions(), readOnly, pageIndex, rect };
  }
  if (field instanceof PDFDropdown) {
    return { name, kind: 'dropdown', value: field.getSelected()[0] ?? '', options: field.getOptions(), readOnly, pageIndex, rect };
  }
  if (field instanceof PDFOptionList) {
    return { name, kind: 'optionlist', value: field.getSelected(), options: field.getOptions(), readOnly, pageIndex, rect };
  }
  if (field instanceof PDFButton) {
    return { name, kind: 'button', value: '', readOnly, pageIndex, rect };
  }
  if (field instanceof PDFSignature) {
    return { name, kind: 'signature', value: '', readOnly, pageIndex, rect };
  }
  // Unknown widget kind — surface it as a (read-only) text field instead of dropping it.
  return { name, kind: 'text', value: '', readOnly: true, pageIndex, rect };
}

/** Read all AcroForm fields from a pdf-lib document (empty array if none). */
export function readFields(doc: PDFDocument): FormField[] {
  let fields: PDFField[];
  try {
    fields = doc.getForm().getFields();
  } catch (err) {
    console.warn('AcroForm konnte nicht gelesen werden', err);
    return [];
  }

  const pageRefToIndex = new Map<unknown, number>();
  doc.getPages().forEach((p, i) => pageRefToIndex.set(p.ref, i));

  const out: FormField[] = [];
  for (const field of fields) {
    try {
      const parsed = readOneField(field, pageRefToIndex);
      if (parsed) out.push(parsed);
    } catch (err) {
      // Never let one bad field abort the whole form.
      console.warn('Formularfeld übersprungen', err);
    }
  }
  return out;
}

/**
 * Diagnose a document's form so the UI can explain *why* there are no editable
 * fields. XFA forms (LiveCycle) carry their fields in an XML stream that pdf-lib
 * cannot fill — detecting them lets us tell the user instead of failing silently.
 */
export function formDiagnostics(doc: PDFDocument): { acroFieldCount: number; hasXfa: boolean } {
  let acroFieldCount = 0;
  let hasXfa = false;
  try {
    const acro = doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
    if (acro) {
      hasXfa = acro.has(PDFName.of('XFA'));
      const fields = acro.lookup(PDFName.of('Fields'));
      // PDFArray exposes .size(); fall back to 0 when absent.
      const size = (fields as { size?: () => number } | undefined)?.size;
      if (typeof size === 'function') acroFieldCount = size.call(fields);
    }
  } catch (err) {
    console.warn('Formular-Diagnose fehlgeschlagen', err);
  }
  return { acroFieldCount, hasXfa };
}

/** Apply a map of field name → value to the document's form fields. */
export function applyFieldValues(doc: PDFDocument, values: Record<string, string | boolean | string[]>): void {
  const form = doc.getForm();
  for (const [name, value] of Object.entries(values)) {
    let field;
    try {
      field = form.getField(name);
    } catch {
      continue;
    }
    try {
      if (field instanceof PDFTextField && typeof value === 'string') {
        field.setText(value);
      } else if (field instanceof PDFCheckBox) {
        if (value) field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup && typeof value === 'string') {
        if (value) field.select(value);
        else field.clear();
      } else if (field instanceof PDFDropdown && typeof value === 'string') {
        if (value) field.select(value);
        else field.clear();
      } else if (field instanceof PDFOptionList && Array.isArray(value)) {
        field.clear();
        if (value.length) field.select(value);
      }
    } catch (err) {
      console.error('form field set failed', name, err);
    }
  }
}

/** Refresh field appearances (needed so values render) and optionally flatten. */
export async function finalizeForm(doc: PDFDocument, flatten: boolean): Promise<void> {
  const form = doc.getForm();
  if (!form.getFields().length) return;
  try {
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    form.updateFieldAppearances(helv);
  } catch (err) {
    console.error('updateFieldAppearances failed', err);
  }
  if (flatten) {
    try {
      form.flatten();
    } catch (err) {
      console.error('form flatten failed', err);
    }
  }
}

export function hasForm(doc: PDFDocument): boolean {
  try {
    return doc.getForm().getFields().length > 0;
  } catch {
    return false;
  }
}
