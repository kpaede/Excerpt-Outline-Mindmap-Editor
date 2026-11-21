# Mehrzeilige Gedanken: abschließender Prüfstand

Stand: 21. November 2026, lokaler Entwicklungsbuild 0.2.2.

Die ursprüngliche Abnahme mit 226 Tests war unzureichend: Sie deckte mehrere
reale Oberflächenregressionen nicht ab. Dieser Bericht ersetzt jene Aussagen.
Die kritische Prüfung aller geänderten Produktionsdateien steht in
[regression-audit.md](regression-audit.md). Konkrete UI-Prüfungen und Messwerte
stehen zusätzlich in [regression-audit-results.json](regression-audit-results.json).

## Festgelegtes Verhalten

- Knoten zeigen ihren vollständigen Inhalt in mitwachsender Höhe ohne interne
  Vorschau-Scrollleisten. Nur der geöffnete Texteditor scrollt bei langen Texten.
- Enter setzt native Listen fort beziehungsweise verlässt den leeren Listenpunkt.
  Außerhalb von Listen speichert Enter, auch in Zitaten und Codeblöcken.
- Shift+Enter fügt einen wörtlichen Umbruch ein. Ctrl/Cmd+Enter speichert überall.
- Gemischte Text-/Zeichnungsknoten öffnen bei Edit den vollständigen Markdown-Text;
  reine Zeichnungsknoten behalten ihren Zeichnungseditor.
- Knotenzähler und lesbarer Startzoom großer Karten bleiben wie ausdrücklich bestätigt.
- Alte Dateien werden beim Öffnen weder umgeschrieben noch migriert.

## Automatisierte Prüfung

307 Tests in 29 Dateien bestanden, einschließlich der bisherigen Tests.
TypeScript, Produktionsbuild mit mobiler Startprüfung, ESLint und diff-Prüfung
werden zusätzlich ausgeführt. Parser, Schreiber und echte Strukturaktionen sind
beteiligt; gezählt wird nicht bloß die Anzahl von Knoten.

Die Tests vergleichen Inhalte, Aufgabenstatus und vollständige Baumstruktur.
Sie enthalten Rand-Whitespace, interne Listen aller Marker, Code und Kommentare,
Unicode, Links/Einbettungssyntax, Leerzustände, LF/CRLF, tiefe Bäume, mehr als eine
Million Zeichen, zwölf Undo-/Redo-Stufen und 500 gemischte Strukturaktionen mit
unabhängigem Vergleichsbaum. Zusätzliche Regressionsfälle prüfen identische leere
Knoten, nach Cut veränderte Quellen, beide Zwischenablageformate, schnelle
Undo-/Redo-Aufrufe, parallele Markdown-Editoren und noch unfertige Syntaxbäume.

## Praktische Prüfung im Vault Testprogramm 2

73 unterschiedliche praktische Prüfungen bestanden (Wiederholungen sind in den
Rohdaten enthalten). Die ursprüngliche offene Datei ist bytegleich erhalten;
Modell, Graph, DOM und Zähler melden beim Abschluss jeweils 128 Knoten.
Der ursprüngliche Tab ist wieder aktiv, Testansichten sind geschlossen und die
Fokus-Emulation ist beendet.

Neue isolierte Dateien liegen im Ordner
`EOME regression audit 2026-11-21T17-35-35-742Z`.

Geprüft wurden native Browser-Tastatureingaben, reale Menüschalter, DOM-Drag-and-drop,
Checkboxklicks, vollständiges Einfügen im echten CodeMirror-Editor, strukturelle
Zwischenablage, Duplizieren, Mehrfachaktionen, Löschen mit erhaltenen Kindern,
Undo/Redo, Navigation, Überschriften und neue Knoten in leeren Abschnitten.
Ein echter externer Konflikt behält den bearbeitbaren Entwurf. Unmittelbares
Speichern/Undo/Redo synchronisiert einen parallel offenen Markdown-Editor.

Die Migration wurde mit echter Vorschau, Bestätigung und vollständigem Backup
bedient. Die anschließende Wiederherstellung erhielt exakt den alten Dateitext
und legte zuvor ein weiteres Backup des migrierten Zustands an.

Checkboxdarstellung und sofortige Wirkung der Hover-Option wurden an bestehenden
DOM-Knoten geprüft, einschließlich heller/dunkler Darstellung und erneutem Öffnen.
Direkt aufeinanderfolgende Einstellungsänderungen erhalten vorherige Werte.
Canvas-, SVG- und PDF-Export wurden tatsächlich ausgeführt; die Markdown-Quelle
blieb unverändert. Die schreibgeschützte Mindmap-Einbettung rendert alle Knoten.

| Praktisches Dokument | Umfang | Geprüft |
| --- | --- | --- |
| Tiefer Baum | 120.595 Zeichen, 62 Gedanken, 60 Unterebenen | Modell, Graph, DOM, Kanten, volle Vorschau, Task/Undo, Unterbaumverschieben/Undo |
| Langer Einzelinhalt | 101.805 Zeichen, drei Gedanken | Vollständiger Auszug samt Endmarke und echtem Kind, volle Höhe, Task/Undo, Verschieben/Undo |
| Langtexteditor | mehr als 100.000 Zeichen im geöffneten Editor | Enter am letzten Listenpunkt, vollständiges Speichern und exaktes Undo |
| Legacy-Datei | Tab-Hierarchie und Aufgaben | Keine automatische Migration; Task, Duplikat, Verschieben und Undo erhalten die ursprünglichen Bytes |

