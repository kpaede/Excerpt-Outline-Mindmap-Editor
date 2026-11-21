# Kritische Regressionsprüfung des gesamten Umbaus

Stand: 21. November 2026. Vergleichsgrundlage ist der Git-Stand `HEAD`, vor den
noch nicht committeten Änderungen dieses Auftrags. Die Prüfung umfasst alle
36 geänderten oder neu hinzugefügten Produktionsdateien, einschließlich CSS.
Build-/Abhängigkeitsänderungen, Dokumentation und Testtreiber sind separat genannt.

Die vorherige Testabnahme hatte sich zu stark auf Datenmodell und automatisierte
Teilprüfungen verlassen. Dadurch blieben echte UI-Regressionspfade ungetestet:
CSS-Spezifität, sofortige Wirkung einer Einstellung, Editor-Schließreihenfolge
und die tatsächliche Syntaxbaumform von Obsidian. Diese Abnahme war zu weitgehend.

## Korrekturen aus der Prüfung

1. Die ungefragte Höhenbegrenzung und Vorschau-Scrollleisten sind entfernt.
2. Erledigte Aufgaben erhalten wieder gedämpfte Text-, Rahmen- und Hintergrundfarben.
3. Der vorhandene Hover-Checkbox-Schalter aktualisiert bereits gerenderte Knoten sofort.
4. Der Task-Schnellpfad überspringt keine Überschriften-/Frontmatteränderungen mehr.
5. Nach dem Speichern wird der Editor zuerst geschlossen und dann die Vorschau
   aktualisiert. Mausaktionen verwenden aktuelle Knoten statt alte Snapshots.
6. Listen-Enter wird gegen echtes HyperMD geprüft. Unfertige Syntaxbäume in langen
   Texten werden mit kurzen Parserabschnitten vervollständigt, nicht als normaler
   Absatz fehlklassifiziert. Neue Eingaben brechen eine alte wartende Entscheidung ab.
7. Cut/Paste verschiebt den aktuellen Unterbaum, auch nach einer Bearbeitung zwischen
   Cut und Paste. Der ältere Clipboardtext überschreibt keine neueren Inhalte.
8. Dateiwechsel setzen dateibezogenen Zustand zurück. Die alte lokale Updateflagge
   darf das Zeichnen einer anderen Datei nicht unterdrücken. Einstellungen werden
   vor dem Zeichnen geladen.
9. Identische leere Knoten werden anhand der ausgeführten Operation zugeordnet.
10. Saubere parallele Markdown-Editoren werden nach Commit mit einer normalen
    Transaktion synchronisiert. Neuere Benutzereingaben werden nicht ersetzt.
11. Direkt aufeinanderfolgende Einstellungen lesen den aktuellen Dateistand.
12. Mehrdeutige Legacy-Unterbäume über äußere Überschriften werden vor Mutationen
    abgewiesen. Es erfolgt keine automatische Reparatur oder Umdeutung.
13. Die frühere Darstellung von Legacy-Inhalten wurde wiederhergestellt.
14. Gemischte Text-/Zeichnungsknoten öffnen gemäß Rücksprache als Markdown;
    reine Zeichnungen behalten ihren Editor. Knotenzähler und Startzoom bleiben.

## Prüfung jeder Produktionsdatei

Die Zeilen nennen das kontrollierte Verhalten. Sie sind keine Behauptung eines
formalen Fehlerfreiheitsbeweises. Testverfahren und praktische Grenzen folgen
im [Prüfbericht](multiline-test-report.md).

