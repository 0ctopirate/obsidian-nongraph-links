import { Plugin } from "obsidian";
import { RangeSetBuilder } from "@codemirror/rangeset";
import { EditorView, Decoration, DecorationSet, ViewUpdate, WidgetType, ViewPlugin } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

const linkRegexp = /{{(.*?)}}/g;

class NodeGraphWidget extends WidgetType {
	node: HTMLAnchorElement;

	constructor(location: string, text: string){
		super();

		this.node = document.createElement('a');
		this.node.href = location;
		this.node.innerText = text;
		this.node.classList.add('internal-link');
	}

	toDOM() {
		return this.node;
	}
}

class NonGraphLink {
	location: string;
	text: string;
	link: string;

	from: number | undefined;
	to: number | undefined;

	widget: NodeGraphWidget;
	marks: {
		startBracketMark: Decoration,
		linkMark: Decoration,
		endBracketMark: Decoration,
	};

    constructor(link: string, from?: number, to?: number) {
		this.link = link;
        // if | is present, use the text before it as the link and the text after it as the text
        if (link.includes('|')) {
            [this.location, this.text] = link.split('|');
        } else {
            this.location = link;
            // get base name of file path
            this.text = link.split('/').slice(-1)[0].split('.')[0];
        }

		this.widget = new NodeGraphWidget(this.location, this.text);
		this.marks = {
			startBracketMark: Decoration.mark({ class: "cm-formatting-link cm-formatting-link-start" }),
			linkMark: Decoration.mark({ tagName: "a", attributes: { href: this.location } }),
			endBracketMark: Decoration.mark({ class: "cm-formatting-link cm-formatting-link-end" })
		}

		this.from = from;
		this.to = to;

		// this.sourceNode = document.createElement('span');
		// this.sourceNode.innerHTML = `<span class="cm-formatting-link cm-formatting-link-start">{{</span><a href="${this.location}">${this.link}</a><span class="cm-formatting-link cm-formatting-link-end">}}</span>`;
		// make the inside the same color as a link
		// this.sourceNode.classList.add('cm-link');
    }

	buildDecoration(builder: RangeSetBuilder<Decoration>, view: EditorView, start: number, end: number) {
		if (this.caretIsInsideLink(view)) {
			builder.add(start, start + 2, this.marks.startBracketMark);
			builder.add(start + 2, end - 2, this.marks.linkMark);
			builder.add(end - 2, end, this.marks.endBracketMark);
		} else {
			builder.add(start, end, Decoration.replace({ widget: this.widget }));
		}
	}

	// ignoreEvent(event: Event): boolean {
	// 	return false;
	// }	

	caretIsInsideLink(view: EditorView): boolean {
		const selection = view.state.selection;
		return selection.main.from >= this.from! && selection.main.to <= this.to!;
	}
}


export default class NonGraphLinkPlugin extends Plugin {
	async onload() {
		const ext = this.buildAttributesViewPlugin();
    	this.registerEditorExtension(ext);

		this.registerMarkdownPostProcessor((el, ctx) => {
			// Get all text nodes in el.
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            let node: Node = walker.nextNode()!;

            while (node) {
                // Check if the text content of a node matches the pattern.
                let match;
                
                while ((match = linkRegexp.exec(node.nodeValue ?? "")) !== null) {
                    // Replace each instance of the pattern with a link.
                    const [fullMatch, link] = match;
					
                    const startOffset = match.index;
                    const endOffset = startOffset + fullMatch.length;
                    
                    const range = document.createRange();
                    range.setStart(node, startOffset);
                    range.setEnd(node, endOffset);

					const nglNode = new NonGraphLink(link).widget.node;
                    
                    range.deleteContents();
                    range.insertNode(nglNode);
                    
                    // Update node reference to avoid messing up offsets.
                    node = nglNode.nextSibling!;
                    walker.currentNode = node;
                    linkRegexp.lastIndex = 0;
                }

                node = walker.nextNode()!;
            }
		});
	}

	buildAttributesViewPlugin() {
		const viewPlugin = ViewPlugin.fromClass(
		  class {
			decorations: DecorationSet;
	  
			constructor(view: EditorView) {
			  this.decorations = this.buildDecorations(view);
			}
	  
			update(update: ViewUpdate) {
			  if (update.docChanged || update.viewportChanged || update.selectionSet) {
				this.decorations = this.buildDecorations(update.view);
			  }

			//   Check if the selection has changed
			  if (update.selectionSet) {
				let selection = update.view.state.selection;

				// Iterate over the decorations in the selection range
				this.decorations.between(selection.main.from, selection.main.to, (from, to, deco) => {
					// If the decoration is a NonGraphLink and the selection is inside it
					if (deco.spec.widget instanceof NonGraphLink && selection.main.from >= from && selection.main.to <= to) {
						// Replace the link with the actual link text
						// let tr = update.view.state.update({
						// 	changes: {from, to, insert: deco.spec.widget.link},
						// 	selection: EditorSelection.cursor(to)
						// });
						// update.view.dispatch(tr);
					}
				});
			  }
			}
	  
			destroy() {}
	  
			buildDecorations(view: EditorView) {
				const linkRegexp = /{{(.*?)}}/g;
				let builder = new RangeSetBuilder<Decoration>();
				let links: {start: number, end: number, text: string}[] = [];
			  
				for (let { from, to } of view.visibleRanges) {
				  try {
					const tree = syntaxTree(view.state);
					tree.iterate({
					  from,
					  to,
					  enter: (node) => {
						const text = view.state.doc.sliceString(node.from, node.to);
						let match;
			  
						while ((match = linkRegexp.exec(text)) !== null) {
						  const start = node.from + match.index;
						  const end = start + match[0].length;
						  const linkText = match[1];
			  
						  links.push({start, end, text: linkText});
						}
					  },
					});
				  } catch (err) {
					console.error("Custom CM6 view plugin failure", err);
					throw err;
				  }
				}
			  
				// Sort links and filter duplicates
				links.sort((a, b) => a.start - b.start || a.end - b.end);
			  
				// filter duplicates and create decorations
				links.filter((value, index, self) =>
					index === self.findIndex((t) => (
						t.start === value.start && t.end === value.end && t.text === value.text
					))
				).forEach(link => {
				  let ngl = new NonGraphLink(link.text, link.start, link.end);
				  ngl.buildDecoration(builder, view, link.start, link.end);
				});
			  
				return builder.finish();
			  }
		  },
		  {
			decorations: v => v.decorations,
			// ... existing code
		  }
		);
	  
		return viewPlugin;
	  }

	onunload() {

	}
}