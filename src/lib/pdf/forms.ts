import {
  PDFDocument,
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

/** Read all AcroForm fields from a pdf-lib document (empty array if none). */
export function readFields(doc: PDFDocument): FormField[] {
  const form = doc.getForm();
  const fields = form.getFields();
  const pages = doc.getPages();
  const pageRefToIndex = new Map<unknown, number>();
  pages.forEach((p, i) => pageRefToIndex.set(p.ref, i));

  const out: FormField[] = [];
  for (const field of fields) {
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
      out.push({ name, kind: 'text', value: field.getText() ?? '', readOnly, pageIndex, rect });
    } else if (field instanceof PDFCheckBox) {
      out.push({ name, kind: 'checkbox', value: field.isChecked(), readOnly, pageIndex, rect });
    } else if (field instanceof PDFRadioGroup) {
      out.push({
        name,
        kind: 'radio',
        value: field.getSelected() ?? '',
        options: field.getOptions(),
        readOnly,
        pageIndex,
        rect,
      });
    } else if (field instanceof PDFDropdown) {
      out.push({
        name,
        kind: 'dropdown',
        value: field.getSelected()[0] ?? '',
        options: field.getOptions(),
        readOnly,
        pageIndex,
        rect,
      });
    } else if (field instanceof PDFOptionList) {
      out.push({
        name,
        kind: 'optionlist',
        value: field.getSelected(),
        options: field.getOptions(),
        readOnly,
        pageIndex,
        rect,
      });
    } else if (field instanceof PDFButton) {
      out.push({ name, kind: 'button', value: '', readOnly, pageIndex, rect });
    } else if (field instanceof PDFSignature) {
      out.push({ name, kind: 'signature', value: '', readOnly, pageIndex, rect });
    }
  }
  return out;
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
