import { Menu, TFile, type WorkspaceLeaf } from 'obsidian';
import type MindmapPlugin from '../main';
import { OPEN_MINDMAP_LABEL, VIEW_TYPE_MINDMAP } from '../constants';
import { findFileLeaf } from './view-mode-controller';

export function addToggleMindmapMenuItem(
  menu: Menu,
  plugin: MindmapPlugin,
  file: TFile,
  sourceLeaf?: WorkspaceLeaf
) {
  const targetLeaf = findFileLeaf(plugin.app, file, sourceLeaf);

  if (targetLeaf?.getViewState().type === VIEW_TYPE_MINDMAP) {
    menu.addItem((item) => {
      item
        .setTitle('Open in editor')
        .setIcon('edit')
        .onClick(async () => {
          await plugin.openMarkdownReplacingLeaf(file, targetLeaf);
        });
    });
  } else {
    menu.addItem((item) => {
      item
        .setTitle(OPEN_MINDMAP_LABEL)
        .setIcon('flow-chart')
        .onClick(async () => {
          await plugin.openMindmapReplacingLeaf(file, targetLeaf ?? undefined);
        });
    });
  }
}
