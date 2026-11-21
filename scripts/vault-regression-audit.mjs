// Explicit, isolated live-vault checks. Each stage only changes its own fixtures.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const cli=process.env.OBSIDIAN_CLI||'/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const vault=process.env.EOME_TEST_VAULT||'Testprogramm 2';
const stage=process.argv[2];
function run(command,args=[]){const out=execFileSync(cli,[`vault=${vault}`,command,...args],{encoding:'utf8',timeout:60000,maxBuffer:2_000_000});if(/^Error:/m.test(out))throw Error(out);return out;}
const cdp=(method,params)=>run('dev:cdp',[`method=${method}`,'params='+JSON.stringify(params)]);
const evaluate=code=>{const out=run('eval',['code=(async()=>{'+code+'})()']);const json=out.slice(out.indexOf('=> ')+3).trim();try{return JSON.parse(json);}catch{return json;}};
const common=String.raw`
const s=window.__eomeAudit;
if(!s)throw Error('Run protect first');
const resultStart=s.results.length;
const plugin=app.plugins.plugins['excerpt-outline-mindmap-editor'];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async fn=>{for(let i=0;i<300;i++){if(await fn())return;await wait(20);}throw Error('Timed out');};
const view=()=>app.workspace.getLeavesOfType('mindmap-view').find(l=>l.view.file?.path===s.current&&typeof l.view.getFlatNodes==='function')?.view;
const ready=async(expected)=>{await until(()=>{const v=view();if(!v?.cy||expected&&v.data!==expected)return false;const nodes=v.getFlatNodes();const boxes=new Map([...v.wrapper.querySelectorAll('[data-overlay][data-node-line]')].map(b=>[Number(b.dataset.nodeLine),b]));return nodes.length===v.cy.nodes().length&&boxes.size===nodes.length&&nodes.every(n=>v.cy.getElementById('n'+n.line).data('node')?.sourceDoc===v.data&&boxes.get(n.line)?.querySelector('[data-text]')?.dataset.text===n.text)&&!v.wrapper.querySelector('.editing');});return view();};
const open=async path=>{s.current=path;const expected=await app.vault.read(app.vault.getAbstractFileByPath(path));let leaf=app.workspace.getLeavesOfType('mindmap-view').find(l=>l.view.file?.path?.startsWith(s.folder+'/'));if(leaf&&leaf.view.file?.path!==path)await leaf.setViewState({type:'mindmap-view',state:{file:path},active:true});else if(!leaf) await plugin.openMindmapReplacingLeaf(app.vault.getAbstractFileByPath(path));const v=await ready(expected);app.workspace.setActiveLeaf(v.leaf,{focus:true});await app.workspace.revealLeaf(v.leaf);return v;};
const check=(name,ok,details)=>{if(!ok)throw Error(name+' '+JSON.stringify(details??''));s.results.push({name,passed:true,...(details===undefined?{}:{details})});};
const tree=nodes=>nodes.map(n=>({text:n.text,checkbox:n.checkbox,children:tree(n.children)}));
const box=(v,n)=>v.wrapper.querySelector('[data-node-line="'+n.line+'"]');
const el=()=>view().wrapper.querySelector('.editing .cm-content');
const editor=()=>el()?.cmTile?.view;
const set=async text=>{const cm=editor();cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:text},selection:{anchor:text.length}});cm.focus();await wait(25);};
const key=(name,options={})=>el().dispatchEvent(new KeyboardEvent('keydown',{key:name,code:name,keyCode:name==='Enter'?13:27,bubbles:true,cancelable:true,...options}));
const edit=async n=>{await view().enterEditModeForNodeByLine(n.line);await until(()=>!!editor());};
const encode=(text,indent='')=>text.split('\n').map((line,i)=>indent+(i?'  ':'- ')+line).join('\n');
`;
const stages={
protect:String.raw`
const active=app.workspace.getActiveFile();const leaves=app.workspace.getLeavesOfType('mindmap-view').filter(l=>typeof l.view.getFlatNodes==='function');
if(leaves.some(l=>l.view.wrapper?.querySelector('.editing')))throw Error('An active user draft must be preserved before reload');
const original=active?await app.vault.read(active):null;
const backup=active?active.path+'.before-regression-audit-'+Date.now()+'.eome-backup':null;
if(active)await app.vault.create(backup,original);
window.__eomeAudit={originalPath:active?.path,original,backup,results:[],originalLeafIds:app.workspace.getLeavesOfType('mindmap-view').map(l=>l.id)};
return JSON.stringify({originalPath:active?.path,backup,nodes:leaves.map(l=>({path:l.view.file?.path,nodes:l.view.getFlatNodes().length,overlays:l.view.wrapper?.querySelectorAll('[data-overlay][data-node-line]').length}))});
`,
setup:String.raw`
s.folder='EOME regression audit '+new Date().toISOString().replace(/[:.]/g,'-');await app.vault.createFolder(s.folder);
s.small=s.folder+'/01-behavior.md';s.legacy=s.folder+'/02-legacy.md';s.deep=s.folder+'/03-sixty-levels.md';s.long=s.folder+'/04-long-excerpt.md';
const header='---\neome-outline-format: 2\ncustom: untouched\n---\n';
s.smallText=header+'# Ideas\n'+encode('Parent\n\nParagraph with **bold**, [[Missing|alias]], inline code and 日本語.\n\n- internal\n  - nested\n- [ ] internal task\n\n~~~md\n<!--section: 1-->\n~~~')+'\n\t- Child\n\t\t- Grandchild\n- [ ] Task\n- Plain\n# Empty';
s.legacyText='---\ncustom: untouched\n---\n# Legacy\n- Parent\n\t- Child\n- [ ] Task\n- Plain';
let deep=header;for(let i=0;i<=60;i++){deep+=encode('Depth '+i+'\n\n'+('Paragraph with Unicode ä 日本語.  \n\n- internal\n  * nested\n1. numbered\n> quote\n').repeat(7),'\t'.repeat(i))+'\n';}deep+='- Independent target';
const longContent='Long excerpt\n\n'+('A longer paragraph with trailing spaces and Unicode ä 日本語 🧠.  \n\n- internal list\n  - nested\n> quote\n\n').repeat(900)+'TAIL SENTINEL';
s.longContent=longContent;const long=header+encode(longContent)+'\n\t- Real child\n- Target';
for(const [path,text] of [[s.small,s.smallText],[s.legacy,s.legacyText],[s.deep,deep],[s.long,long]])await app.vault.create(path,text);
const v=await open(s.small);check('Small fixture renders every structural node',v.getFlatNodes().length===5&&v.cy.edges().length===2);
return JSON.stringify({folder:s.folder,deepCharacters:deep.length,longCharacters:long.length,results:s.results});
`,
reset:String.raw`
const v=await open(s.small);if(editor())key('Escape');v.toolbar.closeMenus();await app.vault.modify(app.vault.getAbstractFileByPath(s.long),'---\neome-outline-format: 2\ncustom: untouched\n---\n'+encode(s.longContent)+'\n\t- Real child\n- Target');await app.vault.modify(v.file,s.smallText);await open(s.legacy);await open(s.small);v.commandHistory.clear();return JSON.stringify({resetOwnFixture:true});
`,
drawing:String.raw`
const drawing=s.folder+'/drawing.svg';if(!app.vault.getAbstractFileByPath(drawing))await app.vault.create(drawing,require('fs').readFileSync('/tmp/eome-audit-drawing.svg','utf8'));const path=s.folder+'/08-drawing-routing.md';const text='---\neome-outline-format: 2\n---\n'+encode('Text and drawing\n\n![['+drawing+']]')+'\n'+encode('![['+drawing+']]');if(!app.vault.getAbstractFileByPath(path))await app.vault.create(path,text);const v=await open(path);await wait(40);v.showNodeContextMenu(new MouseEvent('contextmenu',{clientX:300,clientY:200}),v.getOutlineNodes()[0].line);{const menu=v.activeNodeContextMenu;const editItem=menu?.items.find(i=>i.titleEl?.textContent==='Edit');if(!editItem)throw Error('Missing native Edit menu action');menu.hide();editItem.callback();}await until(()=>!!editor());check('Mixed drawing context Edit opens full Markdown',editor().state.doc.toString()===v.getOutlineNodes()[0].text);key('Escape');await until(()=>!editor());v.showNodeContextMenu(new MouseEvent('contextmenu',{clientX:300,clientY:200}),v.getOutlineNodes()[1].line);{const menu=v.activeNodeContextMenu;const editItem=menu?.items.find(i=>i.titleEl?.textContent==='Edit');if(!editItem)throw Error('Missing native Edit menu action');menu.hide();editItem.callback();}await until(()=>document.querySelector('.eome-drawing-stage'));check('Pure drawing context Edit keeps drawing editor',!!document.querySelector('.eome-drawing-stage')&&!editor());[...document.querySelectorAll('.eome-drawing-footer button')].find(b=>b.textContent==='Cancel').click();await until(()=>!document.querySelector('.eome-drawing-stage'));check('Cancelling both edit routes leaves source intact',await app.vault.read(v.file)===text);return JSON.stringify(s.results.slice(resultStart));
`,
embed:String.raw`
const path=s.folder+'/09-embed.md';const ticks=String.fromCharCode(96).repeat(3);if(!app.vault.getAbstractFileByPath(path))await app.vault.create(path,ticks+'mindmap-eome\n'+s.small+'\n'+ticks);const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'markdown',state:{file:path,mode:'preview'},active:true});await until(()=>[...leaf.view.containerEl.querySelectorAll('.mindmap-eome-host')].some(e=>e.querySelectorAll('[data-mindmap-eome-overlay].mindmap-overlay').length===5));await until(()=>document.querySelectorAll('.mindmap-eome-measurement-container').length===0);const container=leaf.view.containerEl;check('Read-only mindmap embed renders all multiline nodes',container.textContent.includes('Grandchild')&&container.textContent.includes('Paragraph with'));check('Embed measurement container is cleaned up',document.querySelectorAll('.mindmap-eome-measurement-container').length===0);leaf.detach();return JSON.stringify(s.results.slice(resultStart));
`,
migration:String.raw`
const path=s.folder+'/07-migration.md';if(!app.vault.getAbstractFileByPath(path))await app.vault.create(path,s.legacyText);const v=await open(path);const before=await app.vault.read(v.file);const semantic=JSON.stringify(tree(v.getOutlineNodes()));
app.commands.executeCommandById('excerpt-outline-mindmap-editor:preview-multiline-outline-migration');await until(()=>document.querySelector('.eome-migration-preview'));const preview=document.querySelector('.eome-migration-preview');const expected=preview.value;check('Migration preview leaves original untouched',await app.vault.read(v.file)===before);[...preview.closest('.modal-content').querySelectorAll('button')].find(b=>b.textContent==='Back up and migrate').click();await until(async()=>await app.vault.read(v.file)===expected);await v.reloadData();check('Confirmed migration preserves full tree and tasks',JSON.stringify(tree(v.getOutlineNodes()))===semantic);let backups=app.vault.getFiles().filter(f=>f.path.startsWith(path+'.')&&f.path.endsWith('.eome-backup'));check('Migration creates a complete backup first',backups.length===1&&await app.vault.read(backups[0])===before);
app.commands.executeCommandById('excerpt-outline-mindmap-editor:restore-multiline-outline-backup');await until(()=>[...document.querySelectorAll('.modal-content button')].some(b=>b.textContent===backups[0].name));[...document.querySelectorAll('.modal-content button')].find(b=>b.textContent===backups[0].name).click();await until(()=>document.querySelector('.eome-migration-preview'));const restore=document.querySelector('.eome-migration-preview');[...restore.closest('.modal-content').querySelectorAll('button')].find(b=>b.textContent==='Back up and restore').click();await until(async()=>await app.vault.read(v.file)===before);backups=app.vault.getFiles().filter(f=>f.path.startsWith(path+'.')&&f.path.endsWith('.eome-backup'));check('Backup restoration preserves exact legacy bytes and backs up migrated state',backups.length===2&&await app.vault.read(v.file)===before);return JSON.stringify(s.results.slice(resultStart));
`,
'long-editor':String.raw`
const v=await open(s.long);const before=await app.vault.read(v.file);const count=v.getFlatNodes().length;await edit(v.getOutlineNodes()[0]);await set(s.longContent+'\n\n- tail list');key('Enter');check('Enter at end of a 100k editor continues list',!!editor()&&editor().state.doc.toString().endsWith('- tail list\n- '),{draft:editor()?.state.doc.toString().slice(-80),saved:v.getOutlineNodes()[0].text.slice(-80)});key('Enter',{metaKey:true});await until(()=>!editor());check('Long editor save retains full content and real child',v.getOutlineNodes()[0].text===s.longContent+'\n\n- tail list\n- '&&v.getFlatNodes().length===count&&v.getOutlineNodes()[0].children[0].text==='Real child');await v.executeUndo();check('Undo long editor save restores exact complete document',await app.vault.read(v.file)===before);return JSON.stringify(s.results.slice(resultStart));
`,
extras:String.raw`
const v=await open(s.small);const before=await app.vault.read(v.file);
const task=v.getFlatNodes().find(n=>n.text==='Task');if(task.checkbox!=='checked')await v.toggleNodeCheckbox(task);await until(()=>box(v,v.getFlatNodes().find(n=>n.text==='Task')).classList.contains('checkbox-checked'));const checked=box(v,v.getFlatNodes().find(n=>n.text==='Task'));const wasDark=document.body.classList.contains('theme-dark'),wasLight=document.body.classList.contains('theme-light');
try{for(const dark of [false,true]){document.body.classList.toggle('theme-dark',dark);document.body.classList.toggle('theme-light',!dark);const a=getComputedStyle(checked),b=getComputedStyle(checked.querySelector('[data-text]'));check('Checked task muted in '+(dark?'dark':'light')+' theme',a.borderTopColor===b.color&&a.backgroundColor==='rgba(128, 128, 128, 0.12)');}}finally{document.body.classList.toggle('theme-dark',wasDark);document.body.classList.toggle('theme-light',wasLight);}await v.executeUndo();
const internal=box(v,v.getOutlineNodes()[0]).querySelector('input[type=checkbox]');if(internal){internal.click();await wait(80);check('Internal task click cannot alter structural tasks or file',await app.vault.read(v.file)===before);v.updateOverlays();await wait(40);}
app.workspace.setActiveLeaf(v.leaf,{focus:true});await app.workspace.revealLeaf(v.leaf);await until(()=>app.workspace.activeLeaf===v.leaf);const oldCanvas=app.vault.getAbstractFileByPath(s.small.replace(/\.md$/,'.canvas'));if(oldCanvas)await app.fileManager.trashFile(oldCanvas);const canvasPath=s.small.replace(/\.md$/,'.canvas');app.commands.executeCommandById('excerpt-outline-mindmap-editor:export-current-mindmap-to-canvas');await until(()=>app.vault.getAbstractFileByPath(canvasPath));const canvas=JSON.parse(await app.vault.read(app.vault.getAbstractFileByPath(canvasPath)));check('Actual Canvas export retains all multiline text',canvas.nodes.length===v.getFlatNodes().length&&canvas.nodes[0].text===v.getFlatNodes()[0].text&&canvas.edges.length===2);
app.workspace.setActiveLeaf(v.leaf,{focus:true});await app.workspace.revealLeaf(v.leaf);await until(()=>app.workspace.activeLeaf===v.leaf);const svgPath=s.small.replace(/\.md$/,'.svg');app.commands.executeCommandById('excerpt-outline-mindmap-editor:export-current-mindmap-to-svg');await until(()=>app.vault.getAbstractFileByPath(svgPath));const svg=await app.vault.read(app.vault.getAbstractFileByPath(svgPath));check('Actual SVG export contains all node previews',svg.includes('<svg')&&svg.includes('Grandchild')&&svg.includes('Paragraph with'));
app.workspace.setActiveLeaf(v.leaf,{focus:true});await app.workspace.revealLeaf(v.leaf);await until(()=>app.workspace.activeLeaf===v.leaf);const pdfPath=s.small.replace(/\.md$/,'.pdf');app.commands.executeCommandById('excerpt-outline-mindmap-editor:export-current-mindmap-to-pdf');await until(()=>app.vault.adapter.exists(pdfPath));const bytes=await app.vault.adapter.readBinary(pdfPath);check('Actual PDF export writes a valid PDF',new TextDecoder().decode(bytes.slice(0,5))==='%PDF-');
check('Exports preserve source document',await app.vault.read(v.file)===before);return JSON.stringify(s.results.slice(resultStart));
`,
presentation:String.raw`
const v=await open(s.small);const plain=v.getOutlineNodes().at(-1);
v.toolbar.openGeneralSettings(v.wrapper.querySelector('.mindmap-toolbar-toggle'));
let menu=document.querySelector('.general-settings-menu');const row=[...menu.querySelectorAll('.setting-item')].find(e=>e.textContent.includes('Show checkbox toggle'));const toggle=row.querySelector('.checkbox-container');
check('Checkbox option initially off',!box(v,plain).classList.contains('checkbox-hoverable'));toggle.click();
check('Actual setting toggle updates existing node immediately',box(v,plain).classList.contains('checkbox-hoverable'));
await until(async()=> (await app.vault.read(v.file)).includes('showCheckboxesOnHover:true'));
check('Hover checkbox can be shown',(()=>{const b=box(v,plain);b.classList.add('hovering');const display=getComputedStyle(b.querySelector('.checkbox-toggle')).display;b.classList.remove('hovering');return display!=='none';})());
v.toolbar.closeMenus();
const task=v.getFlatNodes().find(n=>n.text==='Task');box(v,task).querySelector('.checkbox-toggle').click();
await until(()=>v.getFlatNodes().find(n=>n.text==='Task').checkbox==='checked');
const checked=box(v,v.getFlatNodes().find(n=>n.text==='Task'));const css=getComputedStyle(checked),content=getComputedStyle(checked.querySelector('[data-text]'));
check('Checked task has muted text, border and background',checked.classList.contains('checkbox-checked')&&content.color===css.borderTopColor&&css.backgroundColor!=='rgba(0, 0, 0, 0)',{text:content.color,border:css.borderTopColor,background:css.backgroundColor});
await v.executeUndo();check('Undo task restores complete content',v.getFlatNodes().find(n=>n.text==='Task').checkbox==='unchecked');
await v.frontmatterStorage.updateNodeOptions(v.file,{nodeWidth:340});await v.frontmatterStorage.updateGeneralSettings(v.file,{...v.generalSettings,inheritParentListTypeForChildren:true});
const stored=await v.frontmatterStorage.loadMindmapData(v.file);check('Immediate consecutive settings saves preserve both values',stored.nodeWidth===340&&stored.showCheckboxesOnHover===true&&stored.inheritParentListTypeForChildren===true);
check('Unrelated frontmatter and content retained', (await app.vault.read(v.file)).includes('custom: untouched')&&v.getFlatNodes()[0].text.includes('<!--section: 1-->'));
await open(s.legacy);const back=await open(s.small);check('Settings survive switching away and back',back.generalSettings.showCheckboxesOnHover===true&&back.getNodeOptions().nodeWidth===340);
return JSON.stringify(s.results.slice(resultStart));
`,
'keyboard-open':String.raw`
const v=await open(s.small);const node=v.getOutlineNodes().at(-1);s.keyboardNode=node.id;await edit(node);return JSON.stringify({editing:!!editor()});
`,
'keyboard-inspect':String.raw`return JSON.stringify({editing:!!editor(),text:editor()?.state.doc.toString(),saved:view().getFlatNodes().find(n=>n.id===s.keyboardNode)?.text});`,
'keyboard-set':`await set(${JSON.stringify(process.argv[3]||'')});return JSON.stringify({text:editor().state.doc.toString()});`,
'keyboard-check':String.raw`
const expected=JSON.parse(require('fs').readFileSync('/tmp/eome-audit-key-expect.json','utf8'));
if(expected.editing)check(expected.name,!!editor()&&editor().state.doc.toString()===expected.text,{actual:editor()?.state.doc.toString()});else{await until(()=>!editor());check(expected.name,view().getFlatNodes().find(n=>n.id===s.keyboardNode)?.text===expected.text);}
return JSON.stringify(s.results.at(-1));
`,
structure:String.raw`
let v=await open(s.small);let before=await app.vault.read(v.file);let semantic=JSON.stringify(tree(v.getOutlineNodes()));
const parent=v.getOutlineNodes()[0],target=v.getOutlineNodes()[1];const fragment=JSON.stringify(tree([parent]));
const sourceBox=box(v,parent),targetBox=box(v,target);const transfer=new DataTransfer();sourceBox.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));const rect=targetBox.getBoundingClientRect();const event={bubbles:true,cancelable:true,dataTransfer:transfer,clientX:rect.left+rect.width*.25,clientY:rect.top+rect.height*.75};targetBox.dispatchEvent(new DragEvent('dragenter',event));targetBox.dispatchEvent(new DragEvent('dragover',event));targetBox.dispatchEvent(new DragEvent('drop',event));
await until(()=>view().data!==before);v=view();check('DOM drag/drop retains complete subtree',JSON.stringify(tree([v.getOutlineNodes()[0].children[0]]))===fragment);
await v.executeUndo();check('Undo drag/drop restores exact bytes',await app.vault.read(v.file)===before);
await v.copyNodesToClipboard([v.getOutlineNodes()[0]]);await v.pasteClipboardAsChildren(v.getOutlineNodes()[1]);check('Copy/paste retains complete subtree',JSON.stringify(tree([v.getOutlineNodes()[1].children[0]]))===fragment);await v.executeUndo();
await v.cutNodesToClipboard([v.getOutlineNodes()[0]]);await v.executeEditNodeCommand(v.getOutlineNodes()[0],v.getOutlineNodes()[0].text+'\nNewer after Cut');await v.pasteClipboardAsChildren(v.getOutlineNodes()[1]);check('Cut/paste uses newer source content',v.getOutlineNodes()[0].children[0].text.endsWith('Newer after Cut'));await v.executeUndo();await v.executeUndo();
await v.executeDuplicateNodeCommand(v.getOutlineNodes()[0]);check('Duplicate retains subtree',JSON.stringify(tree([v.getOutlineNodes()[0]]))===JSON.stringify(tree([v.getOutlineNodes()[1]])));await v.executeUndo();await v.executeRedo();await v.executeUndo();
const selected=[v.getOutlineNodes()[0],v.getOutlineNodes()[2]];const texts=selected.map(n=>n.text);await v.convertNodesToCheckedTask(selected);check('Multi-selection task conversion retains all text',[v.getOutlineNodes()[0],v.getOutlineNodes()[2]].every((n,i)=>n.checkbox==='checked'&&n.text===texts[i]));await v.executeUndo();
await v.executeDeleteNodeKeepChildrenCommand(v.getOutlineNodes()[0]);check('Delete keeping children preserves full descendants',v.getFlatNodes().some(n=>n.text==='Grandchild'));await v.executeUndo();
await v.executeDeleteMultipleNodesCommand([v.getOutlineNodes()[0],v.getOutlineNodes()[2]]);check('Multi-delete removes only selected trees',v.getFlatNodes().length===1);await v.executeUndo();
check('All structural operations restore original semantic tree and bytes',JSON.stringify(tree(v.getOutlineNodes()))===semantic&&await app.vault.read(v.file)===before);
v.selectNode(v.getOutlineNodes()[0].line);v.wrapper.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));check('Keyboard navigation works outside editor',v.selectedNodeLines.size===1&&![...v.selectedNodeLines].includes(v.getOutlineNodes()[0].line));
return JSON.stringify(s.results.slice(resultStart));
`,
editors:String.raw`
const v=await open(s.small);let node=v.getFlatNodes().find(n=>n.text==='Plain')??v.getFlatNodes().at(-1);let before=await app.vault.read(v.file);const originalCount=v.getFlatNodes().length;
await edit(node);const cm=editor();const pasted='\n\n- pasted\n  - nested\n> quote\n~~~md\n<!--section: 1-->\n~~~\n';cm.dispatch({selection:{anchor:cm.state.doc.length}});const transfer=new DataTransfer();transfer.setData('text/plain',pasted);el().dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));check('Normal paste preserves multiline content',cm.state.doc.toString().endsWith(pasted));key('Enter',{metaKey:true});await until(()=>!editor());check('Pasted list creates no structural nodes',v.getFlatNodes().length===originalCount);await v.executeUndo();check('Undo paste restores bytes',await app.vault.read(v.file)===before);
await edit(v.getFlatNodes().find(n=>n.id===node.id));await set('Conflict draft\n\n- internal');await app.vault.process(v.file,current=>current+'\nExternal audit change');key('Enter',{metaKey:true});await wait(150);check('True external conflict retains editable draft',!!editor()&&editor().state.doc.toString()==='Conflict draft\n\n- internal'&&!editor().state.readOnly);check('True external change retained on disk',(await app.vault.read(v.file)).endsWith('External audit change'));key('Escape');await until(()=>!editor());
// Restore only this isolated fixture, while no draft is open.
await app.vault.modify(v.file,before);await v.reloadData();await ready();
const markdownLeaf=app.workspace.getLeaf('split');await markdownLeaf.openFile(v.file,{active:false});s.markdownLeaf=markdownLeaf.id;
await until(()=>markdownLeaf.view.editor?.getValue()===before);node=v.getFlatNodes().find(n=>n.id===node.id)??v.getFlatNodes().at(-1);
await v.executeEditNodeCommand(node,node.text+'\nFirst simultaneous edit');await v.executeUndo();await v.executeRedo();await v.executeUndo();check('Immediate save/undo/redo synchronizes parallel Markdown editor',markdownLeaf.view.editor.getValue()===before&&await app.vault.read(v.file)===before);
markdownLeaf.detach();delete s.markdownLeaf;
return JSON.stringify(s.results.slice(resultStart));
`,
headings:String.raw`
s.headings=s.folder+'/05-headings.md';if(!app.vault.getAbstractFileByPath(s.headings))await app.vault.create(s.headings,s.smallText);const v=await open(s.headings);const before=await app.vault.read(v.file);let frame=v.wrapper.querySelector('[data-heading-line]');frame.querySelector('.mindmap-heading-frame-title').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));await until(()=>!!editor());await set('# Renamed');key('Enter');await until(()=>!editor());await until(()=>v.wrapper.querySelector('.mindmap-heading-frame-title')?.textContent==='Renamed');check('Heading edit updates visible title after save',(await app.vault.read(v.file)).includes('# Renamed'));await v.executeUndo();
const empty=[...v.wrapper.querySelectorAll('[data-heading-frame]')].find(f=>f.classList.contains('is-empty-heading-frame'));empty.querySelector('.mindmap-empty-heading-drop-target').click();await until(()=>!!editor());check('Empty heading creates a complete editor',el().closest('.node-editor-host').clientHeight>=48);await set('Created in heading');key('Enter');await until(()=>!editor());check('Empty heading receives new node',v.getFlatNodes().some(n=>n.text==='Created in heading'));await v.executeUndo();await v.executeUndo();check('Heading operations restore exact bytes',await app.vault.read(v.file)===before);return JSON.stringify(s.results.slice(resultStart));
`,
large:String.raw`
for(const path of [s.deep,s.long]){
const start=performance.now();const v=await open(path);const opened=performance.now()-start;const before=await app.vault.read(v.file);const count=v.getFlatNodes().length;
check('Large document DOM and graph counts '+path,v.wrapper.querySelectorAll('[data-overlay][data-node-line]').length===count&&v.cy.nodes().length===count,{characters:before.length,nodes:count,openMs:Math.round(opened),edges:v.cy.edges().length,zoom:v.cy.zoom()});
const first=v.getFlatNodes()[0];const firstBox=box(v,first);const content=firstBox.querySelector('[data-text]');check('Full-height preview without internal scrollbar '+path,content.scrollHeight<=content.clientHeight+3&&getComputedStyle(content).overflowY!=='auto',{height:v.sizeMap.get(first.line).h,client:content.clientHeight,scroll:content.scrollHeight});
if(path===s.long)check('Complete long excerpt including tail preserved',first.text===s.longContent&&content.dataset.text===s.longContent&&content.textContent.includes('TAIL SENTINEL'));
const timings=[];for(let i=0;i<3;i++){let t=performance.now();await v.toggleNodeCheckbox(v.getFlatNodes()[0]);timings.push(Math.round(performance.now()-t));t=performance.now();await v.executeUndo();timings.push(Math.round(performance.now()-t));}
check('Repeated task and Undo preserve whole large file '+path,await app.vault.read(v.file)===before,{timingsMs:timings});
const last=v.getOutlineNodes().at(-1);await v.executeMoveSubtreeCommand(v.getOutlineNodes()[0],last,true);await v.executeUndo();check('Large full subtree move/Undo restores exact bytes '+path,await app.vault.read(v.file)===before);
check('No measurement containers leaked',document.querySelectorAll('.mindmap-measurement-container').length===0);
}
return JSON.stringify(s.results.slice(resultStart));
`,
legacy:String.raw`
const v=await open(s.legacy);const before=await app.vault.read(v.file);check('Legacy opens without migration',before===s.legacyText&&!before.includes('eome-outline-format'));const parent=v.getOutlineNodes()[0];await v.toggleNodeCheckbox(parent);await v.executeUndo();await v.executeDuplicateNodeCommand(v.getOutlineNodes()[0]);await v.executeUndo();await v.executeMoveSubtreeCommand(v.getOutlineNodes()[0],v.getOutlineNodes()[1],true);await v.executeUndo();check('Legacy task, duplicate, move, Undo preserve exact bytes',await app.vault.read(v.file)===before);check('File switch clears unrelated history and selection',v.commandHistory.canUndo()===false&&v.pendingCutNodeLines.size===0);return JSON.stringify(s.results.slice(resultStart));
`,
summary:String.raw`
return JSON.stringify({folder:s.folder,backup:s.backup,results:s.results,originalUnchanged:await app.vault.read(app.vault.getAbstractFileByPath(s.originalPath))===s.original});
`,
cleanup:String.raw`
if(s.markdownLeaf)app.workspace.getLeafById(s.markdownLeaf)?.detach();
for(const type of ['mindmap-view','markdown','canvas'])for(const l of app.workspace.getLeavesOfType(type))if(l.view.file?.path?.startsWith(s.folder+'/'))l.detach();
if(s.originalPath)await plugin.openMindmapReplacingLeaf(app.vault.getAbstractFileByPath(s.originalPath));
const report={folder:s.folder,backup:s.backup,results:s.results,originalUnchanged:await app.vault.read(app.vault.getAbstractFileByPath(s.originalPath))===s.original};delete window.__eomeAudit;return JSON.stringify(report);
`
};
if(stage==='key'){
  cdp('Emulation.setFocusEmulationEnabled',{enabled:true});const modifiers=Number(process.argv[3]||0);cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,modifiers});cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,modifiers:0});console.log(evaluate(common+stages['keyboard-inspect']));
}else if(stage==='expect'){
  writeFileSync('/tmp/eome-audit-key-expect.json',JSON.stringify({name:process.argv[3],text:process.argv[4],editing:process.argv[5]!=='closed'}));console.log(evaluate(common+stages['keyboard-check']));
}else if(stage==='focus-off'){cdp('Emulation.setFocusEmulationEnabled',{enabled:false});
}else{
  if(!stages[stage])throw Error('Unknown stage');
  if(stage!=='protect'&&stage!=='cleanup')cdp('Emulation.setFocusEmulationEnabled',{enabled:true});
  const result=evaluate((stage==='protect'?'':common)+stages[stage]);
  if(stage==='summary'||stage==='cleanup')writeFileSync('/tmp/eome-regression-audit-results.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
  if(stage==='cleanup')cdp('Emulation.setFocusEmulationEnabled',{enabled:false});
}
