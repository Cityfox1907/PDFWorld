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

### 🔁 LOOP #3 — autopilot
- **Befunde (Re-DISCOVER):** Bestätigt: `Snapshot` hielt nur `selectedElementId`.
  undo/redo stellten Mehrfachauswahl (Shift-Klick / Marquee) auf ein einziges
  Element zusammen → stiller Auswahl-Verlust. Verletzt DoD #1 (Flows fehlerfrei).
- **Gewählt:** `Snapshot` um `selectedElementIds` erweitern; in `snapshot()`
  erfassen und in undo/redo wiederherstellen (mit defensivem Fallback auf den
  Einzel-Wert für Alt-Snapshots).
- **Geändert:** `src/state/store.ts` (Snapshot-Interface, `snapshot()`,
  `undo()`, `redo()`).
- **VERIFY:** ✅ — typecheck/lint/build ok, Regression keine (87/87).
- **Richtung:** Korrektheits-Fundament steht. Verbleibende Befunde sind nur
  noch kleine 🟠/🟡 (z. B. Objekt-URL-Lebenszyklus) — abnehmender Grenznutzen.
- **Nächster Loop:** Prüfen, ob noch ein hebelstarker Befund existiert; sonst
  STOP (Diminishing Returns / DoD-Kernziele erreicht).

### 🔁 LOOP #4 — autopilot (Fokus: Mobile-UX)
- **Befunde (Mobile-DISCOVER, alle Mobile-Dateien + geteilte Kernkomponenten
  gelesen):** 🔴1 🟠2 🟢1
  - 🔴 **Text bearbeiten auf Touch unerreichbar.** Den Inhalt eines bestehenden
    Text-/Callout-Elements ändert man NUR per `onDoubleClick` (`ElementView.tsx:254`)
    — auf dem Handy unentdeckbar/unzuverlässig. `MobileContextBar` bot nur
    Eigenschaften/Duplizieren/Löschen, und `Inspector`/`TextProps` hat KEIN
    Inhalts-Feld (nur Schrift/Größe/Farbe). → häufigster Vorgang (Tippfehler
    korrigieren) faktisch unmöglich. Verletzt DoD #1 + #5. *Höchster Hebel.*
  - 🟠 Native `confirm()` in MobileTopBar/MobileMenu (blockierend, hässlich). → offen
  - 🟠 iOS-Auto-Zoom/Tastatur beim On-Canvas-Editieren. → offen
  - 🟢 Direktsprung zu Seite fehlt (PageNav nur prev/next). → offen
- **Gewählt:** First-class Touch-Texteditierung (🔴, höchster Hebel) — Kern-Flow
  reparieren statt polieren (Fundament vor Fassade).
- **Geändert (chirurgisch, additiv, Desktop unberührt):**
  - `src/state/store.ts`: generisches `editRequest`-Signal (`{id,n}` Nonce) +
    Action `requestTextEdit(id)` (nicht Teil der History).
  - `src/components/PageCanvas.tsx`: konsumiert `editRequest` in einem nonce-
    gewachten Effekt → select-Tool, selektieren, `startEditElement`. Letzteres in
    `useCallback` stabilisiert (Lint).
  - `src/components-mobile/MobileContextBar.tsx`: „Text bearbeiten"-Primärbutton
    bei selektiertem (unlocked) Text/Callout, Eigenschaften daneben.
- **VERIFY:** ✅ — typecheck ✅ · lint ✅ (0 Warnungen) · build ✅ ·
  test:engine 87/87 ✅. Regression keine (Desktop-Doppelklick-Pfad unverändert,
  neuer Pfad nur additiv). DoD #1 + #5 vorangebracht.
- **Richtung:** Wichtigster Mobile-Kern-Flow steht. Als Nächstes Politur:
  native `confirm()`-Dialoge durch app-eigene Bestätigung ersetzen.
- **Nächster Loop:** `confirm()` → app-eigener Bestätigungs-Dialog (🟠 B).

