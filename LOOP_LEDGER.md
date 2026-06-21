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
- **Nächster Loop:** Datei-Lade-Robustheit (Grössen-/Seiten-Guard +
  Engine-Cleanup bei Fehler) ODER undo/redo-Mehrfachauswahl.
