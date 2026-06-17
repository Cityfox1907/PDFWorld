# PDFWorld

Eine **Light-Version von Adobe Acrobat**, die vollständig im Browser läuft. PDFWorld
bearbeitet PDFs **verlustfrei**: Originalinhalte (Text, Vektoren, Bilder) werden niemals
rasterisiert oder neu komprimiert – Bearbeitungen werden als zusätzliche Ebene exakt in
die bestehenden Seiten eingezeichnet.

> 🔒 **100 % lokal.** Keine Uploads, kein Server. Jede Datei bleibt auf deinem Gerät.

## Funktionen

### 1. Seitenverwaltung (verlustfrei)
- Mehrere PDFs **zusammenführen**
- Seiten per **Drag & Drop sortieren**
- Seiten **einfügen** (leer), **duplizieren**, **löschen**, **drehen**
- **Übersicht zoomen** – Thumbnails stufenlos vergrössern, um direkt in die
  Seitentexte hineinzuzoomen
- **Seiten anordnen (Vollbild)** – ein Umschalter öffnet alle Seiten in einem
  grossen Raster, ideal um auch 30–40 Seiten bequem zu sortieren

### 2. Bearbeitung
- **Text scannen & bearbeiten** – ein Scan erkennt jede Textzeile und bündelt sie
  zu klickbaren Blöcken. Beim Antippen zeigt ein **Schrift-Panel** den echten
  Schriftnamen, eine **Vorschau in genau dieser Schrift**, Grösse, Stil und Farbe
  der Zeile und ob die **Originalschrift** eingebettet (und damit 1:1 nutzbar) ist.
  Generische Namen wie „sans-serif“ werden korrekt der richtigen Familie zugeordnet
  und bekannte Schriften (Arial, Times New Roman, Roboto …) exakt benannt – so
  stimmen angezeigter Name und tatsächlich genutzte Schrift immer überein. Mit
  **„Originalschrift übernehmen“** wird die Zeile in exakt dieser Schrift ersetzt,
  mit **„Neues Feld darunter · 9 pt“** ein leeres Feld in derselben Schrift direkt
  unter der Zeile angelegt
- **Pixelgenaue Ausrichtung** – ausgewählte Felder lassen sich mit den **Pfeiltasten**
  verschieben (1 pt, mit Shift 10 pt); beim Bewegen rastet ein Textfeld auf der
  **Grundlinie der Nachbarzeile** ein (sichtbare Hilfslinie, Alt hält frei), damit
  nebeneinanderstehende Texte nie versetzt wirken
- **Hintergrund-Pinsel** – nimmt die exakte Hintergrundfarbe direkt unter dem
  Cursor auf und überdeckt Stellen ohne sichtbaren Unterschied. Die aufgenommene
  Farbe wandert in die **Farbauswahl** und lässt sich per Klick als Schriftfarbe
  weiterverwenden
- **Neuen Text** hinzufügen – Standard **Grösse 9** und **Schwarz**, Auswahl aus
  einem Font-Picker mit **~90 Schriften**, der jeden Namen in seiner eigenen Schrift
  zeigt (System-, Standard- & Web-Schriften)
- **Farbauswahl** – ein aufgeräumter Farbwähler mit kuratierter Palette, zuletzt
  verwendeten Tönen und – wo der Browser es unterstützt – einer **Pipette**, die eine
  Farbe direkt aus dem Dokument aufnimmt
- **Formulare ausfüllen** – interaktive AcroForm-Felder werden erkannt und befüllt
- **Unterschrift** zeichnen oder als Bild hochladen
- **Bilder** platzieren
- **Markieren**, **freihändig zeichnen**, **Rechtecke/Ellipsen**, **Bereiche schwärzen**

### 3. Oberfläche
- **Helles & dunkles Design** (umschaltbar, merkt sich die Wahl)
- **Zoom bis 1000 %** – per Lupen-Buttons oder ⌘/Strg + Mausrad (Trackpad-Pinch)
- **Speichern-Dialog** – Dateiname ändern und Zielordner wählen, bevor gespeichert wird
  (nativer Speicherort-Dialog, wo der Browser ihn unterstützt)