| Datei | Kritischer Prüfumfang |
| --- | --- |
| [src/domain/json-canvas.ts](../src/domain/json-canvas.ts) | Vollständiger v2-Inhalt einschließlich Rand-Whitespace; Legacy-Export behält seine bisherigen Regeln. |
| [src/domain/mindmap-file.ts](../src/domain/mindmap-file.ts) | Alle Mutationen gegen eigene Inhalte und ganze Unterbäume geprüft; Snapshotprüfung, Taskstatus getrennt, Cut verwendet aktuelle Quelle, mehrdeutige Legacy-Bereiche werden abgelehnt. |
| [src/domain/outline-format.ts](../src/domain/outline-format.ts) | Explizite v2-Grammatik, Task-Escapes, inklusive/exklusive Bereiche, Leerzeilen, LF/CRLF, Fehler statt verlustreicher Reparatur. |
| [src/domain/outline-migration.ts](../src/domain/outline-migration.ts) | Keine Migration beim Öffnen; semantische Nachprüfung und Erhalt außerhalb liegender Dokumentzeilen. |
| [src/domain/outline-session.ts](../src/domain/outline-session.ts) | Identitäten bei Edits und Moves; eindeutige Befehlszuordnung für identische Knoten; begrenzte vollständige Snapshot-Zuordnung für Undo/Redo. |
| [src/drawing/drawing-actions.ts](../src/drawing/drawing-actions.ts) | Genehmigte Unterscheidung gemischter Text-/Bildknoten und reiner Zeichnungsknoten; vorhandene Zeichnungsaktionen erhalten. |
| [src/editor/embeddable-markdown-editor.ts](../src/editor/embeddable-markdown-editor.ts) | Native Markdown-Engine erhalten; Schreibschutz ausschließlich während Commit, danach bei Fehler wieder bearbeitbar. |
| [src/editor/list-context.ts](../src/editor/list-context.ts) | CommonMark und echtes HyperMD geprüft; unfertiger Syntaxbaum ergibt unbekannt statt fälschlich außerhalb; Parserabschnitte mit UI-Pausen und Abbruch bei neuer Eingabe. |
| [src/editor/node-edit-session.ts](../src/editor/node-edit-session.ts) | Commit vor Schließen, Preview danach; Konflikte behalten Entwurf; kein späteres Refresh/Select eines bereits geschlossenen Editors. |
| [src/editor/node-editing.ts](../src/editor/node-editing.ts) | Vollständiger Inhalt, natives Listen-Enter, Shift-/Cmd+Enter, Escape, normales Paste, aktueller Knoten beim Maus-Reopen und feste Datei-/Quellbindung. |
| [src/editor/node-markdown.ts](../src/editor/node-markdown.ts) | Bisherige Legacy-Darstellung wiederhergestellt; v2-Markdown wird unverändert gerendert. |
| [src/history/command-history.ts](../src/history/command-history.ts) | Vollständige Zustände statt 50k-Abschneiden; geordnetes Undo/Redo, keine Indexverschiebung nach Konflikt, keine Historie aus anderer Datei. |
| [src/main.ts](../src/main.ts) | Bestehende Command-IDs erhalten; Migration explizit registriert; echte Editorflächen bei externem Refresh berücksichtigen. |
| [src/storage/document-writer.ts](../src/storage/document-writer.ts) | Serialisiertes Vault.process mit disk-/editorseitigem Vergleich; saubere Markdown-Views per normaler Transaktion aktualisieren, neuere Entwürfe nicht überschreiben; CRLF/LF berücksichtigt. |
| [src/storage/frontmatter-storage.ts](../src/storage/frontmatter-storage.ts) | Vorherige Einstellungen aus aktuellem Dateitext statt verzögertem Cache; Änderungen nur an eigener Eigenschaft, atomarer Schreibpfad und Fehlermeldung statt stiller Überschreibung. |
| [src/ui/modals/outline-migration-modal.ts](../src/ui/modals/outline-migration-modal.ts) | Vorschau, explizite Bestätigung, vollständiges Backup vor jeder Änderung; Restore ebenfalls mit Backup und Versionsprüfung. |
| [src/ui/toolbar/vertical-toolbar.ts](../src/ui/toolbar/vertical-toolbar.ts) | Bestätigter Knotenzähler; Checkbox-Hover nach bestehendem Schalter sofort aktualisieren; bisherige Menüs erhalten. |
| [src/utils/heading-sections.ts](../src/utils/heading-sections.ts) | Inhaltsüberschriften und Code erzeugen keine äußeren Abschnitte; linearer Aufbau der Inhaltszeilenmenge. |
| [src/utils/outline.ts](../src/utils/outline.ts) | Legacy/v2 getrennt, Frontmatter nicht als Gedanken; gemeinsame Grenzen und Schutz vor Legacy-Unterbäumen über äußere Überschriften. |
| [src/view/clipboard.ts](../src/view/clipboard.ts) | Kopiert Markdown ohne ungefragte Format-Frontmatter; eigenes Quellformat beim Formatwechsel bekannt; Cut-Auswahl über Identität nachführen. |
| [src/view/command-identities.ts](../src/view/command-identities.ts) | Konkrete Positionsverschiebungen aus tatsächlich ausgeführten Befehlen; add/edit/move/delete/keep/heading/cut und identische leere Knoten gegen echte Mutationen getestet. |
| [src/view/draw.ts](../src/view/draw.ts) | Ein Strukturmodell, aktuelle Messgeneration, Kanten und abgesprochener Startzoom; keine Vermischung veralteter Messungen. |
| [src/view/heading-frames.ts](../src/view/heading-frames.ts) | Überschrifteneditor im gleichen sicheren Abschlussablauf; neue Knoten in leeren Überschriften und native Buttons erhalten. |
| [src/view/initial-viewport.ts](../src/view/initial-viewport.ts) | Bestätigten lesbaren Startzoom beibehalten; gespeicherten Zoom respektieren und versteckte Tabs nicht falsch einpassen. |
| [src/view/measurement-cache.ts](../src/view/measurement-cache.ts) | Cache nach Zeichenanzahl und Anzahl begrenzt, vollständige Einträge statt gekürzter Schlüssel. |
| [src/view/measurement-styles.ts](../src/view/measurement-styles.ts) | Fehlende Plugin-CSS nach Reload nicht als winzige Knotengröße zwischenspeichern. |
| [src/view/mindmap-view.ts](../src/view/mindmap-view.ts) | Alle Command-Aufrufer und File-/Undo-/Auswahlpfade geprüft; dateigebundene Historie/IDs, Einstellungen vor Zeichnen, lokale Wiederholung nur bei gleichem Inhalt unterdrücken. |
| [src/view/node-measurement.ts](../src/view/node-measurement.ts) | Volle Höhe wiederhergestellt; temporäre Renderer aufräumen, Cache wiederverwenden, Plaintext in Batches messen und veraltete Durchläufe verwerfen. |
| [src/view/node-overlay-controls.ts](../src/view/node-overlay-controls.ts) | Bisherige Steuerelemente erhalten; Task-, Checked- und Hover-Klassen aus aktuellem Status und aktueller Einstellung setzen. |
| [src/view/node-render-resources.ts](../src/view/node-render-resources.ts) | Markdown-Renderobjekte an eine austauschbare Overlaygeneration binden und beim Ersetzen/Schließen entladen. |
| [src/view/task-overlay-update.ts](../src/view/task-overlay-update.ts) | Schneller Taskpfad nur bei gleichen Texten/Strukturen/Bereichen und ausschließlich veränderten Knotenzeilen; Überschriften/Frontmatter dürfen nicht übersprungen werden. |
| [src/view/update-overlays.ts](../src/view/update-overlays.ts) | Gemeinsames Modell, Renderressourcen aufräumen; bestehende DnD-/Kontrollpfade erhalten; keine Abzweigung für interne Vorschau-Scrollleisten mehr. |
| [styles.css](../styles.css) | Volle Vorschauhöhe, vollständige Editorfläche; Checked-Farben gegen spezifischere Geometrie-/Markdown-Regeln wiederhergestellt. |

