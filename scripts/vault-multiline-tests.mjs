// Uses the installed Obsidian CLI against an explicitly named test vault.
// Usage: node scripts/vault-multiline-tests.mjs setup|model|editor-open|editor-save|structure|migration|summary
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
const cli = process.env.OBSIDIAN_CLI || '/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const vault = process.env.EOME_TEST_VAULT || 'Testprogramm 2';
const stage = process.argv[2];
const fixtureBundle = '/tmp/eome-vault-fixtures.cjs';
if (stage === 'setup') {
  await build({ entryPoints: ['tests/multiline-fixtures.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: fixtureBundle });
  const { createRequire } = await import('node:module');
  const { thought, richText, document, semantic } = createRequire(import.meta.url)(fixtureBundle);
  let chain = thought('Deepest\n\n' + 'Long excerpt with Unicode ä 日本語 🧠 and [[Link]].\n\n'.repeat(12));
  for (let i = 0; i < 60; i++) chain = thought(`Level ${i}\n\n` + 'Paragraph with spaces.  \n\n- internal\n  * nested\n1. item\n> quote\n# Internal heading\n'.repeat(4), [chain, thought(`Side ${i}\n\n` + 'A long paragraph.\n\n'.repeat(20))], i % 3 === 0 ? 'unchecked' : 'none');
  const cases = [
    { name: '01-rich-markdown.md', roots: [thought('Excerpt\n' + richText, [thought('Child\n' + richText, [thought('Grandchild\n' + richText)])], 'unchecked'), thought('Target\nSecond paragraph', [thought('Existing child')]), thought('[x] literal\n' + richText)] },
    { name: '02-sixty-levels.md', roots: [chain, thought('Independent root\n' + richText)] },
    { name: '03-over-100000-characters.md', roots: [thought('Very long excerpt\n\n' + ('A deliberately long paragraph with Unicode äöü 日本語, trailing spaces.  \n\n- content list\n  - nested content\n> quote\n\n').repeat(1000), [thought('Real child\n\n' + richText)], 'unchecked'), thought('Independent target')] },
    { name: '04-crlf.md', roots: [thought('\n\n[x] literal\n' + richText, [thought('Child\n\n')], 'checked'), thought('Second')] },
  ];
  writeFileSync('/tmp/eome-vault-fixtures.json', JSON.stringify(cases.map(entry => ({ name: entry.name, text: document(entry.roots, entry.name.includes('crlf') ? '\r\n' : '\n'), expected: semantic(entry.roots) }))));
}
const common = `
const plugin = app.plugins.plugins['excerpt-outline-mindmap-editor'];
const state = window.__eomeMultilineTests;
const check = (name, ok, details = '') => { if (!ok) throw new Error(name + ': ' + details); state.results.push({ name, result: 'passed', details }); };
const tree = nodes => nodes.map(n => ({ text:n.text, checkbox:n.checkbox, children:tree(n.children) }));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const view = () => app.workspace.getLeavesOfType('mindmap-view').find(leaf => leaf.view.file?.path === state.current)?.view;
`;
const stages = {
  setup: `
if (app.vault.getName() !== ${JSON.stringify(vault)}) throw new Error('Wrong vault');
const folder = 'EOME multiline tests ' + new Date().toISOString().replace(/[:.]/g, '-');
await app.vault.createFolder(folder);
const cases = JSON.parse(require('fs').readFileSync('/tmp/eome-vault-fixtures.json', 'utf8'));
window.__eomeMultilineTests = { folder, cases, results: [], current: folder + '/' + cases[0].name };
for (const entry of cases) await app.vault.create(folder + '/' + entry.name, entry.text);
await plugin.openMindmapReplacingLeaf(app.vault.getAbstractFileByPath(window.__eomeMultilineTests.current));
return { folder, cases: cases.map(c => ({ name:c.name, characters:c.text.length })) };
`,
  model: `
for (const entry of state.cases) {
  state.current = state.folder + '/' + entry.name;
  const started = performance.now();
  await plugin.openMindmapReplacingLeaf(app.vault.getAbstractFileByPath(state.current));
  let v;
  for (let i = 0; i < 500; i++) { v = view(); if (v?.cy && v.getFlatNodes().length === v.cy.nodes().length && v.wrapper.querySelectorAll('[data-overlay]').length === v.getFlatNodes().length) break; await wait(50); }
  check('Live tree: ' + entry.name, JSON.stringify(tree(v.getOutlineNodes())) === JSON.stringify(entry.expected));
  check('No automatic rewrite: ' + entry.name, await app.vault.read(v.file) === entry.text);
  const flat = v.getFlatNodes();
  check('Rendered nodes and edges: ' + entry.name, v.cy.nodes().length === flat.length && v.cy.edges().length === flat.length - v.getOutlineNodes().length);
  const zero = [...v.sizeMap.values()].some(s => s.w <= 0 || s.h <= 0);
  check('Nonzero measured sizes: ' + entry.name, !zero, 'nodes=' + flat.length + ', elapsedMs=' + Math.round(performance.now() - started));
}
state.current = state.folder + '/' + state.cases[0].name;
await plugin.openMindmapReplacingLeaf(app.vault.getAbstractFileByPath(state.current));
return state.results;
`,
  'editor-open': `
const v = view();
const node = v.getFlatNodes()[0];
state.beforeEditor = await app.vault.read(v.file);
state.editNodeId = node.id;
await v.enterEditModeForNodeByLine(node.line);
await wait(200);
const cm = v.wrapper.querySelector('.cm-content');
check('Embedded Markdown editor opened', !!cm);
return { editing:!!cm, active:document.activeElement?.className, hints:[...v.wrapper.querySelectorAll('.node-editor-hint')].map(el=>el.textContent) };
`,
  'editor-save': `
const v = view();
await wait(400);
const after = await app.vault.read(v.file);
check('Real Shift+Enter preserved a newline', after !== state.beforeEditor && v.getFlatNodes()[0].text.includes('Vault keyboard test\\n'));
check('Enter completed editing', !v.wrapper.querySelector('.editing'));
check('Editing identity retained', v.getFlatNodes()[0].id === state.editNodeId);
check('Children survived real editor save', JSON.stringify(tree(v.getOutlineNodes()[0].children)) === JSON.stringify(state.cases[0].expected[0].children));
return { firstText:v.getFlatNodes()[0].text.slice(0,120), results:state.results.slice(-4) };
`,
  structure: `
const v = view();
const before = await app.vault.read(v.file);
const first = v.getOutlineNodes()[0];
const content = first.text;
await v.toggleNodeCheckbox(first);
check('Central checkbox changes status only', v.getOutlineNodes()[0].text === content && v.getOutlineNodes()[0].checkbox === 'checked');
await v.toggleNodeCheckbox(v.getOutlineNodes()[0]);
check('Reopen checkbox retains content', v.getOutlineNodes()[0].text === content && v.getOutlineNodes()[0].checkbox === 'unchecked');
await v.executeDuplicateNodeCommand(v.getOutlineNodes()[0]);
check('Duplicate retains full subtree', JSON.stringify(tree([v.getOutlineNodes()[0]])) === JSON.stringify(tree([v.getOutlineNodes()[1]])));
await v.executeUndo();
check('Undo duplicate restores whole document', await app.vault.read(v.file) === before);
await v.executeRedo();
check('Redo duplicate restores tree', JSON.stringify(tree([v.getOutlineNodes()[0]])) === JSON.stringify(tree([v.getOutlineNodes()[1]])));
await v.executeUndo();
return state.results.slice(-6);
`,
  interactions: String.raw`
const v = view();
const original = await app.vault.read(v.file);
const originalTree = JSON.stringify(tree(v.getOutlineNodes()));
await v.enterEditModeForNodeByLine(v.getFlatNodes()[0].line);
let element = v.wrapper.querySelector('.cm-content');
let cm = element.cmTile.view;
cm.dispatch({selection:{anchor:cm.state.doc.length}});
const data = new DataTransfer();
const pasted = '\n\n- pasted internal list\n  - nested item\n> quote\n~~~md\n<!--section: 1-->\n~~~\n';
data.setData('text/plain', pasted);
element.dispatchEvent(new ClipboardEvent('paste', { bubbles:true, cancelable:true, clipboardData:data }));
check('Multiline paste in actual CodeMirror remains content', cm.state.doc.toString().endsWith(pasted));
element.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', keyCode:13, metaKey:true, bubbles:true, cancelable:true }));
for (let i=0;i<100 && v.wrapper.querySelector('.editing');i++) await wait(30);
check('Paste did not create structural nodes', v.getFlatNodes().length === 6);
check('Pasted lists and comment preserved', v.getFlatNodes()[0].text.endsWith(pasted));
await v.executeUndo();
check('Undo pasted text restores exact source', await app.vault.read(v.file) === original);
await v.enterEditModeForNodeByLine(v.getFlatNodes()[0].line);
element = v.wrapper.querySelector('.cm-content'); cm = element.cmTile.view;
cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:'An unsaved draft\n\n- still content'}});
element.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', code:'Escape', keyCode:27,bubbles:true,cancelable:true}));
await wait(100);
check('Escape cancels multiline changes', await app.vault.read(v.file) === original && !v.wrapper.querySelector('.editing'));
const source = v.getOutlineNodes()[0];
const target = v.getOutlineNodes()[1];
const sourceTree = JSON.stringify(tree([source]));
const sourceBox = v.wrapper.querySelector('[data-node-line="'+source.line+'"]');
const targetBox = v.wrapper.querySelector('[data-node-line="'+target.line+'"]');
const transfer = new DataTransfer();
sourceBox.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));
const rect = targetBox.getBoundingClientRect();
const drag = {bubbles:true,cancelable:true,dataTransfer:transfer,clientX:rect.left+rect.width*.25,clientY:rect.top+rect.height*.75};
targetBox.dispatchEvent(new DragEvent('dragenter',drag));
targetBox.dispatchEvent(new DragEvent('dragover',drag));
targetBox.dispatchEvent(new DragEvent('drop',drag));
for(let i=0;i<150 && JSON.stringify(tree(v.getOutlineNodes()))===originalTree;i++) await wait(30);
check('Live DOM drag-and-drop moves full subtree', JSON.stringify(tree([v.getOutlineNodes()[0].children[0]]))===sourceTree);
await v.executeUndo();
check('Undo drag-and-drop restores source', await app.vault.read(v.file)===original);
v.selectNode(v.getOutlineNodes()[1].line);
const selectedBefore = [...v.selectedNodeLines][0];
v.wrapper.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',code:'ArrowDown',keyCode:40,bubbles:true,cancelable:true}));
check('Navigation outside editor remains active', v.selectedNodeLines.size===1 && [...v.selectedNodeLines][0]!==selectedBefore);
const selected = [v.getOutlineNodes()[0],v.getOutlineNodes()[2]];
const texts = selected.map(n=>n.text);
await v.convertNodesToCheckedTask(selected);
check('Multiple selection task conversion retains exact content', [v.getOutlineNodes()[0],v.getOutlineNodes()[2]].every((n,i)=>n.checkbox==='checked' && n.text===texts[i]));
await v.executeUndo();
return state.results.slice(-10);
`,
  conflicts: String.raw`
const v = view();
const before = await app.vault.read(v.file);
const external = before + '\nExternal change during node editing\n';
await v.enterEditModeForNodeByLine(v.getFlatNodes()[0].line);
const element=v.wrapper.querySelector('.cm-content');
const cm=element.cmTile.view;
const draft='Draft that must survive a conflict\n\n- content';
cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:draft}});
await app.vault.process(v.file,text=>{if(text!==before)throw new Error('Unexpected state');return external;});
element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,metaKey:true,bubbles:true,cancelable:true}));
await wait(300);
check('External changes are not overwritten by stale node editor',await app.vault.read(v.file)===external);
check('Conflicting draft retained in open editor',!!v.wrapper.querySelector('.editing') && cm.state.doc.toString()===draft);
element.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true,cancelable:true}));
await v.reloadData();
await app.vault.process(v.file,text=>{if(text!==external)throw new Error('Unexpected external edit');return before;});
await v.reloadData();
const mdLeaf=app.workspace.getLeaf('split');
await mdLeaf.openFile(v.file);
const editor=mdLeaf.view.editor;
const oldNode=v.getFlatNodes()[0];
editor.setValue(before+'\nSimultaneous Markdown editor change\n');
let rejected=false;
try{await v.executeEditNodeCommand(oldNode,'Stale overwrite');}catch{rejected=true;}
check('Simultaneous Markdown editor changes are protected',rejected && editor.getValue().includes('Simultaneous Markdown editor change'));
await mdLeaf.view.save();
mdLeaf.detach();
const written=await app.vault.read(v.file);
await app.vault.process(v.file,text=>{if(text!==written)throw new Error('Unexpected state');return before;});
await v.reloadData();
await plugin.openMindmapReplacingLeaf(v.file);
return state.results.slice(-3);
`,
  'long-history': String.raw`
const saved=state.current;
state.current=state.folder+'/'+state.cases[2].name;
await plugin.openMindmapReplacingLeaf(app.vault.getAbstractFileByPath(state.current));
const v=view();
for(let i=0;i<100 && !v.cy;i++)await wait(30);
const before=await app.vault.read(v.file);
const original=v.getOutlineNodes()[0].text;
for(let i=0;i<5;i++)await v.toggleNodeCheckbox(v.getOutlineNodes()[0]);
for(let i=0;i<5;i++)await v.executeUndo();
check('Five live undo steps restore 127781 characters exactly',await app.vault.read(v.file)===before);
for(let i=0;i<5;i++)await v.executeRedo();
check('Five live redo steps retain long text and children',v.getOutlineNodes()[0].text===original && v.getOutlineNodes()[0].children.length===1 && v.getOutlineNodes()[0].checkbox==='checked');
for(let i=0;i<5;i++)await v.executeUndo();
state.current=saved;
await plugin.openMindmapReplacingLeaf(app.vault.getAbstractFileByPath(saved));
return state.results.slice(-2);
`,
  migration: String.raw`
const path=state.folder+'/05-legacy-migration.md';
const legacy='---\ntitle: Migration test\n---\n# Outer section\n- [x] Root\n  - Child\n    * Grandchild\n- [ ] Other\n';
let file=app.vault.getAbstractFileByPath(path);
if(!file)file=await app.vault.create(path,legacy);
await plugin.openMindmapReplacingLeaf(file);
state.current=path;
const v=view();
for(let i=0;i<100 && !v.cy;i++)await wait(30);
const expected=JSON.stringify(tree(v.getOutlineNodes()));
check('Legacy open does not migrate',await app.vault.read(file)===legacy);
app.commands.executeCommandById(plugin.manifest.id+':preview-multiline-outline-migration');
await wait(150);
let modal=document.querySelector('.modal-container:last-of-type');
check('Migration preview displays full versioned source',!!modal?.querySelector('textarea')?.value.includes('eome-outline-format: 2'));
const confirm=[...modal.querySelectorAll('button')].find(b=>b.textContent==='Back up and migrate');
confirm.click();
await wait(300);
await v.reloadData();
check('Migration preserves all legacy parents, children and tasks',JSON.stringify(tree(v.getOutlineNodes()))===expected);
const migrated=await app.vault.read(file);
const backup=app.vault.getFiles().find(f=>f.path.startsWith(path+'.') && f.path.endsWith('.eome-backup'));
check('Migration stores full original backup',!!backup && await app.vault.read(backup)===legacy);
app.commands.executeCommandById(plugin.manifest.id+':preview-multiline-outline-migration');
await wait(100);
check('Repeated migration is idempotent',await app.vault.read(file)===migrated && !document.querySelector('.eome-migration-preview'));
app.commands.executeCommandById(plugin.manifest.id+':restore-multiline-outline-backup');
await wait(100);
modal=document.querySelector('.modal-container:last-of-type');
[...modal.querySelectorAll('button')].find(b=>b.textContent===backup.name).click();
await wait(100);
modal=document.querySelector('.modal-container:last-of-type');
[...modal.querySelectorAll('button')].find(b=>b.textContent==='Back up and restore').click();
await wait(200);
check('Backup restoration recovers exact original',await app.vault.read(file)===legacy);
await v.reloadData();
state.current=state.folder+'/'+state.cases[0].name;
await plugin.openMindmapReplacingLeaf(app.vault.getAbstractFileByPath(state.current));
return state.results.slice(-6);
`,
  viewport: String.raw`
const saved=state.current;
for(const entry of state.cases.slice(1)) {
  state.current=state.folder+'/'+entry.name;
  await plugin.openMindmapReplacingLeaf(app.vault.getAbstractFileByPath(state.current));
  const v=view();
  for(let i=0;i<500 && (!v.cy || !v.firstFitDone || v.wrapper.querySelectorAll('[data-overlay]').length!==v.getFlatNodes().length);i++)await wait(30);
  check('Exact full source after layout correction: '+entry.name,await app.vault.read(v.file)===entry.text);
  check('Correct tree after layout correction: '+entry.name,JSON.stringify(tree(v.getOutlineNodes()))===JSON.stringify(entry.expected));
  check('Readable initial viewport: '+entry.name,v.cy.zoom()>=.25,'zoom='+v.cy.zoom());
  check('Bounded preview without truncation: '+entry.name,[...v.sizeMap.values()].every(s=>s.h<=640) && v.wrapper.querySelector('[data-node-line="'+v.getOutlineNodes()[0].line+'"] [data-text]').dataset.text===entry.expected[0].text);
  const stats=v.wrapper.querySelector('.mindmap-outline-stats');
  check('Toolbar exposes actual thought count: '+entry.name,stats?.textContent===String(v.getFlatNodes().length),stats?.title);
}
state.current=saved;
await plugin.openMindmapReplacingLeaf(app.vault.getAbstractFileByPath(saved));
return state.results.slice(-15);
`,
  performance: String.raw`
const results=[];
for(const entry of [state.cases[2],state.cases[1]]){
  state.current=state.folder+'/'+entry.name;
  for(const leaf of app.workspace.getLeavesOfType('mindmap-view'))if(leaf.view.file?.path===state.current)leaf.detach();
  const started=performance.now();
  await plugin.openMindmapReplacingLeaf(app.vault.getAbstractFileByPath(state.current));
  const v=view();
  for(let i=0;i<500&&(!v.cy||!v.firstFitDone||v.wrapper.querySelectorAll('[data-overlay]').length!==v.getFlatNodes().length);i++)await wait(20);
  const openMs=Math.round(performance.now()-started);
  const before=await app.vault.read(v.file);
  const first=v.wrapper.querySelector('[data-text]');
  const firstText=first.dataset.text;
  const componentCount=v._children?.length??0;
  const domBefore=v.wrapper.querySelectorAll('*').length;
  const delays=[];let last=performance.now();
  const timer=setInterval(()=>{const now=performance.now();delays.push(now-last-20);last=now;},20);
  const timings=[];
  try{
    for(let i=0;i<3;i++){const t=performance.now();await v.toggleNodeCheckbox(v.getOutlineNodes()[0]);timings.push(Math.round(performance.now()-t));}
    for(let i=0;i<3;i++){const t=performance.now();await v.executeUndo();timings.push(Math.round(performance.now()-t));}
    await wait(80);
  }finally{clearInterval(timer);}
  check('Task actions reuse Markdown DOM: '+entry.name,first===v.wrapper.querySelector('[data-text]') && first.dataset.text===firstText);
  check('Render resources stay bounded: '+entry.name,(v._children?.length??0)===componentCount && v.wrapper.querySelectorAll('*').length===domBefore);
  check('Performance actions preserve complete source: '+entry.name,await app.vault.read(v.file)===before);
  const result={file:entry.name,characters:before.length,nodes:v.getFlatNodes().length,openMs,taskAndUndoMs:timings,maxEventLoopDelayMs:Math.max(0,...delays.map(Math.round)),components:componentCount,domNodes:domBefore};
  results.push(result);state.results.push({name:'Performance profile: '+entry.name,result:'measured',details:JSON.stringify(result)});
  v.leaf.detach();
}
state.current=state.folder+'/'+state.cases[0].name;
await plugin.openMindmapReplacingLeaf(app.vault.getAbstractFileByPath(state.current));
return results;
`,
  'performance-isolated': String.raw`
const previews=[];
app.workspace.iterateAllLeaves(leaf=>{if(leaf.view.getViewType().toLowerCase().includes('social-converter'))previews.push({leaf,state:leaf.getViewState()});});
const metrics=[];
try{
  for(const preview of previews)await preview.leaf.setViewState({type:'empty',active:false});
  for(const entry of [state.cases[2],state.cases[1]]){
    state.current=state.folder+'/'+entry.name;
    await plugin.openMindmapReplacingLeaf(app.vault.getAbstractFileByPath(state.current));
    const v=view();
    for(let i=0;i<500&&(!v.cy||!v.firstFitDone||v.wrapper.querySelectorAll('[data-overlay]').length!==v.getFlatNodes().length);i++)await wait(20);
    await wait(150);
    const before=await app.vault.read(v.file);
    const first=v.wrapper.querySelector('[data-text]');
    const count=v._children?.length;
    const times=[];const delays=[];let last=performance.now();
    const timer=setInterval(()=>{const now=performance.now();delays.push(now-last-20);last=now;},20);
    try{
      for(let i=0;i<2;i++){const t=performance.now();await v.toggleNodeCheckbox(v.getOutlineNodes()[0]);times.push(Math.round(performance.now()-t));}
      for(let i=0;i<2;i++){const t=performance.now();await v.executeUndo();times.push(Math.round(performance.now()-t));}
      await wait(80);
    }finally{clearInterval(timer);}
    check('Isolated actions retain entire source: '+entry.name,await app.vault.read(v.file)===before);
    check('Isolated actions reuse DOM and render scope: '+entry.name,first===v.wrapper.querySelector('[data-text]')&&v._children?.length===count);
    const metric={file:entry.name,nodes:v.getFlatNodes().length,taskMs:times,maxEventLoopDelayMs:Math.max(0,...delays.map(Math.round)),components:count};
    metrics.push(metric);state.results.push({name:'Isolated performance profile: '+entry.name,result:'measured',details:JSON.stringify(metric)});
    v.leaf.detach();
  }
}finally{
  state.current=state.folder+'/'+state.cases[0].name;
  await plugin.openMindmapReplacingLeaf(app.vault.getAbstractFileByPath(state.current));
  for(const preview of previews)await preview.leaf.setViewState(preview.state);
}
return {temporarilyHiddenPreviewCount:previews.length,metrics};
`,
  summary: `return { folder:state.folder, results:state.results, current:state.current };`,
};
if (!stages[stage]) throw new Error('Unknown stage');
const code = `(async () => { ${common}\n${stages[stage]} })()`;
const result = execFileSync(cli, [`vault=${vault}`, 'eval', 'code=' + code], { encoding: 'utf8', maxBuffer: 5_000_000, timeout: 120_000 });
if (/^Error:/m.test(result)) throw new Error(result.trim());
console.log(result.trim());