- Tastaturkürzel für jedes Werkzeug, Undo/Redo, Speichern

## Warum „ohne Qualitätsverlust"?

Der entscheidende Unterschied zu vielen Web-Tools: PDFWorld **rendert Seiten nicht zu
Bildern**. Stattdessen:

- **pdf.js** rendert die Seiten nur zur *Anzeige* und extrahiert Textpositionen.
- **pdf-lib** hält das echte Dokument. Beim Speichern werden Bearbeitungen als
  zusätzliche Zeichenoperationen in die **unveränderten** Seiten-Streams eingebettet.
- Seiten umsortieren/zusammenführen nutzt `copyPages` – Inhalte werden 1:1 kopiert.

Dadurch bleiben Text scharf und durchsuchbar, Bilder in Originalauflösung und Vektoren
gestochen – egal wie oft gespeichert wird.

## Tech-Stack

- **React 19 + TypeScript** (strict)
- **Vite 8** Build, optimiert für **Vercel**
- **pdf-lib** (Bearbeitung/Export) · **pdf.js** (Anzeige/Textextraktion) · **fontkit**
- **Zustand** (State + Undo/Redo) · **dnd-kit** (Seiten-Sortierung) · **lucide-react** (Icons)

## Entwicklung

```bash
npm install
npm run dev          # Entwicklungsserver
npm run build        # Produktionsbuild (tsc + vite) → dist/
npm run preview      # Build lokal ansehen
npm run typecheck    # strikter Typecheck
npm run lint         # ESLint
npm run test:engine  # Headless-Tests der PDF-Engine (Verlustfreiheit)
```

## Architektur

```
src/
  lib/pdf/        Die PDF-Engine (DOM-frei + testbar)
    document.ts   Engine: hält pdf-lib & pdf.js synchron, orchestriert Export
    pages.ts      Seiten-Assemblierung (Reorder/Merge/Blank/Duplikat/Rotation)
    bake.ts       Zeichnet Overlay-Elemente verlustfrei in die Seiten
    coords.ts     View↔Content-Koordinaten inkl. Seitenrotation (0/90/180/270)
    forms.ts      AcroForm lesen / ausfüllen / flatten
    fonts.ts      Schrift-Klassifikation → Standardfonts
    render.ts     pdf.js Rendering + Textextraktion
  state/          Zustand-Stores (Dokument + UI)
  components/     React-UI (Canvas, Sidebar, Inspector, …)
scripts/
  test-engine.ts  28 Headless-Tests, die die Verlustfreiheit beweisen
```

## Deployment (Vercel)

Das Projekt ist als Vite-App vorkonfiguriert (`vercel.json`). Repository in Vercel
importieren – Build-Command `npm run build`, Output `dist`. Da alles clientseitig läuft,
wird kein Backend benötigt.

## Bekannte Grenzen (ehrliche Einordnung)

- **Schrift bei Textbearbeitung:** Beim Scannen wird die **im PDF eingebettete
  Originalschrift** extrahiert und für die Bearbeitung wiederverwendet (Bildschirm +
  Export) – das Ergebnis ist dann pixelgenau identisch. Ist die Schrift nicht eingebettet
  (oder nicht einbettbar), greift automatisch der metrisch sehr ähnliche Standardfont
  (Helvetica/Times/Courier) – nie ein Bruch. Tippt man Zeichen, die der Original-Subset
  nicht enthält, weicht der Export für diese Zeichen auf den Standardfont aus.
- **Schwärzen** deckt Inhalte visuell ab (schwarzer Balken). Der darunterliegende Text
  bleibt technisch im PDF – es ist **keine** sicherheitskritische Redaktion.
- **Markieren** nutzt halbtransparente Flächen (kein echter Multiply-Blendmodus).
- **Digitale Signaturen** im Originaldokument werden durch Bearbeitung ungültig (erwartetes
  Verhalten beim Editieren).
- Rotierte Seiten mit bereits gesetzten Annotationen: Annotationen werden beim Drehen nicht
  mitgedreht (Rotation ist primär zum Geraderücken von Scans gedacht).

---

Entwickelt für maximale Qualität · *powered by Fiko*