| [src/editor/editing-mode.ts](../src/editor/editing-mode.ts) | Klassische Bearbeitung nur für einzeiligen Inhalt; vollständiger Editor bei vorhandenen oder eingefügten Umbrüchen; Sicherheitshinweis zählt Gedanken. |
| [src/storage/zoom-settings-change.ts](../src/storage/zoom-settings-change.ts) | Ausschließlich gespeicherten Zoom ohne Neuaufbau übernehmen; vollständige History-Snapshots und ihre Zeilenzuordnung erhalten, Inhalt/EOL/andere Eigenschaften unverändert. |
| [src/ui/menus/general-settings-menu.ts](../src/ui/menus/general-settings-menu.ts) | Moduswahl als letzte Option; sichtbarer gezählter Hinweis und dauerhafte Beschreibung; verzögerten Außenklick-Handler beim Schließen abmelden. |

## Tooling und Prüfnachweise

- `package.json` / `package-lock.json`: Markdown-Parser und Language-Paket als
  Entwicklungsabhängigkeiten für echte Parserprüfungen. Zur Laufzeit wird das
  von Obsidian bereitgestellte CodeMirror-Language-Modul verwendet; es bleibt extern.
- `scripts/verify-build.mjs`: diesen bekannten Obsidian-Laufzeitimport explizit
  erlauben und beim DOM-freien Starttest ebenfalls ersetzen. Andere unerwartete
  Laufzeitimporte bleiben Fehler.
