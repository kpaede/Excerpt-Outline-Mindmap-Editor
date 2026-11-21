import { execFileSync } from 'node:child_process';
const cli=process.env.OBSIDIAN_CLI||'/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const vault=process.env.EOME_TEST_VAULT||'Testprogramm 2';
const stage=process.argv[2];
const common=String.raw`
const plugin=app.plugins.plugins['excerpt-outline-mindmap-editor'];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const state=window.__eomeEditorFix;
const view=()=>app.workspace.getLeavesOfType('mindmap-view').find(l=>l.view.file?.path===window.__eomeEditorFix.path)?.view;
const key=(el,shift=false,mod=false)=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,shiftKey:shift,metaKey:mod,bubbles:true,cancelable:true}));
const until=async predicate=>{for(let i=0;i<200;i++){if(await predicate())return;await wait(20);}throw new Error('Timed out waiting for editor state');};
const check=(name,ok)=>{if(!ok)throw new Error(name);state.results.push({name,result:'passed'});};
`;
const stages={
  setup:String.raw`
const folder='EOME editor regression '+new Date().toISOString().replace(/[:.]/g,'-');
await app.vault.createFolder(folder);
const path=folder+'/Editor regression.md';
const text='---\neome-outline-format: 2\n---\n- Parent\n\t- Existing child\n- Target';
await app.vault.create(path,text);
window.__eomeEditorFix={path,originalActive:app.workspace.getActiveFile()?.path,results:[]};
await plugin.openMindmapReplacingLeaf(app.vault.getAbstractFileByPath(path));
await until(()=>view()?.wrapper?.querySelectorAll('[data-overlay]').length===3);
return {path};
`,
  baseline:String.raw`
await until(()=>view()?.wrapper?.querySelectorAll('[data-overlay]').length>=3);
const v=view();
await v.executeAddChildCommand(v.getOutlineNodes()[0]);
await until(()=>v.wrapper.querySelector('.node-editor .cm-content'));
let el=v.wrapper.querySelector('.node-editor .cm-content');let cm=el.cmTile.view;
const line=Number(el.closest('[data-overlay]').dataset.nodeLine);
const text='First paragraph\n\n- one\n  - nested\n- two';
cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:text}});
key(el,false,true);
await until(()=>!v.wrapper.querySelector('.editing'));
let box=v.wrapper.querySelector('[data-node-line="'+line+'"]');
const saved=v.getNodeByLine(line).text===text;
const stale=box.querySelector('[data-text]').dataset.text!==text;
box.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));
await until(()=>v.wrapper.querySelector('.node-editor .cm-content'));
el=v.wrapper.querySelector('.node-editor .cm-content');cm=el.cmTile.view;
const reopened=cm.state.doc.toString();
cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:'Second edit'}});
key(el,false,true);await wait(200);
const falseConflict=!!v.wrapper.querySelector('.editing')&&v.getNodeByLine(line).text===text;
el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true,cancelable:true}));
state.baseline={saved,stale,reopenedLength:reopened.length,falseConflict};
return state.baseline;
`,
  verify:String.raw`
const v=view();
await until(()=>v?.cy&&v.wrapper.querySelectorAll('[data-overlay]').length===v.getFlatNodes().length);
await v.executeAddChildCommand(v.getOutlineNodes()[0]);
await until(()=>v.wrapper.querySelector('.node-editor .cm-content'));
let el=v.wrapper.querySelector('.node-editor .cm-content');let cm=el.cmTile.view;
let line=Number(el.closest('[data-overlay]').dataset.nodeLine);
const host=el.closest('.node-editor-host');const r=host.getBoundingClientRect();
check('New node editor has a complete visible surface',host.clientHeight>=48&&r.height>30&&getComputedStyle(host).borderTopStyle==='solid');
check('New node editor has room for input',el.getBoundingClientRect().height>20);
const oldText=cm.state.doc.toString();
key(el,true,false);
check('Shift+Enter inserts a newline and keeps the editor open',cm.state.doc.toString()===oldText+'\n'&&!!v.wrapper.querySelector('.editing'));
const values=['First paragraph\n\n- one\n  - nested\n- two','Second edit\n\n* another internal list\n> quote','Third edit\n\n~~~md\n<!--section: 1-->\n~~~\n'];
const originalCount=v.getFlatNodes().length;
for(let index=0;index<values.length;index++){
  if(index){const box=v.wrapper.querySelector('[data-node-line="'+line+'"]');box.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));await until(()=>v.wrapper.querySelector('.node-editor .cm-content'));el=v.wrapper.querySelector('.node-editor .cm-content');cm=el.cmTile.view;check('Mouse reopen reads latest saved content '+index,cm.state.doc.toString()===values[index-1]);}
  cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:values[index]}});
  key(el,false,true);
  await until(()=>!v.wrapper.querySelector('.editing'));
  await until(()=>v.wrapper.querySelector('[data-node-line="'+line+'"] [data-text]')?.dataset.text===values[index]);
  check('Cmd+Enter saves complete multiline content '+index,v.getNodeByLine(line).text===values[index]);
  check('Internal lists remain content '+index,v.getFlatNodes().length===originalCount);
  check('Visible preview matches latest saved content '+index,v.wrapper.querySelector('[data-node-line="'+line+'"] [data-text]').dataset.text===values[index]);
}
const disk=await app.vault.read(v.file);
check('Saved view matches disk',disk===v.data);
state.savedText=values.at(-1);state.line=line;
return state.results;
`,
  conflict:String.raw`
const v=view();const line=state.line;
const before=await app.vault.read(v.file);
const box=v.wrapper.querySelector('[data-node-line="'+line+'"]');
box.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));await until(()=>v.wrapper.querySelector('.node-editor .cm-content'));
const el=v.wrapper.querySelector('.node-editor .cm-content');const cm=el.cmTile.view;
const draft='Keep this conflict draft\n\n- internal';cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:draft}});
const external=before+'\nExternal paragraph\n';
await app.vault.process(v.file,text=>{if(text!==before)throw new Error('Unexpected test state');return external;});
key(el,false,true);await wait(180);
check('Real external change remains protected',await app.vault.read(v.file)===external);
check('Real conflict retains visible draft',!!v.wrapper.querySelector('.editing')&&cm.state.doc.toString()===draft);
el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true,cancelable:true}));
await v.reloadData();
check('Cancel after conflict refreshes the latest source',v.data===external);
return state.results.slice(-3);
`,
  inspect:String.raw`
return {path:state.path,baseline:state.baseline,results:state.results};
`,
};
if(!stages[stage])throw new Error('Unknown stage');
const result=execFileSync(cli,[`vault=${vault}`,'eval','code='+`(async()=>{${common}\n${stages[stage]}})()`],{encoding:'utf8',timeout:30000,maxBuffer:2_000_000});
if(/^Error:/m.test(result))throw new Error(result.trim());console.log(result.trim());
