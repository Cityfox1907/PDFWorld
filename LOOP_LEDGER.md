# LOOP_LEDGER — PDFWorld

Gedächtnis des autonomen Verbesserungs-Loops (loop-skill). Jede Iteration ist
nachweisbar besser als ihre Vorgängerin — oder sie zählt nicht.

## Phase 0 — Zielanker

**Projekt-Nordstern:** PDFWorld ist eine Light-Version von Adobe Acrobat, die
vollständig & lossless im Browser läuft (keine Uploads). Für jeden, der PDFs
schnell und ohne Qualitätsverlust bearbeiten, zusammenstellen und ausfüllen will.

**Definition of Done:**
1. Alle Kern-Flows klickbar & fehlerfrei — keine toten Buttons, keine Fake-Features.
2. Robust gegen reale Eingaben: korrupte / verschlüsselte / riesige PDFs führen nie
   zu Datenverlust oder weissem Bildschirm — immer eine ehrliche Fehlermeldung
   und ein Weg zurück.
3. Verlustfreiheit bleibt bewiesen (Engine-Tests grün).
4. Production-Build läuft Vercel-nativ ohne Sonderkonfiguration durch.
5. Mobil benutzbar (dedizierte Touch-Shell), ohne Layout-Shift.
6. `typecheck`, `lint`, `build`, `test:engine` alle grün.

**Tabu-Zone:** Die verlustfreie PDF-Engine-Logik (`lib/pdf/*`) nicht ohne Not
umbauen — chirurgische Eingriffe. Keine ungefragten neuen Features (🔵). Keine
neuen Runtime-Abhängigkeiten ohne Anlass (Vercel-Kompatibilität).

**Baseline-Snapshot:** Commit `2791036` (Merge PR #22). Alle Gates grün:
typecheck ✅ · lint ✅ · build ✅ · `test:engine` 87/87 ✅.

---

## Loop-Historie

### 🔁 LOOP #1 — autopilot
- **Befunde:** 🔴0 🟠3 🟡2 🟢2 (alle Surface-Gates waren bereits grün; Befunde
  aus evidenzbasiertem Code-Review)
  - 🟠 **Kein React-Error-Boundary** im gesamten Baum → jede Render-Exception
    (z. B. bei korruptem Element / NaN-Koordinate / pdf.js-Fehler in einer
    Komponente) führt zum **weissen Bildschirm** und **Verlust aller
    ungespeicherten Bearbeitungen**. Verletzt DoD #2. (`App.tsx`, kein Catch)
  - 🔴(klein) undo/redo verliert Mehrfachauswahl (Snapshot hält nur
    `selectedElementId`). → Loop-Kandidat
  - 🟠 kein Limit für Dateigrösse/Seitenzahl + Engine wird bei Ladefehler nicht
    sauber zurückgesetzt (OOM-Risiko). → Loop-Kandidat
- **Gewählt:** Globaler Error-Boundary mit Arbeits-Rettung — höchster Hebel,
  weil er **alle** Flows absichert und Datenverlust bei Abstürzen verhindert
  (Fundament vor Fassade).
- **Geändert:** `src/components/ErrorBoundary.tsx` (neu), in `src/App.tsx`
  eingebunden; Fallback-Styles in `src/styles/app.css`.
- **VERIFY:** ✅ — Build ok, typecheck ok, lint ok, Regression keine
  (87/87 Engine-Tests grün), DoD #2 vorangebracht.
- **Richtung:** Fundament stabilisieren, dann Robustheit der Ladepfade
  (Limits + saubere Fehler-Wiederherstellung), danach UX-Politur.
- **Nächster Loop:** Datei-Lade-Robustheit (atomares Laden).

### 🔁 LOOP #2 — autopilot
- **Befunde (Re-DISCOVER):** Bestätigt: `PdfEngine.loadMain` rief `disposeAll()`
  VOR dem Parsen der neuen Datei auf. Lädt man bei geöffnetem Dokument eine
  korrupte/verschlüsselte Datei, wurde das offene Dokument zerstört, während
  `pages` im Store noch darauf zeigte → Status fiel auf `'ready'` zurück, aber
  die Engine war leer → Canvas-`getPage` wirft → kaputter Zustand. (`mergeFile`/
  `addImport` war bereits sicher: setzt Quelle nur bei Erfolg.)
- **Gewählt:** Atomares `loadMain` — neue Quelle ZUERST parsen, erst bei Erfolg
  altes Dokument verwerfen & tauschen. Höchster verbleibender Hebel (DoD #2:
  Robustheit, kein Datenverlust).
- **Geändert:** `src/lib/pdf/document.ts` (`loadMain` Reihenfolge: parse → dispose
  → swap).
- **VERIFY:** ✅ — typecheck/lint/build ok, Regression keine (87/87 Engine-Tests).
  Headless-Test von `loadMain` nicht möglich (render.ts zieht Browser-pdf.js +
  Vite-`?url`-Worker; bewusst nicht gemockt → Tabu/chirurgisch). Korrektheit per
  Reasoning + Gates.
- **Richtung:** Fundament der Ladepfade nun robust. Als Nächstes Korrektheits-
  Politur (undo/redo-Mehrfachauswahl) oder UX.
- **Nächster Loop:** undo/redo bewahrt Mehrfachauswahl.