- 307 automatisierte Tests in 29 Dateien, inklusive bisheriger Grundfunktionen.
  Zusätzliche Prüfungen verwenden tatsächliche Mutationen und eine unabhängige
  erwartete Baumstruktur; sie überprüfen nicht bloß nachgebaute Implementierungsdetails.
- `scripts/vault-regression-audit.mjs`: reale Obsidian-Editoren, Klicks,
  native Browsereingaben, DOM-Drag-and-drop und tatsächlich registrierte Befehle.
  Das native macOS-Kontextmenü wurde über seinen registrierten Edit-Callback
  geprüft; ein DOM-Menü wurde nicht fälschlich als vorhanden angenommen.
- `scripts/vault-scroll-tests.mjs`: auf volle Knotenhöhen umgestellt; prüft echte
  Mausradeingabe und unveränderten Dateitext statt der verworfenen internen Scrollleisten.
- Der Testtreiber musste Dateiwechsel explizit als Mindmap öffnen, auf den neuen
  Quell-/Renderstand warten und zwischen Knotenerstellung und anschließendem
  Editieren als zwei Undo-Schritten unterscheiden. Diese Testfehler sind von den
  oben genannten Produktfehlern getrennt.
- Die ursprüngliche offene Datei wurde vorher vollständig gesichert. Der
  Abschlussvergleich ist bytegleich; Modell, Graph, DOM und Zähler melden jeweils
  128 Knoten. Testansichten und Testglobals sind geschlossen bzw. entfernt.

Die bestätigten Bedienungsentscheidungen wurden beibehalten. Bis zum Abschluss dieser ursprünglichen lokalen Abnahme gab es kein
Veröffentlichen, keinen Versionssprung und keine Git-Commits; `main.js` ist ein
lokales, ignoriertes Buildartefakt für den angeforderten Vault-Test.


## Nachprüfung: Moduswahl und fortlaufende Gesten

[Editor- und Performance-Nachprüfung](editor-mode-and-viewport-performance.md)
dokumentiert die neue klassische Option, den Sicherheitshinweis und kontrollierte
Vorher-/Nachher-Messungen. Die CSS-Optimierung betrifft nur Vorschauen außerhalb
des Ausschnitts und ist beim Export deaktiviert. Der Zoom-Schnellpfad ist auf
Änderungen genau dieses einen gespeicherten Werts begrenzt. History und
Identitätszuordnungen werden für die eigene Zoompräferenz nachgeführt; externe
Inhaltsänderungen bleiben weiterhin geschützt. Menüs und anstehende Zoomtimer
werden beim Schließen der Ansicht aufgeräumt.


## Release-Gate 0.2.3 beta

Der eingeblendete Tastaturhinweis samt Tooltip ist entfernt; README enthält die
Bedienung. Die Editorhöhe richtet sich nach Inhalt und vorhandener Knotenhöhe.
Ein nachträglich ausgeführter Overlay-Paint und die Fokusnachführung einer
vorigen Bearbeitung dürfen einen bereits neu geöffneten Editor nicht ersetzen
oder schließen. 308 automatisierte Tests sowie der zusätzliche praktische
Größen-/Wechseltest sichern den Beta-Stand ab. Siehe
[Release-Gate](release-0.2.3-beta.md).
