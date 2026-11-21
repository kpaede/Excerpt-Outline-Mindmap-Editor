import {expect,it,vi} from 'vitest';
import {updateOverlays} from '../src/view/update-overlays';

it('does not replace an editor opened after an overlay paint was already scheduled',()=>{
 let editing=false;let paint!:()=>void;const remove=vi.fn();const view={cy:{destroyed:()=>false},wrapper:{isConnected:true,querySelector:()=>editing?{}:null,querySelectorAll:()=>({forEach:remove})},dismissNodeContextMenu:vi.fn(),isUpdatingOverlays:false,requestOverlayUpdateFrame:(callback:()=>void)=>{paint=callback;return true;},isDirectViewportGestureActive:()=>false,isDirectNodeDragActive:()=>false,resetDirectGestures:vi.fn(),nodeRenderResources:{clear:vi.fn()}};
 updateOverlays(view as never);expect(view.isUpdatingOverlays).toBe(true);editing=true;paint();expect(remove).not.toHaveBeenCalled();expect(view.resetDirectGestures).not.toHaveBeenCalled();expect(view.nodeRenderResources.clear).not.toHaveBeenCalled();expect(view.isUpdatingOverlays).toBe(false);
});
