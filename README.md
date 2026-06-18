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
- Seiten **einfügen** (leer, über das **+** an jeder Seite), **duplizieren**,
  **löschen**, **drehen**
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
  **„In dieser Schrift schreiben“** wird die Schrift **übernommen** – der **nächste
  Klick auf die Seite** setzt dort ein leeres Textfeld in **exakt dieser Schrift**
  (gleiche Grösse, gleicher Stil mit **Fett/Kursiv**, gleiche Farbe), **ohne
  Hintergrund-Abdeckung**, sodass das Original darunter unangetastet bleibt. So
  wählst du frei, **wohin** der Text kommt, statt ihn fest auf die Zeile zu setzen
- **Pixelgenaue Ausrichtung** – ausgewählte Felder lassen sich mit den **Pfeiltasten**
  Pixel für Pixel verschieben (1 px, mit Shift 10 px – unabhängig vom Zoom)
- **Ausrichten mit Hilfslinien** – beim Verschieben eines Textfelds rastet es sanft auf
  die **Grundlinie der Buchstaben** einer Nachbarzeile (waagrecht) und auf deren
  **linken Anfang** (senkrecht) ein – gemessen am Text selbst, nicht am Kasten. So
  bringst du Listen- und Absatz-Anfänge präzise auf eine Linie; eine dezente
  **Hilfslinie** bestätigt die Ausrichtung
- **Drehen** – jedes Element (Textfeld, Form, Bild …) lässt sich per Regler frei
  drehen; die Drehung wird verlustfrei exakt so in die Seite gezeichnet
- **Bereich ausschneiden / duplizieren** – einen Bereich als **Rechteck** aufziehen
  oder mit gedrückter Maus **freihändig umfahren (Lasso)**: er wird in **voller
  Originalqualität (1:1)** dupliziert und – beim Lasso entlang der gezogenen Linie
  zugeschnitten – als frei verschiebbares Stück eingefügt (sofort angewählt). Der
  Bereich wird dafür direkt aus dem PDF in Druckdichte neu gerastert – **das Original
  bleibt vollständig erhalten**. Stücke lassen sich verschieben, **duplizieren**
  (⌘/Strg + D) und **kopieren/einfügen** (⌘/Strg + C · V)
- **Sperren** – ein Element gegen versehentliches Verschieben sichern; ein dezentes
  Schloss-Symbol oben rechts erscheint kurz beim Anwählen zum Ent-/Sperren
- **Direkt tippen** – ein neues Textfeld landet genau auf der angeklickten Linie und
  ist sofort beschreibbar; **Enter** schliesst ab, **Shift + Enter** macht einen Umbruch
- **Hintergrund-Pinsel** – nimmt die exakte Hintergrundfarbe direkt unter dem
  Cursor auf und überdeckt Stellen ohne sichtbaren Unterschied. Wahlweise als
  **freier Pinselstrich** oder als **randloses Rechteck** (ein Aufziehen füllt den
  Block direkt mit der aufgenommenen Hintergrundfarbe). Die aufgenommene Farbe
  wandert in die **Farbauswahl** und lässt sich per Klick als Schriftfarbe
  weiterverwenden
- **Neuen Text** hinzufügen – Standard **Grösse 9** und **Schwarz**, Auswahl aus
  einem Font-Picker mit **~90 Schriften**, der jeden Namen in seiner eigenen Schrift
  zeigt (System-, Standard- & Web-Schriften). Das Feld wird **mittig auf den Klick**
  gesetzt, sodass der Text genau dort landet, wo geklickt wurde. **Listen** (Aufzählung
  oder nummeriert) lassen sich pro Textfeld einschalten
- **Sprechblasen / Kommentare** – eine **Sprechblase** mit Zeiger als Notiz auf der
  Seite platzieren (Umschalter im Text-Werkzeug), mit eigener Schrift- und Blasenfarbe
- **Elemente (Formen)** – ein **Formen-Menü** in der Werkzeugleiste mit Rechteck,
  Ellipse, Dreieck, Raute, Stern, Pfeil und Linie; Füllung, Rand, Randstil und Drehung
  frei einstellbar
- **Farbauswahl** – ein aufgeräumter Farbwähler mit kuratierter Palette, zuletzt
  verwendeten Tönen und – wo der Browser es unterstützt – einer **Pipette**, die eine
  Farbe direkt aus dem Dokument aufnimmt
- **Formulare ausfüllen** – interaktive AcroForm-Felder werden erkannt und befüllt
- **Unterschrift** zeichnen oder als Bild hochladen
- **Bilder** platzieren und **bearbeiten** – **zuschneiden** (Ränder per Griffe
  anpassen), mit einem **Rand** versehen (Dicke · Stil · Farbe) und den **Hintergrund
  entfernen**: ein automatischer Magic-Wand löst einfarbige/ähnliche Hintergründe von
  den Rändern her (mit Toleranz-Regler), feine **Behalten/Entfernen-Pinsel** bessern
  von Hand nach – verlustfrei in voller Bildauflösung angewandt
- **Markieren** – als **Rechteck** über eine Textzeile oder als **Textmarker-Stift**
  mit ovaler Spitze frei über den Text gezeichnet (echter Multiply-Blend, damit der
  Text darunter lesbar bleibt)
- **Freihändig zeichnen** – ein vollwertiges Zeichen-Werkzeug mit **Stift** oder
  **Marker** (durchscheinender Multiply-Strich), frei wählbarer **Farbe**, **Stärke**
  (bis 24 pt), **Deckkraft** und **Linienstil** (durchgezogen · gestrichelt · gepunktet),
  mit **Live-Vorschau** des Strichs. Jede Eigenschaft lässt sich später am ausgewählten
  Strich weiter anpassen
- **Bereiche schwärzen** (schwarzer Balken)
- **Elemente-Übersicht** – ein Symbol links öffnet eine **Ebenen-Ansicht** aller
  Bearbeitungen: eine **Mini-Karte der Seite** (das **PDF mit Markern** über jedem
  Element, vergrösserbar) plus eine nach Seiten gruppierte Liste. Elemente lassen sich
  von dort **anwählen**, **ein-/ausblenden** (das Auge) und **löschen** – so behältst du
  auch bei vielen Einfügungen den Überblick. Bei geöffneter Übersicht werden alle
  Elemente zusätzlich dezent auf der Seite umrandet

### 3. Oberfläche
- **Helles & dunkles Design** (umschaltbar, merkt sich die Wahl)
- **Zoom bis 2000 %** – per Lupen-Buttons (zoomt auf die **Mitte des sichtbaren
  Fensters**) oder ⌘/Strg + Mausrad bzw. Trackpad-Pinch (zoomt **genau dort, wo der
  Cursor steht**) – das Dokument bleibt beim Zoomen an Ort und Stelle
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
- **Markieren**: der **Stift** nutzt einen echten Multiply-Blend (Text bleibt lesbar);
  das **Rechteck** deckt mit einer halbtransparenten Fläche ab.
- **Digitale Signaturen** im Originaldokument werden durch Bearbeitung ungültig (erwartetes
  Verhalten beim Editieren).
- Rotierte Seiten mit bereits gesetzten Annotationen: Annotationen werden beim Drehen nicht
  mitgedreht (Rotation ist primär zum Geraderücken von Scans gedacht).

---

Entwickelt für maximale Qualität · *powered by Fiko*
