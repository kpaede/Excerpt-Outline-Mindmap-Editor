// Isolated live checks for pane choices and offscreen child connections.
import { execFileSync } from 'node:child_process';
const cli = process.env.OBSIDIAN_CLI || '/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const vault = process.env.EOME_TEST_VAULT || 'Testprogramm 2';
const code = String.raw`(async () => {
  const id = 'excerpt-outline-mindmap-editor';
  const original = app.workspace.getMostRecentLeaf();
  const saved = app.workspace.getLeavesOfType('mindmap-view').map(leaf => ({ leaf, state: leaf.getViewState() }));
  if (saved.some(({leaf}) => leaf.view.wrapper?.querySelector('.editing'))) throw Error('Save the active EOME draft before running live checks.');
  const files = [], leaves = [], results = []; let stage='reload';
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async fn => { for (let i=0; i<300; i++) { if (await fn()) return; await wait(20); } throw Error('Timed out at '+stage+'; leaves: '+JSON.stringify(leaves.map(l=>({state:l.getViewState(),nodes:l.view.cy?.nodes().length,boxes:l.view.wrapper?.querySelectorAll("[data-overlay]").length,updating:l.view.isUpdatingOverlays,editing:!!l.view.wrapper?.querySelector(".editing")})))+'; completed checks: '+JSON.stringify(results)); };
  const check = (name, ok, details) => { if (!ok) throw Error(name+' '+JSON.stringify(details)); results.push({ name, passed:true, details }); };
  const ready = async leaf => { await until(() => leaf.view.cy && !leaf.view.isUpdatingOverlays && leaf.view.wrapper.querySelectorAll('[data-overlay]').length===leaf.view.getFlatNodes().length); return leaf.view; };
  const create = async (name, text) => { const file = await app.vault.create('EOME view regression '+Date.now()+' '+name+'.md', text); files.push(file); return file; };
  const newLeaf = () => { const leaf = app.workspace.getLeaf(true); leaves.push(leaf); return leaf; };
  const activate = async leaf => { app.workspace.setActiveLeaf(leaf,{focus:false}); await app.workspace.revealLeaf(leaf); await wait(160); };
  const hasVisibleConnection = (v, edge) => {
    const line = [...v.wrapper.querySelectorAll('.mindmap-edge-layer polyline')].find(line=>line.dataset.edgeId===edge.id());
    if(!line)return false;
    const rect=line.getBoundingClientRect(), viewport=v.wrapper.getBoundingClientRect(), css=getComputedStyle(line);
    return line.getAttribute('points').split(' ').every(pair=>pair.split(',').every(n=>Number.isFinite(Number(n)))) &&
      css.visibility==='visible' && css.stroke!=='none' && css.stroke!=='transparent' &&
      rect.right>=viewport.left && rect.left<=viewport.right && rect.bottom>=viewport.top && rect.top<=viewport.bottom;
  };
  try {
    await app.plugins.disablePlugin(id);
    await app.plugins.enablePlugin(id);
    const plugin = app.plugins.plugins[id];
    if(!plugin)throw Error('Plugin reload failed');
    const ordinary = await create('ordinary', '- Ordinary note');
    const other = newLeaf();
    await other.setViewState({type:'markdown',state:{file:ordinary.path},active:true});
    for(const edgeStyle of ['straight','orthogonal']) {
      const file = await create(edgeStyle, '---\nexcerpt-outline-mindmap: rankDir:TB;edgeStyle:'+edgeStyle+'\n---\n- Parent\n'+Array.from({length:30},(_,i)=>'\t- Child '+i).join('\n'));
      const leaf = newLeaf();
      await leaf.setViewState({type:'mindmap-view',state:{file:file.path},active:true});
      await activate(leaf);
      stage=edgeStyle+': initial render';
      let v = await ready(leaf);
      v.cy.zoom(1);v.cy.center(v.cy.getElementById('n3'));await wait(100);
      stage=edgeStyle+': Add child';
      await v.executeAddChildCommand(v.getFlatNodes()[0]);
      stage=edgeStyle+': new child editor';
      await until(()=>!!v.wrapper.querySelector('.editing .cm-content'));
      await wait(100);
      const child = v.getFlatNodes().at(-1), p=v.cy.getElementById('n'+child.line).renderedPosition();
      const dimensions=v.sizeMap.get(child.line);
      check(edgeStyle+': offscreen child editor is brought into view',p.x-dimensions.w/2>=-1&&p.x+dimensions.w/2<=v.cy.width()+1&&p.y>=0&&p.y<v.cy.height(),p);
      check(edgeStyle+': zoom is preserved',v.cy.zoom()===1);
      const content=v.wrapper.querySelector('.editing .cm-content');
      const cm=content.cmTile?.view;
      if(!cm)throw Error('Could not locate fixture editor');
      cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:'New child'}});
      stage=edgeStyle+': saving child editor';
      content.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true,cancelable:true,metaKey:true}));
      await until(()=>!v.wrapper.querySelector('.editing')&&v.getFlatNodes().at(-1).text==='New child');
      await ready(leaf);await wait(200);
      const edge=v.cy.edges().filter(e=>e.target().id()==='n'+child.line)[0];
      check(edgeStyle+': complete graph after insertion',v.cy.nodes().length===32&&v.cy.edges().length===31);
      check(edgeStyle+': new connection is present and visible in the vector layer',hasVisibleConnection(v,edge));
      const pan={...v.cy.pan()},zoom=v.cy.zoom();
      await activate(other);await activate(leaf);
      check(edgeStyle+': returning to the tab preserves the viewport',Math.abs(v.cy.pan().x-pan.x)<.01&&Math.abs(v.cy.pan().y-pan.y)<.01&&v.cy.zoom()===zoom);
      check(edgeStyle+': connection remains visible after switching tabs',hasVisibleConnection(v,edge));
      await plugin.openMarkdownReplacingLeaf(file,leaf);
      await wait(1800);await activate(other);await activate(leaf);await wait(200);
      check(edgeStyle+': editor choice survives repeated activation beyond the old timeout',leaf.getViewState().type==='markdown');
      const auto=newLeaf();
      await auto.setViewState({type:'markdown',state:{file:file.path},active:true});
      stage=edgeStyle+': automatic opening in a new pane';
      await until(()=>auto.getViewState().type==='mindmap-view');
      check(edgeStyle+': new pane still automatically opens the map',auto.getViewState().type==='mindmap-view');
      check(edgeStyle+': other pane keeps its editor choice',leaf.getViewState().type==='markdown');
      auto.detach();
      await plugin.openMindmapReplacingLeaf(file,leaf);
      v=await ready(leaf);
      check(edgeStyle+': explicit switch back to EOME works',leaf.getViewState().type==='mindmap-view'&&v.cy.nodes().length===32);
    }
    return JSON.stringify({checks:results.length,results});
  } finally {
    for(const leaf of leaves)leaf.detach();
    await wait(200);
    for(const file of files)if(app.vault.getAbstractFileByPath(file.path))await app.vault.delete(file);
    const live=new Set();app.workspace.iterateAllLeaves(leaf=>live.add(leaf));
    for(const entry of saved)if(live.has(entry.leaf))await entry.leaf.setViewState(entry.state);
    if(original&&live.has(original)){app.workspace.setActiveLeaf(original,{focus:false});await app.workspace.revealLeaf(original);}
  }
})()`;
const output = execFileSync(cli, [`vault=${vault}`, 'eval', 'code='+code], { encoding:'utf8', timeout:60000, maxBuffer:2_000_000 });
console.log(output);
if (/^Error:/m.test(output)) process.exitCode = 1;
