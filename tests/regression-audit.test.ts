import { describe, expect, it, vi } from 'vitest';
import { OutlineSession } from '../src/domain/outline-session';
import { flattenOutline, isOutlineCompatible, parseOutline } from '../src/utils/outline';
import * as actions from '../src/domain/mindmap-file';
import { commandNodeIdentities } from '../src/view/command-identities';
import { CommandHistory, type MindmapCommand } from '../src/history/command-history';
import { document, mockVault, thought } from './multiline-fixtures';
import { commitDocument } from '../src/storage/document-writer';
import { previewMigration } from '../src/domain/outline-migration';
import { getNodesAsMarkdown } from '../src/view/clipboard';
import { NodeEditSession } from '../src/editor/node-edit-session';

function cmd(type: MindmapCommand['type'], beforeState: string, afterState: string, node: any, target?: any, metadata = {}): MindmapCommand {
  return { type, beforeState, afterState, nodeInfo: CommandHistory.createNodeInfo(node), targetInfo: target && CommandHistory.createNodeInfo(target), metadata, timestamp: 0 };
}

describe('identity mapping through actual document operations', () => {
  const setup = () => {
    const before = document([thought('A\nparagraph', [thought('A1'), thought('A2\n\n')]), thought('B', [thought('B1')]), thought('C')]);
    const session = new OutlineSession();
    const nodes = flattenOutline(session.parse(before));
    const vault = mockVault(before);
    return { before, session, nodes, vault };
  };
  const check = (s: ReturnType<typeof setup>, command: MindmapCommand, deleted: string[] = []) => {
    const after = flattenOutline(s.session.parse(command.afterState, commandNodeIdentities(command, s.nodes)));
    for (const old of s.nodes.filter(n => !deleted.includes(n.text))) {
      expect(after.find(n => n.text === old.text)?.id, old.text).toBe(old.id);
    }
    expect(new Set(after.map(n => n.id)).size).toBe(after.length);
    const undo = flattenOutline(s.session.parse(s.before));
    expect(undo.map(n => n.id)).toEqual(s.nodes.map(n => n.id));
  };
  for (const child of [true, false]) for (const position of ['first', 'last'] as const) for (const direction of ['before', 'after'] as const) {
    it(`moves subtree child=${child}, child position=${position}, sibling=${direction}`, () => {
      const s = setup(); const [a,,,b] = s.nodes;
      const after = actions.moveSubtreeInText(s.before, a, b, child, position, direction);
      check(s, cmd('move-subtree', s.before, after, a, b, { insertAsChild: child, childInsertPosition: position, siblingInsertPosition: direction }));
    });
  }
  for (const kind of ['child-first', 'child-last', 'sibling-before', 'sibling-after', 'duplicate', 'paste', 'delete-many', 'keep-many', 'cut-many', 'heading', 'edit'] as const) {
    it(`preserves existing identities after ${kind}`, async () => {
      const s = setup(); const [a,a1,a2,b,b1,c] = s.nodes; let command: MindmapCommand;
      const { app, file } = s.vault;
      switch(kind) {
        case 'child-first': case 'child-last': {
          const pos = kind === 'child-first' ? 'first' : 'last';
          command = cmd('add-child-text', s.before, await actions.addChildText(app,file,a,'New\nparagraph',pos),a,undefined,{childInsertPosition:pos}); break;
        }
        case 'sibling-before': case 'sibling-after': {
          const pos = kind === 'sibling-before' ? 'before' : 'after';
          command = cmd('add-sibling', s.before, await actions.addSiblingText(app,file,b,'New\nparagraph',pos),b,undefined,{siblingInsertPosition:pos}); break;
        }
        case 'duplicate': command=cmd('add-sibling',s.before,await actions.duplicateSubtree(app,file,a),a,undefined,{duplicated:true}); break;
        case 'paste': command=cmd('add-child-text',s.before,await actions.addMarkdownAsChildren(app,file,a,'- New\n  more\n\t- Child'),a); break;
        case 'delete-many': command=cmd('delete-node',s.before,await actions.deleteMultipleNodes(app,file,[a1,b]),a1,undefined,{sourceLines:[a1.line,b.line]}); break;
        case 'keep-many': command=cmd('delete-node-keep-children',s.before,await actions.deleteMultipleNodesKeepChildren(app,file,[a,b1]),a,undefined,{sourceLines:[a.line,b1.line]}); break;
        case 'cut-many': command=cmd('move-subtree',s.before,await actions.cutPasteMarkdownAsChildren(app,file,[a1,b],c,'STALE'),a1,c,{cutPaste:true,sourceLines:[a1.line,b.line]}); break;
        case 'heading': command=cmd('add-heading',s.before,await actions.addHeadingBeforeNode(app,file,b,'# Section'),b); break;
        case 'edit': command=cmd('edit-node',s.before,await actions.writeNode(app,file,a,'A\nparagraph\nnew\nlines'),a); break;
      }
      const deleted = kind === 'delete-many' ? [a1.text,b.text,b1.text] : kind === 'keep-many' ? [a.text,b1.text] : kind === 'edit' ? [a.text] : [];
      check(s, command!, deleted);
      if(kind === 'edit') expect(flattenOutline(s.session.parse(command!.afterState))[0].id).toBe(a.id);
    });
  }
  for(const position of ['before','after'] as const) it(`disambiguates adding ${position} identical empty nodes`, async()=>{
    const before=document([thought(''),thought(''),thought('')]);const session=new OutlineSession();const nodes=flattenOutline(session.parse(before));const v=mockVault(before);
    const after=await actions.addSibling(v.app,v.file,nodes[1],position);
    const result=flattenOutline(session.parse(after,commandNodeIdentities(cmd('add-sibling',before,after,nodes[1],undefined,{siblingInsertPosition:position}),nodes)));
    expect(result[0].id).toBe(nodes[0].id);expect(result[position==='before'?2:1].id).toBe(nodes[1].id);expect(result[3].id).toBe(nodes[2].id);
    expect(new Set(result.map(n=>n.id)).size).toBe(4);
  });
});

