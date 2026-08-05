import {
	App,
	MarkdownFileInfo,
	Scope,
	TFile,
} from "obsidian";

import { EditorSelection, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder, ViewUpdate } from "@codemirror/view";

import { around } from "monkey-around";

/*
 * Obsidian's embedded Markdown editor is not part of the public API. What
 * follows describes only the surface this wrapper touches, so the unchecked
 * access disappears without claiming to describe the rest. Every entry point
 * is still guarded at runtime, because a private API can change.
 */

/** The editor instance Obsidian's internal editor class produces. */
interface InternalMarkdownEditor {
	app: App;
	editorEl: HTMLElement;
	containerEl: HTMLElement;
	activeCM: EditorView;
	owner?: MarkdownFileInfo;
	_loaded: boolean;
	editor?: { cm?: EditorView };
	onUpdate(update: ViewUpdate, changed: boolean): void;
	set(content: string, focus?: boolean): void;
	register(callback: () => void): void;
	unload?: () => void;
	onunload?: () => void;
	destroy?: () => void;
}

type InternalMarkdownEditorClass = new (
	app: App,
	container: HTMLElement,
	owner: { app: App; onMarkdownScroll: () => void; getMode: () => string }
) => InternalMarkdownEditor;

/** The throwaway embed used once to reach the editor class behind it. */
interface WidgetEditorView {
	editable: boolean;
	showEditor(): void;
	editMode?: object;
	unload(): void;
}

interface AppWithEmbedRegistry {
	embedRegistry: {
		embedByExtension: {
			md(
				context: { app: App; containerEl: HTMLElement },
				file: TFile | null,
				subpath: string
			): WidgetEditorView;
		};
	};
}

type LocalExtensionBuilder = (this: InternalMarkdownEditor) => Extension[];

/**
 * Workspace.setActiveLeaf is overloaded, and a wrapper cannot satisfy both
 * signatures at once. The patch only decides whether to forward, so it is
 * typed as the pass-through it is.
 */
type SetActiveLeaf = (...args: never[]) => void;


// Obsidian keeps this editor implementation stable for the lifetime of an App
// instance. Resolving it creates a temporary embed, so do that at most once per
// app instead of during every double-tap.
const editorClassByApp = new WeakMap<App, InternalMarkdownEditorClass>();

/**
 * Creates an embeddable markdown editor
 * @param app The Obsidian app instance
 * @param container The container element
 * @param options Editor options
 * @returns A configured markdown editor
 */
export function createEmbeddableMarkdownEditor(
	app: App,
	container: HTMLElement,
	options: Partial<MarkdownEditorProps>
): EmbeddableMarkdownEditor {
	// Get the editor class
	const EditorClass = resolveEditorPrototype(app);

	// Create the editor instance
	return new EmbeddableMarkdownEditor(app, EditorClass, container, options);
}

/**
 * Resolves the markdown editor prototype from the app
 */
function resolveEditorPrototype(app: App): InternalMarkdownEditorClass {
	const cachedEditorClass = editorClassByApp.get(app);
	if (cachedEditorClass) return cachedEditorClass;

	// Create a temporary editor to resolve the prototype of ScrollableMarkdownEditor
	const widgetEditorView = (app as App & AppWithEmbedRegistry).embedRegistry.embedByExtension.md(
		{ app, containerEl: createDiv() },
		null,
		""
	);

	// Mark as editable to instantiate the editor
	widgetEditorView.editable = true;
	widgetEditorView.showEditor();
	const MarkdownEditor = Object.getPrototypeOf(
		Object.getPrototypeOf(widgetEditorView.editMode)
	) as object;

	// Unload to remove the temporary editor
	widgetEditorView.unload();

	// Return the constructor, using 'any' type to bypass the abstract class check
	const EditorClass = MarkdownEditor.constructor as InternalMarkdownEditorClass;
	editorClassByApp.set(app, EditorClass);
	return EditorClass;
}

export interface MarkdownEditorProps {
	cursorLocation?: { anchor: number; head: number };
	value?: string;
	cls?: string;
	placeholder?: string;
	singleLine?: boolean; // New option for single line mode
	file?: TFile | null;
	owner?: MarkdownFileInfo;