Gemessene Öffnungszeiten im durchgeführten Lauf: 439–576 ms für den tiefen Baum
und 316–383 ms für den langen Auszug. Die Task-/Undo-Einzelmessungen lagen über
die dokumentierten Wiederholungen bei 4–100 ms.
Das sind konkrete Messungen dieser Testumgebung, keine allgemeine Garantie für
beliebige Renderer, Geräte oder Vaults. Temporäre Messcontainer blieben nach
abgeschlossenen Durchläufen nicht zurück. Renderressourcen und Cachegrenzen werden
zusätzlich automatisiert geprüft.

## Bekannte Grenzen der Abnahme

Physische iOS-/Android-Geräte und echter Pencil-Druck wurden in diesem Durchlauf
nicht bedient. Dafür bestehen die bisherigen automatisierten Gesten-/Zeichnungstests
und die Prüfung des mobilen Pluginstarts; sie ersetzen keinen Gerätetest.
Die Vektorexporte wurden am kleinen mehrzeiligen Dokument geprüft, nicht am
riesigen Einzelknoten. PDF wurde erzeugt und auf seine Dateisignatur geprüft;
eine vollständige visuelle Kontrolle jeder PDF-Seite ist damit nicht behauptet.

Die interne Aufgabenliste ist Markdown-Inhalt; ein Klick in ihrer Vorschau
veränderte weder strukturelle Aufgaben noch die Datei. Ihre Bearbeitung erfolgt
im Texteditor. Externe gültige Strukturänderungen lassen die frühere Absicht
nicht rekonstruieren. Identische extern umgeschriebene Knoten haben deshalb
keine beliebig wiederherstellbare alte Identität.

## Lineage-Kompatibilität

Geprüft wurde der unveränderte öffentliche Lineage-Quellcode, Version **0.8.5**,
Commit `38b220c9f8c54f8507ed3f02f2e1aeb8884408d6`:
[Lineage-Repository](https://github.com/ycnmhd/obsidian-lineage/tree/38b220c9f8c54f8507ed3f02f2e1aeb8884408d6).

Zehn Prüfungen mit Originalcode bestanden. Dazu gehören beide Richtungen mit
Parser und Schreiber, vollständige versionierte Dateien mit Lineages eigener
Frontmatter-Abtrennung und `stringifyDocument`, der tatsächliche Columns-
Schreibpfad sowie eine tatsächliche Lineage-Unterbaumverschiebung. Es wurde
keine nachgebaute Kopie seines Parsers als Kompatibilitätsbeweis verwendet.

Der nachgewiesene gemeinsame Umfang umfasst tabbasierte Hierarchie, mehrere
Absätze mit nichtleerem Anfang und ohne Rand-Whitespace, interne Listen,
Blockzitate, interne Überschriften, Code ohne Abschnittskommentar, Unicode,
Links, Einbettungssyntax, Kinder, Enkel und Aufgabenpräfixe. EOME erhält innerhalb
seines eigenen Formats mehr Fälle als dieser gemeinsame Umfang.

Reproduzierte Grenzen des unveränderten Lineage:

- Struktur-Tabs durch Leerzeichen zu ersetzen verändert seine Interpretation.
- `<!--section: 1-->` wird auch innerhalb von Code zurückgewiesen.
- Führende Leerzeilen gehen in bestimmten Parserfällen verloren.
- Der Columns-Schreibpfad verwendet `trim()` und entfernt Rand-Whitespace.
- EOMEs Escape für wörtliche Aufgabenpräfixe und Backslashes wird in Lineage
  nicht als EOME-Escape dekodiert. Der zusätzliche Backslash kann sichtbar sein.
- Der verifizierte gemeinsame Dateikörper besteht aus Gedanken, nicht aus
  zusätzlichen äußeren Überschriften/Prosa. Solche EOME-Dokumentbereiche wurden
  nicht als gemeinsam mit Lineage bearbeitbar nachgewiesen.
- Die vollständigen Datei-Rundläufe wurden mit LF geprüft. CRLF ist innerhalb
  EOMEs getestet; Lineages Frontmatter-Abtrennung erwartet in diesem Stand LF.

Die Lineage-Oberfläche wurde nicht installiert oder manuell bedient. Die
Original-Konverter und die Original-Verschiebeoperation wurden real ausgeführt.
Eine Verbesserung von EOME behebt keine Datenverluste im Lineage-Schreibpfad.


## Wiederholung

- `npm test`, `npm run lint`, `npm run build`, `git diff --check`.
- `scripts/vault-regression-audit.mjs` enthält die isolierten Live-Prüfungen.
  Zuerst `protect`, dann `setup`; die benannten Stufen arbeiten an den eigenen
  Fixtures. `summary` sichert die Resultate, `cleanup` stellt den ursprünglichen
  Tab wieder her und beendet die Fokus-Emulation.
- `scripts/vault-scroll-tests.mjs` prüft die echte Mausradeingabe bei voller
  Knotenhöhe. Es erwartet die vorbereitete Audit-Sitzung.
- `LINEAGE_SOURCE=/pfad/zum/unveränderten/lineage node scripts/check-lineage.mjs`
  führt die zehn Tests mit dem tatsächlichen Lineage-Quellcode aus.

Die Live-Tests benötigen die laufende Obsidian-Desktop-App und deren CLI.
Sie werden nicht heimlich beim Pluginstart oder in einem anderen Vault ausgeführt.


## Ergänzung zur Abnahme

Die zusätzliche klassische Moduswahl mit gezähltem Sicherheitshinweis sowie
fortlaufendes Scrollen/Zoomen wurden gesondert nachgeprüft. Siehe
[Editor- und Performance-Nachprüfung](editor-mode-and-viewport-performance.md).
Die oben genannten früheren 73 praktischen Prüfungen bleiben dokumentiert;
die zusätzlichen Modus-, Export-, Menü- und Gestenprüfungen stehen im Nachtrag.