describe('clipboard preserves newer source content and format boundaries',()=>{
  it('moves the edited current source after Cut, retaining tasks, whitespace and real children',async()=>{
    const before=document([thought('Old',[thought('Child')]),thought('Target')]);const clipboard=getNodesAsMarkdown(before,[parseOutline(before)[0]]);
    const current=actions.writeNodeInText(before,parseOutline(before)[0],'New\n\n- internal\nTail  \n');const v=mockVault(current);const nodes=parseOutline(current);
    const after=await actions.cutPasteMarkdownAsChildren(v.app,v.file,[nodes[0]],nodes[1],clipboard);
    expect(parseOutline(after)[0].children[0].text).toBe('New\n\n- internal\nTail  \n');expect(parseOutline(after)[0].children[0].children[0].text).toBe('Child');
  });
  it('copies plain Markdown without adding properties and pastes known legacy indentation into v2',async()=>{
    const legacy='- Parent\n  - Child';expect(getNodesAsMarkdown(legacy,parseOutline(legacy))).toBe(legacy);
    const v=mockVault(document([thought('Target')]));const after=await actions.addMarkdownAsChildren(v.app,v.file,parseOutline(v.getText())[0],legacy,1);
    expect(parseOutline(after)[0].children[0].children[0].text).toBe('Child');
  });
  it('accepts explicitly tagged single-line v2 into legacy and refuses multiline without a write',async()=>{
    const v=mockVault('- Target');const after=await actions.addMarkdownAsChildren(v.app,v.file,parseOutline(v.getText())[0],document([thought('One',[thought('Child')])]),2);
    expect(parseOutline(after)[0].children[0].children[0].text).toBe('Child');
    await expect(actions.addMarkdownAsChildren(v.app,v.file,parseOutline(after)[0],'- Text\n  paragraph',2)).rejects.toThrow(/multiline/);expect(v.getText()).toBe(after);
  });
  it('rejects a legacy subtree spanning a heading rather than deleting unrelated text',()=>{
    const before='- Parent\n# Outside heading\n\t- Ambiguous child';expect(isOutlineCompatible(before)).toBe(false);expect(()=>previewMigration(before)).toThrow(/ambiguous/);
    expect(()=>actions.deleteNodeInText(before,parseOutline(before)[0])).toThrow(/heading/);
  });
});