	onEnter: (
		editor: EmbeddableMarkdownEditor,
		mod: boolean,
		shift: boolean
	) => boolean;
	onEscape: (editor: EmbeddableMarkdownEditor) => void;
	onSubmit: (editor: EmbeddableMarkdownEditor) => void;
	onBlur: (editor: EmbeddableMarkdownEditor) => void;
	onPaste: (e: ClipboardEvent, editor: EmbeddableMarkdownEditor) => void;
	onChange: (update: ViewUpdate) => void;
}

const defaultProperties: MarkdownEditorProps = {
	cursorLocation: { anchor: 0, head: 0 },
	value: "",
	singleLine: false,
	cls: "",
	placeholder: "",

	onEnter: () => false,
	onEscape: () => {},
	onSubmit: () => {},
	// NOTE: Blur takes precedence over Escape (this can be changed)
	onBlur: () => {},
	onPaste: () => {},
	onChange: () => {},
};

/**
 * Adds this plugin's CodeMirror extensions to Obsidian's editor.
 *
 * The wrapper arrives as a parameter rather than being aliased off `this`:
 * the patched method needs its own `this` (the editor instance Obsidian is
 * building extensions for) to tell our editor from any other.
 */
function patchLocalExtensions(
	EditorClass: InternalMarkdownEditorClass,
	self: EmbeddableMarkdownEditor
): () => void {
	return around(EditorClass.prototype as { buildLocalExtensions: LocalExtensionBuilder }, {
		buildLocalExtensions:
			(originalMethod: LocalExtensionBuilder): LocalExtensionBuilder =>
				function (this: InternalMarkdownEditor) {
					const extensions = originalMethod.call(this);

					// Only add our extensions to our own editor instance
					if (this === self.editor) {
					// Add placeholder if configured
					if (self.options.placeholder) {
						extensions.push(
							placeholder(self.options.placeholder)
						);
					}

					// Add paste, blur, and focus event handlers
					extensions.push(
						EditorView.domEventHandlers({
							paste: (event) => {
								self.options.onPaste(event, self);
							},
							blur: () => {
								self.deactivate();
								if (self.options.onBlur) {
									self.options.onBlur(self);
								}
							},
							focusin: () => {
								self.activate();
							},
						})
					);

					// Add keyboard handlers
					const keyBindings = [
						{
							key: "Enter",
							run: () => {
								return self.options.onEnter(
									self,
									false,
									false
								);
							},
							shift: () =>
								self.options.onEnter(
									self,
									false,
									true
								),
						},
						{
							key: "Mod-Enter",
							run: () =>
								self.options.onEnter(
									self,
									true,
									false
								),
							shift: () =>
								self.options.onEnter(
									self,
									true,
									true
								),
						},
						{
							key: "Escape",
							run: () => {
								self.options.onEscape(self);
								return true;
							},
							preventDefault: true,
						},
					];

					// For single line mode, prevent Enter key from creating new lines
					if (self.options.singleLine) {
						keyBindings[0] = {
							key: "Enter",
							run: () => {
								// In single line mode, Enter should trigger onEnter
								return self.options.onEnter(
									self,
									false,
									false
								);
							},
							shift: () => {
								// Even with shift, still call onEnter in single line mode
								return self.options.onEnter(
									self,
									false,
									true
								);
							},
						};
					}

					extensions.push(
						Prec.highest(keymap.of(keyBindings))
					);
					}

					return extensions;
				},
	});
}

/**
 * A markdown editor that can be embedded in any container
 */
export class EmbeddableMarkdownEditor {
	options: MarkdownEditorProps;
	initial_value: string;
	scope: Scope;
	editor!: InternalMarkdownEditor;
	private activeEditorInfo: MarkdownFileInfo | null = null;
	private isActivated = false;

	// Expose commonly accessed properties
	get editorEl(): HTMLElement {
		return this.editor.editorEl;
	}
	get containerEl(): HTMLElement {
		return this.editor.containerEl;
	}
	get activeCM(): EditorView {
		return this.editor.activeCM;
	}
	get app(): App {
		return this.editor.app;
	}
	get owner(): MarkdownFileInfo | undefined {
		return this.editor.owner;
	}
	get _loaded(): boolean {
		return this.editor._loaded;
	}