### 🔁 LOOP #5 — autopilot (Fokus: Mobile-UX)
- **Befunde (Re-DISCOVER):** Bestätigt 🟠 B — native `confirm()` in
  `MobileTopBar.goHome` und `MobileMenu` (Neues Dokument). Blockierend, unstyled,
  in manchen In-App-Browsern STILL unterdrückt → destruktive Aktion (reset) liefe
  ohne Nachfrage → Datenverlust. Verletzt DoD #5 (mobil benutzbar, App-Grade).
- **Gewählt:** App-eigener Bestätigungs-Dialog (höchster verbleibender Mobile-Hebel
  nach dem Kern-Flow; #3 iOS-Zoom ist größer/riskanter → später).
- **Geändert (additiv, Desktop unberührt):**
  - `mobileUi.ts`: `ConfirmRequest` + `confirm`/`askConfirm`/`resolveConfirm`.
  - `MobileConfirm.tsx` (neu): zentrierter Dialog mit Backdrop, Fade/Scale-In,
    Abbrechen/Bestätigen (danger-Variante).
  - `mobile.css`: `.m-confirm-*` Styles auf den Design-Tokens.
  - `MobileWorkspace.tsx`: `<MobileConfirm/>` eingehängt.
  - `MobileTopBar.tsx` + `MobileMenu.tsx`: `confirm()` → `askConfirm({…})`.
- **VERIFY:** ✅ — typecheck ✅ · lint ✅ (0 Warnungen) · build ✅ ·
  test:engine 87/87 ✅. Kein `confirm()/alert()` mehr in der Mobile-Shell.
  Regression keine (Desktop nutzt diese Shell nie).
- **Richtung:** Mobile-Politur sitzt. Verbleibend: 🟠 #3 (iOS-Zoom/Tastatur,
  größer/riskanter) und 🟢 Seiten-Direktsprung (klein). Nähert sich Diminishing
  Returns für reine UX — nächster Loop prüft #3 ernsthaft oder STOP.
- **Nächster Loop:** iOS-Input-Zoom beim On-Canvas-Editieren prüfen (🟠 C).

