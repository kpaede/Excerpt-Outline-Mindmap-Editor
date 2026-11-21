import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { editNodeContent } from '../src/drawing/drawing-actions';
import { createDrawingSvg } from '../src/drawing/drawing-svg';
import { thought } from './multiline-fixtures';
const mocks=vi.hoisted(()=>({openDrawing:vi.fn(async()=>null),openExcalidraw:vi.fn(async()=>{}),resolve:vi.fn()}));
vi.mock('../src/drawing/drawing-modal',()=>({openDrawingModal:mocks.openDrawing}));
vi.mock('../src/drawing/excalidraw-integration',()=>({resolveExcalidrawEmbed:mocks.resolve,openExcalidrawFile:mocks.openExcalidraw,isExcalidrawAvailable:()=>true,createExcalidrawDrawing:vi.fn()}));
const drawing=new TFile();drawing.path='drawing.svg';drawing.extension='svg';
function view(){return {file:{path:'Map.md'},app:{vault:{read:async()=>createDrawingSvg([])},metadataCache:{getFirstLinkpathDest:()=>drawing}},enterEditModeForNodeByLine:vi.fn(async()=>{}),registerTransientCloser:()=>()=>{},penPreferences:{}};}
beforeEach(()=>{vi.clearAllMocks();mocks.resolve.mockReturnValue({path:'Drawing.excalidraw.md'});});
describe('approved mixed-content Edit behavior',()=>{
  for(const text of ['Text\n\n![[drawing.svg]]','![[drawing.svg]]\n\nText','Text ![[drawing.svg|250]]','![[drawing.svg]]\n![[second.svg]]','Text\n![[Drawing.excalidraw]]']){
    it('opens the whole Markdown for '+JSON.stringify(text),async()=>{const v=view();const n={...thought(text),line:12};await editNodeContent(v as never,n);expect(v.enterEditModeForNodeByLine).toHaveBeenCalledWith(12);expect(mocks.openDrawing).not.toHaveBeenCalled();expect(mocks.openExcalidraw).not.toHaveBeenCalled();});
  }
  it('keeps the built-in editor for a pure SVG drawing',async()=>{const v=view();await editNodeContent(v as never,thought('![[drawing.svg|250]]'));expect(mocks.openDrawing).toHaveBeenCalledOnce();expect(v.enterEditModeForNodeByLine).not.toHaveBeenCalled();});
  it('keeps the Excalidraw editor for a pure Excalidraw drawing',async()=>{const v=view();await editNodeContent(v as never,thought('![[Drawing.excalidraw]]'));expect(mocks.openExcalidraw).toHaveBeenCalledOnce();expect(v.enterEditModeForNodeByLine).not.toHaveBeenCalled();});
});
