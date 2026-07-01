# PDFWorld

Eine **Light-Version von Adobe Acrobat**, die vollständig im Browser läuft. PDFWorld
bearbeitet PDFs **verlustfrei**: Originalinhalte (Text, Vektoren, Bilder) werden niemals
rasterisiert oder neu komprimiert – Bearbeitungen werden als zusätzliche Ebene exakt in
die bestehenden Seiten eingezeichnet.

> 🔒 **100 % lokal.** Keine Uploads, kein Server. Jede Datei bleibt auf deinem Gerät.

## Funktionen

### 1. Seitenverwaltung (verlustfrei)
- Start mit einer **leeren Seite** oder einem **hochgeladenen PDF** (beides direkt
  auf der Startseite)
- Mehrere PDFs **zusammenführen**
- Seiten per **Drag & Drop sortieren**
- Seiten **einfügen** (leer, über das **+** an jeder Seite), **duplizieren**,
  **löschen**, **drehen**
- **Seiten anordnen (Vollbild)** – ein Umschalter öffnet alle Seiten in einem
  grossen Raster; oben rechts lassen sich eine **leere Seite** oder ein **weiteres
  PDF** anfügen, ideal um auch 30–40 Seiten bequem zu sortieren. Seiten aus
  **demselben Quell-PDF** tragen eine **dezente gemeinsame Farbe**, damit
  zusammengeführte Dokumente auf einen Blick auseinanderzuhalten sind. **Mehrere
  Seiten gleichzeitig** lassen sich auswählen – einen **Rahmen aufziehen** oder mit
  **⌘/Strg-Klick** bzw. **Shift-Klick** – und dann gemeinsam **drehen,
  duplizieren, löschen** oder per Drag & Drop **verschieben**

### 2. Bearbeitung
- **Text scannen & direkt bearbeiten (in-place)** – ein Scan erkennt jede Textzeile
  und markiert sie als klickbares Feld. **Ein Klick auf die Zeile öffnet sie sofort
  zum Umschreiben** – wie in Adobe Acrobat: der Originaltext steht vorbefüllt im
  Editor, in **derselben Schrift, Grösse, Farbe und auf exakt derselben Grundlinie**;
  die Einfügemarke landet dort, wo geklickt wurde. Das Original darunter wird mit der
  **automatisch abgetasteten Hintergrundfarbe** unsichtbar abgedeckt – die Abdeckung
  ist **an der Seite verankert**, deckt also auch dann noch die ganze Originalzeile,
  wenn der neue Text kürzer ist oder später verschoben/gedreht wird. Ein kompakter
  **Chip über der Zeile** zeigt den echten Schriftnamen, Grösse/Stil, ob die
  **Originalschrift eingebettet** ist (dann wird sie **1:1 wiederverwendet**, auf dem
  Bildschirm und im Export) und die erkannte Schriftfarbe. **Schliessen ohne Änderung
  hinterlässt keinerlei Spur** im Dokument – Zeilen lassen sich also gefahrlos
  inspizieren. Ein erneuter Klick auf eine umgeschriebene Zeile öffnet sie wieder.
  Die Erkennung greift auf eine **grosse Schrift-Datenbank** (über 150 Faces) zu und
  säubert run-together-Namen aus dem PDF („PaalalabasDisplayCondensedBETA“ →
  „Paalalabas Display Condensed BETA“). Bekannte Schriften (Arial, Times New Roman,
  Roboto …) werden **exakt benannt**, eingebettete Originale mit ihrem echten Namen
  gezeigt – lässt sich eine Schrift weder zuordnen noch einbetten, steht ehrlich
  **„Unbekannt“**, damit angezeigter Name und tatsächlich genutzte Schrift nie
  auseinanderfallen. Über das **T-Symbol im Chip** (oder den Knopf im Inspector
  jedes Textfelds) lässt sich die Schrift zusätzlich **für neuen Text übernehmen** –
  der nächste Klick auf die Seite setzt dort ein leeres Textfeld in exakt dieser
  Schrift, ohne Abdeckung. Die Metrik-Familie (Serif/Sans/Mono) wird aus dem
  **echten Schriftnamen** abgeleitet, nicht aus dem generischen Notnamen von pdf.js –
  so wird z. B. eine eingebettete **DejaVu-Serif**-Zeile nie als Helvetica geführt
- **Mehrfachauswahl** – mit dem Auswählen-Werkzeug einen **Rahmen aufziehen**, um
  mehrere Elemente auf einmal zu markieren (Shift-Klick fügt einzelne hinzu/entfernt
  sie); danach lassen sie sich **gemeinsam verschieben**, duplizieren oder löschen
- **Pixelgenaue Ausrichtung** – ausgewählte Felder lassen sich mit den **Pfeiltasten**
  Pixel für Pixel verschieben (1 px, mit Shift 10 px – unabhängig vom Zoom)
- **Ausrichten mit Hilfslinien** – beim Verschieben eines Textfelds rastet es sanft auf
  die **Grundlinie der Buchstaben** einer Nachbarzeile (waagrecht) und auf deren
  **linken Anfang** (senkrecht) ein – gemessen am Text selbst, nicht am Kasten. So
  bringst du Listen- und Absatz-Anfänge präzise auf eine Linie; eine dezente
  **Hilfslinie** bestätigt die Ausrichtung. Die waagrechte Linie ist **exakt auf die
  Schrift-Grundlinie kalibriert** (inkl. Zeilenhöhe), sodass Bildschirm, Hilfslinie
  und Export deckungsgleich sind
- **Drehen** – jedes Element (Textfeld, Form, Bild …) lässt sich per Regler frei
  drehen; die Drehung wird verlustfrei exakt so in die Seite gezeichnet
