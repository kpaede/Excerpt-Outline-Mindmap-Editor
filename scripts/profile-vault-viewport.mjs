// Read-only profiling: temporarily changes and restores viewport coordinates.
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const cli='/Applications/Obsidian.app/Contents/MacOS/Obsidian';const vault='Testprogramm 2';const label=process.argv[2]||'baseline';
function run(command,args=[]){const out=execFileSync(cli,[`vault=${vault}`,command,...args],{encoding:'utf8',timeout:60000,maxBuffer:20_000_000});if(/^Error:/m.test(out))throw Error(out);return out;}
const cdp=(method,params)=>run('dev:cdp',[`method=${method}`,...(params?['params='+JSON.stringify(params)]:[])]);
const parse=out=>JSON.parse(out.slice(out.indexOf('=> ')+3));
cdp('Emulation.setFocusEmulationEnabled',{enabled:true});cdp('Profiler.enable');cdp('Profiler.start');
try{
const result=parse(run('eval',['code='+String.raw`(async()=>{
const v=app.workspace.getLeavesOfType('mindmap-view').find(l=>window.__eomeViewport ? l.view.file?.path===window.__eomeViewport.path : l===app.workspace.activeLeaf)?.view;if(!v?.cy||v.wrapper.querySelector('.editing'))throw Error('Open a non-editing mindmap');
const before=await app.vault.read(v.file),pan={...v.cy.pan()},zoom=v.cy.zoom();const geometry=v.updateOverlayGeometry,redraw=v.updateOverlays;const work=[];let rebuilds=0;
v.updateOverlayGeometry=function(){const t=performance.now();const r=geometry.call(v);work.push(performance.now()-t);return r;};v.updateOverlays=function(){rebuilds++;return redraw.call(v);};
const frames=[];let last=performance.now();try{for(let i=0;i<100;i++){await new Promise(r=>requestAnimationFrame(r));const now=performance.now();frames.push(now-last);last=now;if(i<50)v.cy.pan({x:pan.x+Math.sin(i*.2)*80,y:pan.y+Math.cos(i*.2)*80});else v.cy.zoom({level:zoom*(1+Math.sin(i*.15)*.15),renderedPosition:{x:400,y:300}});}}finally{v.updateOverlayGeometry=geometry;v.updateOverlays=redraw;v.cy.zoom(zoom);v.cy.pan(pan);v.updateOverlayGeometry();}
if(await app.vault.read(v.file)!==before)throw Error('Source changed during read-only profile');
const stats=values=>{const a=[...values].sort((a,b)=>a-b);return {n:a.length,mean:Math.round(a.reduce((a,b)=>a+b,0)/a.length*100)/100,p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a.at(-1),over33ms:a.filter(x=>x>33).length};};return JSON.stringify({nodes:v.getFlatNodes().length,characters:before.length,frames:stats(frames.slice(2)),panFrames:stats(frames.slice(2,50)),zoomFrames:stats(frames.slice(50)),geometry:stats(work),rebuilds,sourceUnchanged:true});})()`]));
const raw=cdp('Profiler.stop');writeFileSync(`/tmp/eome-viewport-${label}-cpu.json`,raw);const p=JSON.parse(raw.slice(raw.indexOf('{'))).profile;const nodes=new Map(p.nodes.map(n=>[n.id,n]));const counts=new Map();for(const id of p.samples??[])counts.set(id,(counts.get(id)||0)+1);result.cpuTop=[...counts].sort((a,b)=>b[1]-a[1]).slice(0,18).map(([id,count])=>({samples:count,function:nodes.get(id).callFrame.functionName,url:nodes.get(id).callFrame.url,line:nodes.get(id).callFrame.lineNumber}));writeFileSync(`/tmp/eome-viewport-${label}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{try{cdp('Profiler.disable');}finally{cdp('Emulation.setFocusEmulationEnabled',{enabled:false});}}
