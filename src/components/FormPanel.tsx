import { useStore } from '../state/store';
import { FileText } from 'lucide-react';

export function FormPanel() {
  const fields = useStore((s) => s.formFields);
  const values = useStore((s) => s.formValues);
  const setFormValue = useStore((s) => s.setFormValue);
  const flattenForm = useStore((s) => s.flattenForm);
  const setFlattenForm = useStore((s) => s.setFlattenForm);
  const xfaForm = useStore((s) => s.xfaForm);

  if (!fields.length) {
    return (
      <div className="insp-group">
        <div className="insp-title">Formular</div>
        <div className="form-empty">
          <FileText size={26} />
          {xfaForm ? (
            <>
              <p>Dieses PDF nutzt ein XFA-Formular (LiveCycle).</p>
              <span className="insp-hint">
                XFA-Felder lassen sich im Browser nicht direkt ausfüllen. Nutze das
                Text-Werkzeug, um die Felder manuell zu beschriften.
              </span>
            </>
          ) : (
            <>
              <p>Dieses PDF enthält keine interaktiven Formularfelder.</p>
              <span className="insp-hint">Nutze stattdessen das Text-Werkzeug, um Felder manuell auszufüllen.</span>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="insp-group">
      <div className="insp-title">Formular · {fields.length} Felder</div>
      <div className="form-list">
        {fields.map((f) => {
          const val = values[f.name];
          const label = (
            <div className="form-label" title={f.name}>
              {f.name} <span className="form-page">S. {f.pageIndex + 1}</span>
            </div>
          );
          if (f.kind === 'checkbox') {
            return (
              <label key={f.name} className="form-check">
                <input type="checkbox" checked={Boolean(val)} disabled={f.readOnly} onChange={(e) => setFormValue(f.name, e.target.checked)} />
                {label}
              </label>
            );
          }
          if (f.kind === 'dropdown' || f.kind === 'radio') {
            return (
              <div key={f.name} className="form-field">
                {label}
                <select className="field" value={String(val ?? '')} disabled={f.readOnly} onChange={(e) => setFormValue(f.name, e.target.value)}>
                  <option value="">—</option>
                  {f.options?.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
            );
          }
          if (f.kind === 'optionlist') {
            const arr = Array.isArray(val) ? val : [];
            return (
              <div key={f.name} className="form-field">
                {label}
                <select
                  className="field"
                  multiple
                  value={arr}
                  disabled={f.readOnly}
                  onChange={(e) => setFormValue(f.name, [...e.target.selectedOptions].map((o) => o.value))}
                >
                  {f.options?.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
            );
          }
          if (f.kind === 'button' || f.kind === 'signature') {
            return (
              <div key={f.name} className="form-field">
                {label}
                <span className="insp-hint" style={{ margin: 0 }}>{f.kind === 'signature' ? 'Signaturfeld' : 'Schaltfläche'}</span>
              </div>
            );
          }
          return (
            <div key={f.name} className="form-field">
              {label}
              <input
                className="field"
                type="text"
                value={String(val ?? '')}
                disabled={f.readOnly}
                placeholder="Wert eingeben…"
                onChange={(e) => setFormValue(f.name, e.target.value)}
              />
            </div>
          );
        })}
      </div>

      <div className="divider" />
      <label className="form-check">
        <input type="checkbox" checked={flattenForm} onChange={(e) => setFlattenForm(e.target.checked)} />
        <div className="form-label">
          Nach dem Speichern fixieren
          <span className="insp-hint" style={{ display: 'block', margin: 0 }}>Werte werden fest eingebrannt (nicht mehr editierbar).</span>
        </div>
      </label>
    </div>
  );
}