function editor(initial:string) {
  let text=initial;const undo:string[]=[];
  const offset=(p:{line:number;ch:number})=>text.split('\n').slice(0,p.line).reduce((n,l)=>n+l.length+1,0)+p.ch;
  return {getValue:()=>text,offsetToPos:(n:number)=>{const lines=text.slice(0,n).split('\n');return {line:lines.length-1,ch:lines.at(-1)!.length};},replaceRange:(insert:string,from:any,to:any)=>{undo.push(text);text=text.slice(0,offset(from))+insert+text.slice(offset(to));},type:(value:string)=>{text=value;},undo};
}
describe('simultaneous Markdown editor and history',()=>{
  it('synchronizes clean views before an immediate second write and Undo/Redo, retaining native transactions',async()=>{
    const v=mockVault('Before');const ed=editor('Before');v.views.push({view:{file:v.file,editor:ed}});const h=new CommandHistory(v.app);const node={line:0,text:'',indent:'',marker:'-'};
    await commitDocument(v.app,v.file,'Before','After');h.executeCommand(cmd('edit-node','Before','After',node));
    expect(ed.getValue()).toBe('After');expect(ed.undo).toEqual(['Before']);
    await commitDocument(v.app,v.file,'After','After again');h.executeCommand(cmd('edit-node','After','After again',node));
    expect(await h.undo(v.file)).toBe('After');expect(await h.undo(v.file)).toBe('Before');expect(await h.redo(v.file)).toBe('After');expect(ed.getValue()).toBe('After');
  });
  it('never overwrites typing occurring during a disk write',async()=>{
    const v=mockVault('Before');const ed=editor('Before');v.views.push({view:{file:v.file,editor:ed}});
    const process=v.app.vault.process;v.app.vault.process=async(file,fn)=>{await process(file,fn);ed.type('New user draft');};
    await commitDocument(v.app,v.file,'Before','After');expect(v.getText()).toBe('After');expect(ed.getValue()).toBe('New user draft');
    await expect(commitDocument(v.app,v.file,'After','Another')).rejects.toThrow(/externally/);
  });
  it('serializes rapid Undo/Redo calls rather than replaying the same index',async()=>{
    const v=mockVault('Three');const h=new CommandHistory(v.app);const node={line:0,text:'',indent:'',marker:'-'};
    h.executeCommand(cmd('edit-node','One','Two',node));h.executeCommand(cmd('edit-node','Two','Three',node));
    expect(await Promise.all([h.undo(v.file),h.undo(v.file)])).toEqual(['Two','One']);expect(await Promise.all([h.redo(v.file),h.redo(v.file)])).toEqual(['Two','Three']);
  });
  it('does not refresh or select a different file after disposing a pending editor',async()=>{
    let release!:()=>void;const pending=new Promise<void>(r=>release=r);const refresh=vi.fn();const select=vi.fn();const close=vi.fn();
    const session=new NodeEditSession('Old',{save:()=>pending,close,refresh,select,error:vi.fn()});const save=session.finish(true,'New');session.dispose();release();await save;
    expect(close).toHaveBeenCalledOnce();expect(refresh).not.toHaveBeenCalled();expect(select).not.toHaveBeenCalled();
  });
});

it('keeps identities of identical thoughts through zoom persistence and Undo',async()=>{
 const {carrySavedZoom}=await import('../src/storage/zoom-settings-change');const before=document([thought(''),thought(''),thought('')]);const session=new OutlineSession();const nodes=flattenOutline(session.parse(before));const v=mockVault(before);const after=await actions.addSibling(v.app,v.file,nodes[1],'before');const command=cmd('add-sibling',before,after,nodes[1],undefined,{siblingInsertPosition:'before'});const added=flattenOutline(session.parse(after,commandNodeIdentities(command,nodes)));session.retainSavedZoom(.7);expect(flattenOutline(session.parse(carrySavedZoom(after,.7))).map(n=>n.id)).toEqual(added.map(n=>n.id));expect(flattenOutline(session.parse(carrySavedZoom(before,.7))).map(n=>n.id)).toEqual(nodes.map(n=>n.id));
});
