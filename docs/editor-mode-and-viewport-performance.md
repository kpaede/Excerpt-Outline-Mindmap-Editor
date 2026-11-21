# Klassischer Editor und flüssigere große Mindmaps

Nachprüfung vom 21. November 2026; ergänzt den früheren Regressionsbericht.

## Moduswahl und Sicherheit

**General settings → Node editing** steht als letzte Option vor **Close**.
Die Wahl gilt für die jeweilige Mindmap. Ohne gespeicherte Wahl bleibt der
bisherige mehrzeilige Modus aktiv.

**Classic single line** öffnet einzeilige Gedanken kompakt. Enter schließt sie
wie bei der früheren Bedienung ab, auch bei listenähnlichem Inhalt. Der Wechsel
ändert ausschließlich die Einstellung; Inhalte und Speicherformat werden nicht
umgewandelt. Mehrzeilige Gedanken behalten ihren vollständigen Editor. Wird
mehrzeiliger Text eingefügt, erweitert sich der Editor und erhält alle Absätze,
Leerzeilen, Einrückungen und Untergedanken.

Beim Umschalten erscheint ein sieben Sekunden sichtbarer Hinweis mit der Zahl
mehrzeiliger Gedanken, die ihren vollständigen Editor behalten. Dieselbe
Information steht dauerhaft bei der Auswahl. Es wird die Zahl der Gedanken
gezählt, nicht die Zahl ihrer Absätze oder ihrer Kinder.

## Ursache und gezielte Änderungen

Die frühere Performance-Abnahme maß hauptsächlich Bearbeitungsaktionen, nicht
fortlaufende Gesten. Die Nachmessung zeigte merkliches Ruckeln beim Verschieben
und Zoomen einer Mindmap mit 130 Gedanken und 190.450 Zeichen.

Die Änderung verwendet `content-visibility: auto` ausschließlich auf den bereits
höhenbemessenen Markdown-Vorschauen. Alle Knoten, Texte, DOM-Elemente und
Graphpositionen bleiben vorhanden; der Browser spart Darstellungsarbeit außerhalb
des sichtbaren Ausschnitts. Steuerelemente, aktive Editoren und Messflächen sind
ausgenommen. Für SVG/PDF-Export wird die Optimierung ausdrücklich deaktiviert.
Eine probeweise Änderung der Positionierung über Transformationen wurde nicht
übernommen; die bisherige Geometrie bleibt erhalten.

Außerdem führte das verzögerte Speichern allein des Zoomwerts zuvor zu einem
unnötigen vollständigen Vorschauaufbau nach Ende der Geste. Ein enger Vergleich
lässt ausschließlich Änderungen dieses einen gespeicherten Werts ohne Neuaufbau
zu. Andere Einstellungen, Überschriften, Inhalte und Verschiebungen nehmen weiter
den regulären Aktualisierungspfad. Quellsnapshots der vorhandenen Callbackobjekte
werden aktualisiert. Undo-Zustände und ihre Identitätszuordnungen behalten den
aktuellen gespeicherten Zoom, damit Undo danach keinen falschen Versionskonflikt
meldet und identische leere Gedanken ihre Identität behalten.

## Messung und Prüfung

Die kontrollierte Gegenüberstellung verwendet dieselbe unveränderte Testkopie,
dieselben 100 Positions-/Zoomschritte und denselben CPU-Profiler. Ausgangsposition
und Zoom werden nach der Messung wiederhergestellt. Die Kontrollvariante schaltet
nur die neue Vorschauoptimierung vorübergehend aus.

| Messung | Vorher | Nachher |
| --- | ---: | ---: |
| Mittlerer Bildabstand | 32,17 ms | 17,88 ms |
| 95. Perzentil | 42,7 ms | 20,7 ms |
| Größter Bildabstand | 145,6 ms | 24,2 ms |
| Bilder über 33 ms, 98 gewertete Bilder | 25 | 0 |

Ein zusätzlicher Test löst den tatsächlichen Wheel-/Ctrl+Wheel-Handler aus,
wartet das Speichern ab und führt danach Undo/Redo aus. Gedankeninhalt und
Untergedanken bleiben erhalten. Die ursprüngliche Benutzernotiz wird dafür nicht
bearbeitet. Ergebnisse und Einzelläufe stehen in
[editor-mode-and-viewport-results.json](editor-mode-and-viewport-results.json).

307 automatisierte Tests bestanden, darunter unveränderte bisherige Tests,
gezielte Modus-/Pasteprüfungen, enger Zoomvergleich, vollständige History und
stabile Identitäten nach Zoomspeicherung. Build, TypeScript und ESLint werden
zusätzlich geprüft. Praktische Tests bedienen den echten Optionsschalter und
Editor, wechseln Dateien, speichern mehrzeiliges Paste und prüfen Hinweis,
Menüreihenfolge sowie SVG-/PDF-Export.

Die Messwerte gelten für die tatsächlich geprüfte Obsidian-Desktop-Umgebung.
Sie sind keine Garantie für jedes Gerät, beliebig viele Gedanken oder beliebige
Renderer anderer Plugins. Die zuvor dokumentierten Grenzen bei mobilen
Gerätetests und der unveränderten Lineage-Implementierung gelten weiterhin.