- **Bereich ausschneiden / kopieren** – einen Bereich als **Rechteck** aufziehen
  oder mit gedrückter Maus **freihändig umfahren (Lasso)**: er wird in **voller
  Originalqualität (1:1)** herausgelöst und – beim Lasso entlang der gezogenen Linie
  zugeschnitten – als frei verschiebbares Stück eingefügt (sofort angewählt). Der
  Bereich wird dafür direkt aus dem PDF in Druckdichte neu gerastert. Zwei Modi:
  **Ausschneiden** (Standard) deckt die Ursprungsstelle mit der **abgetasteten
  Seitenfarbe** ab, sodass das Stück wirklich „wegbewegt“ wird; **Kopieren** lässt
  das Original sichtbar. Die PDF-Inhalte selbst bleiben in beiden Modi verlustfrei
  erhalten. Stücke lassen sich verschieben, **duplizieren** (⌘/Strg + D) und
  **kopieren/einfügen** (⌘/Strg + C · V)
- **Sperren** – ein Element gegen versehentliches Verschieben sichern; ein dezentes
  Schloss-Symbol oben rechts erscheint kurz beim Anwählen zum Ent-/Sperren
- **Direkt tippen** – ein neues Textfeld landet genau auf der angeklickten Linie und
  ist sofort beschreibbar; **Enter** beginnt einen neuen Absatz, **Esc** (oder ein Klick
  daneben) schliesst ab
- **Hintergrund-Pinsel** – nimmt die exakte Hintergrundfarbe direkt unter dem
  Cursor auf und überdeckt Stellen ohne sichtbaren Unterschied. Eine **kleine Lupe**
  am Zeiger zeigt dabei pixelgenau, **welcher Farbpixel** gerade aufgenommen wird
  (samt Farbwert) – auf dem **Desktop schon beim Darüberfahren**, am **Handy beim
  Aufsetzen des Fingers**, sodass die Lupe nie hinter dem Finger verschwindet.
  Wahlweise als **freier Pinselstrich** oder als **randloses Rechteck** (ein
  Aufziehen füllt den Block direkt mit der aufgenommenen Hintergrundfarbe). Die
  aufgenommene Farbe wandert in die **Farbauswahl** und lässt sich per Klick als
  Schriftfarbe weiterverwenden
- **Neuen Text** hinzufügen – Standard **Grösse 9** und **Schwarz**, Auswahl aus
  einem Font-Picker mit **über 150 Schriften** (inkl. metrik-kompatibler Faces wie
  Arimo/Tinos/Carlito für Arial/Times/Calibri), der jeden Namen in seiner eigenen
  Schrift zeigt (System-, Standard- & Web-Schriften). Das Feld wird **mittig auf den
  Klick** gesetzt, sodass der Text genau dort landet, wo geklickt wurde. Beim Tippen
  fügt **Enter** einen neuen Absatz ein und das Feld **wächst mit**. **Listen**
  (Aufzählung oder nummeriert) lassen sich pro Textfeld einschalten
- **Sprechblasen / Kommentare** – eine **Sprechblase** mit Zeiger als Notiz auf der
  Seite platzieren (Umschalter im Text-Werkzeug), mit eigener Schrift- und Blasenfarbe
- **Elemente (Formen)** – ein **Formen-Menü** in der Werkzeugleiste mit Rechteck,
  Ellipse, Dreieck, rechtwinkligem Dreieck, Raute, Fünf-/Sechs-/Achteck,
  Parallelogramm, Trapez, Stern, Herz, Wolke, Kreuz, Chevron, Pfeil, Doppelpfeil
  und Linie; ein **einzelner Klick** setzt die Form in Standardgrösse (Aufziehen für
  eine eigene Grösse bleibt möglich); Füllung, Rand, Randstil und Drehung frei
  einstellbar
- **Farbauswahl** – ein aufgeräumter Farbwähler mit kuratierter Palette, zuletzt
  verwendeten Tönen und – wo der Browser es unterstützt – einer **Pipette**, die eine
  Farbe direkt aus dem Dokument aufnimmt
- **Formulare ausfüllen** – interaktive AcroForm-Felder werden erkannt und befüllt
- **Unterschrift** zeichnen oder als Bild hochladen
- **Bilder** platzieren und **bearbeiten** – **verlustfrei** eingefügt: PNG und
  JPEG werden **Byte für Byte im Original** eingebettet, jedes andere Format (WebP,
  GIF, BMP …) wird **pixelgenau verlustfrei zu PNG** umgewandelt, damit die Qualität
  immer dem Original entspricht. **Zuschneiden** (Ränder per Griffe anpassen) und mit
  einem **Rand** versehen (Dicke · Stil · Farbe)
- **Markieren** – als **Textmarker-Stift** mit ovaler Spitze frei über den Text
  gezeichnet (Standard) oder als **Rechteck** über eine ganze Textzeile (echter
  Multiply-Blend, damit der Text darunter lesbar bleibt) – jederzeit umschaltbar
- **Freihändig zeichnen** – ein **Stift** mit frei wählbarer **Farbe**, **Stärke**
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
- **Logo = Home** – ein Klick auf das **PDFWorld**-Logo oben links führt zurück
  zur Startseite
- **Scrollen wechselt die Seite** – am Seitenrand weiter zu scrollen blättert
  **eine Seite weiter** (vor/zurück): **genau eine Seite pro Scroll-Geste** (eine
  leichte Bewegung springt nie mehrere Seiten), mit einem **geschmeidigen, sanft
  einblendenden Übergang** zur nächsten Seite
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