	activate(): void {
		if (this.isActivated) return;
		this.isActivated = true;
		this.app.keymap.pushScope(this.scope);
		this.app.workspace.activeEditor = this.activeEditorInfo;
	}

	deactivate(): void {
		if (!this.isActivated) return;
		this.isActivated = false;
		this.app.keymap.popScope(this.scope);
		if (this.app.workspace.activeEditor === this.activeEditorInfo) {
			this.app.workspace.activeEditor = null;
		}
	}

	/**
	 * Construct the editor
	 * @param app - Reference to App instance
	 * @param EditorClass - The editor class constructor
	 * @param container - Container element to add the editor to
	 * @param options - Options for controlling the initial state of the editor
	 */
	constructor(
		app: App,
		EditorClass: InternalMarkdownEditorClass,
		container: HTMLElement,
		options: Partial<MarkdownEditorProps>
	) {
		// Store user options first
		this.options = { ...defaultProperties, ...options };
		this.initial_value = this.options.value!;
		this.scope = new Scope(app.scope);

		// Prevent Mod+Enter default behavior
		this.scope.register(["Mod"], "Enter", () => true);

		const uninstaller = patchLocalExtensions(EditorClass, this);

		// Create the editor with the app instance
		this.editor = new EditorClass(app, container, {
			app,
			// This mocks the MarkdownView functions, required for proper scrolling
			onMarkdownScroll: () => {},
			getMode: () => "source",
		});

		// Register the uninstaller for cleanup
		this.register(uninstaller);

		const fallbackEditorInfo = {
			app,
			file: options.file ?? null,
			editor: this.editor.editor,
		} as unknown as MarkdownFileInfo;
		this.activeEditorInfo = options.owner ?? this.owner ?? fallbackEditorInfo;

		// Set up the editor relationship for commands to work
		if (this.activeEditorInfo) {
			const editorInfo = this.activeEditorInfo as unknown as {
				editMode?: unknown;
				editor?: unknown;
			};
			editorInfo.editMode = this;
			editorInfo.editor = this.editor.editor;
		}

		// Set initial content
		this.set(options.value || "", false);

		// Prevent active leaf changes while focused
		this.register(
			around(app.workspace, {
				// Keeps focus in this editor: while it has the caret, Obsidian
				// must not move the active leaf out from under it.
				setActiveLeaf:
					(oldMethod: SetActiveLeaf): SetActiveLeaf =>
					(...args: never[]) => {
						if (!this.activeCM?.hasFocus) {
							oldMethod.apply(app.workspace, args);
						}
					},
			})
		);

		// Blur and focus event handlers are now handled via EditorView.domEventHandlers in buildLocalExtensions

		// Apply custom class if provided
		if (options.cls && this.editorEl) {
			this.editorEl.classList.add(options.cls);
		}

		// Set cursor position if specified
		if (options.cursorLocation && this.editor.editor?.cm) {
			this.editor.editor.cm.dispatch({
				selection: EditorSelection.range(
					options.cursorLocation.anchor,
					options.cursorLocation.head
				),
			});
		}

		// Override onUpdate to call our onChange handler
		const originalOnUpdate = this.editor.onUpdate.bind(this.editor);
		this.editor.onUpdate = (update: ViewUpdate, changed: boolean) => {
			originalOnUpdate(update, changed);
			if (changed) this.options.onChange(update);
		};
	}

	// Get the current editor value
	get value(): string {
		return this.editor.editor?.cm?.state.doc.toString() || "";
	}

	// Set content in the editor
	set(content: string, focus: boolean = false): void {
		this.editor.set(content, focus);
	}

	// Register cleanup callback
	register(cb: () => void): void {
		this.editor.register(cb);
	}

	// Clean up method that ensures proper destruction
	destroy(): void {
		if (this._loaded && typeof this.editor.unload === "function") {
			this.editor.unload();
		}

		this.deactivate();
		this.containerEl.empty();

		if (this.editor.destroy) {
			this.editor.destroy();
		}
	}

	// Unload handler
	onunload(): void {
		if (typeof this.editor.onunload === "function") {
			this.editor.onunload();
		}
		this.destroy();
	}

	// Required method for MarkdownScrollableEditView compatibility
	unload(): void {
		if (typeof this.editor.unload === "function") {
			this.editor.unload();
		}
	}
}
