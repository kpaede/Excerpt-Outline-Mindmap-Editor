import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const cli=process.env.OBSIDIAN_CLI||'/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const vault=process.env.EOME_TEST_VAULT||'Testprogramm 2';
function run(command,args){const result=execFileSync(cli,[`vault=${vault}`,command,...args],{encoding:'utf8',timeout:30000,maxBuffer:20_000_000});if(/^Error:/m.test(result))throw new Error(result);return result;}
run('eval',['code='+`(async()=>{const s=window.__eomeMultilineTests;s.current=s.folder+'/'+s.cases[2].name;await app.plugins.plugins['excerpt-outline-mindmap-editor'].openMindmapReplacingLeaf(app.vault.getAbstractFileByPath(s.current));await new Promise(r=>setTimeout(r,1200));return 'Ready';})()`]);
run('dev:cdp',['method=Profiler.enable']);
run('dev:cdp',['method=Profiler.start']);
const timing=run('eval',['code='+`(async()=>{const s=window.__eomeMultilineTests;const v=app.workspace.getLeavesOfType('mindmap-view').find(l=>l.view.file?.path===s.current).view;const before=await app.vault.read(v.file);const durations=[];for(let i=0;i<2;i++){const t=performance.now();await v.toggleNodeCheckbox(v.getOutlineNodes()[0]);durations.push(Math.round(performance.now()-t));}await new Promise(r=>setTimeout(r,600));if(await app.vault.read(v.file)!==before)throw new Error('Source changed');return JSON.stringify(durations);})()`]);
const raw=run('dev:cdp',['method=Profiler.stop']);
writeFileSync('/tmp/eome-actions-cpu-profile.json',raw);
const profile=JSON.parse(raw.slice(raw.indexOf('{'))).profile;
const nodes=new Map(profile.nodes.map(node=>[node.id,node]));
const counts=new Map();
for(const sample of profile.samples??[])counts.set(sample,(counts.get(sample)??0)+1);
const top=[...counts].sort((a,b)=>b[1]-a[1]).slice(0,18).map(([id,count])=>({samples:count,function:nodes.get(id).callFrame.functionName,url:nodes.get(id).callFrame.url,line:nodes.get(id).callFrame.lineNumber}));
console.log(JSON.stringify({timing:timing.trim(),durationMs:Math.round((profile.endTime-profile.startTime)/1000),sampleCount:profile.samples.length,top},null,2));
run('eval',['code='+`(async()=>{const s=window.__eomeMultilineTests;const leaf=app.workspace.getLeavesOfType('mindmap-view').find(l=>l.view.file?.path===s.current);leaf?.detach();s.current=s.folder+'/'+s.cases[0].name;await app.plugins.plugins['excerpt-outline-mindmap-editor'].openMindmapReplacingLeaf(app.vault.getAbstractFileByPath(s.current));return 'Large test view closed';})()`]);
