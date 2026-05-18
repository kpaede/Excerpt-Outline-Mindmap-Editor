import { Menu, TFile } from 'obsidian';
import MindmapPlugin from './main';
import { VIEW_TYPE_MINDMAP } from './constants';

export function addToggleMindmapMenuItem(
  menu: Menu,
  plugin: MindmapPlugin,
  file: TFile
) {
  const existingMindmapLeaf = plugin.app.workspace
    .getLeavesOfType(VIEW_TYPE_MINDMAP)
    .find((l) => {
      return (l.view as { file?: TFile | null }).file?.path === file.path;
    });

  if (existingMindmapLeaf) {
    menu.addItem((item) => {
      item
        .setTitle('Open in Editor')
        .setIcon('edit')
        .onClick(async () => {
          await plugin.openMarkdownReplacingLeaf(file);
        });
    });
  } else {
    menu.addItem((item) => {
      item
        .setTitle('Open as Mindmap')
        .setIcon('flow-chart')
        .onClick(async () => {
          await plugin.openMindmapReplacingLeaf(file);
        });
    });
  }
}