### 🔁 LOOP #6 — autopilot (Fokus: Mobile-UX)
- **Befunde (Re-DISCOVER):**
  - 🟠 C (iOS-Input-Zoom): **bereits gelöst** — `index.html:12` setzt schon
    `maximum-scale=1.0, user-scalable=no`. Kein Handlungsbedarf (kein Goldplating).
  - 🟠 **NEU — Tastatur verdeckt das editierte Feld.** Mit `position:fixed`-Body
    schrumpft iOS das Layout beim Öffnen der Tastatur NICHT; ein tief liegendes
    Textfeld (z. B. das gerade per „Text bearbeiten" geöffnete) saß hinter der
    Tastatur → halb-kaputter Kern-Flow aus Loop #4. Höchster verbleibender Hebel
    (vollendet das Fundament von #4).
- **Gewählt:** Tastatur-Verdeckung beheben — niedriges Risiko, da die heikle
  Pan/Zoom-Logik unangetastet bleibt.
- **Geändert:** `MobileWorkspace.tsx` — Effekt, der `.m-app` an `visualViewport.height`
  pinnt, solange die Tastatur offen ist. Die Canvas-Area schrumpft → der vorhandene
  PageCanvas-`ResizeObserver` (Z. 171) passt die Seite automatisch in den Bereich
  ÜBER der Tastatur ein. Kein Eingriff in Canvas-Code; Desktop unberührt.
- **VERIFY:** ✅ — typecheck ✅ · lint ✅ (0 Warnungen) · build ✅ ·
  test:engine 87/87 ✅. Regression keine (rein additiver Mobile-Effekt mit Cleanup).
- **Richtung:** Mobile-Kern-Flow (Text bearbeiten) jetzt end-to-end nutzbar:
  erreichbar (#4), bestätigt destruktive Aktionen sauber (#5), Feld bleibt sichtbar
  (#6). Verbleibend nur noch 🟢 Kleinkram (Seiten-Direktsprung). → Diminishing
  Returns für hebelstarke Mobile-UX erreicht.
- **Nächster Loop:** Final-DISCOVER auf weitere hebelstarke Befunde; sonst STOP.

### 🔁 LOOP #7 — autopilot (Fokus: Mobile-UX)
- **Befunde (Re-DISCOVER):**
  - Undo/Redo: **bereits vorhanden** (MobileTopBar) — kein Handlungsbedarf.
  - 🟢→🟠 **Seiten-Navigation auf langen PDFs zäh.** `MobilePageNav` bot nur
    prev/next-Stepper; der Zähler `x / y` war ein toter `span`. Auf einem 50-Seiten-
    Dokument ist Schritt-für-Schritt mühsam. Der Seiten-Organizer (Thumbnail-Grid)
    existiert und navigiert bereits per Tap (`PageOrganizer.tsx:229 setCurrentPage`),
    war aber nur tief im Menü erreichbar.
- **Gewählt:** Zähler antippbar machen → Organizer öffnen. Hoher Reuse, minimales
  Risiko (keine neue Logik, nur ein Einstiegspunkt zu vorhandener Funktion).
- **Geändert:** `MobilePageNav.tsx` — `span` → `<button>` öffnet `setOrganizer(true)`;
  `mobile.css` — Button-Reset + Tap-Affordanz für `.m-pagenav-label`.
- **VERIFY:** ✅ — typecheck ✅ · lint ✅ (0 Warnungen) · build ✅ ·
  test:engine 87/87 ✅. Regression keine (rein additiver Einstiegspunkt).
- **Richtung:** Mobile-UX rund — Kern-Editier-Flow + Seiten-Navigation + Dialoge
  alle app-grade. **STOP: Diminishing Returns** (keine hebelstarken Befunde mehr;
  weitere Arbeit wäre Fassaden-Politur). Merge nach `main` auf Nutzer-Anweisung.

### 🔁 LOOP #8 — REGRESSION-FIX (Nutzer-gemeldet, Screenshot)
- **Befund (🔴 von mir verursacht in #6):** Beim Hinzufügen/Editieren eines
  Textfelds verschob sich die GANZE Mobile-Oberfläche nach oben; TopBar
  verschwand, unter dem Dock klaffte eine große graue Lücke bis zur Tastatur.
- **Ursache:** Mein Loop-#6-Effekt pinnte `.m-app` auf `visualViewport.height`.
  Der Body ist bewusst `position:fixed; top:0` (MobileWorkspace Z. 53–57, genau
  um das iOS-Hochscrollen zu verhindern). Das Schrumpfen von `.m-app` hebelte
  diese Garantie aus: App oben verankert, sichtbarer Viewport bei Tastatur-Fokus
  nach unten gepant → verschobene Chrome + graue Lücke. Klassischer Fall von
  „Fix ohne Gerätetest verschlimmert das Problem".
- **Behebung:** Loop #6 **vollständig zurückgenommen** (Effekt, `appRef`,
  `useRef`-Import entfernt). Damit greift wieder die ursprüngliche, stabile
  Fixed-Body-Logik — keine Verschiebung, keine graue Lücke.
- **Audit (sorgfältig, statisch):** Layout ist eine saubere Flex-Spalte
  (TopBar/Canvas/Context/Dock) → keine Überlappung im Normalzustand;
  `.canvas-area { overflow:auto }` (app.css:624) schneidet Elemente am Seitenrand
  ab → kein Ragen über die Toolbar. Loops #4/#5/#7 (Text-Button, Confirm-Dialog,
  Seiten-Sprung) sind reines Flex/Overlay ohne Layout-Konflikt — bleiben bestehen.
- **VERIFY:** ✅ — typecheck ✅ · lint ✅ · build ✅.
- **Lehre:** Keine viewport-/layout-verändernden Mobile-Hacks ohne echten
  Gerätetest. Die Tastatur-Verdeckung (ursprüngliche #6-Motivation) ist ein
  bewusster, akzeptierter Trade-off der Fixed-Body-Architektur — NICHT mit
  ungetesteten Hacks „lösen".
