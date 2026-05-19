export interface LayoutOptions {
  rankDir?: 'TB' | 'BT' | 'LR' | 'RL';
  align?: 'UL' | 'UR' | 'DL' | 'DR';
  nodeSep?: number;
  edgeSep?: number;
  rankSep?: number;
  marginx?: number;
  marginy?: number;
  acyclicer?: 'greedy';
  ranker?: 'network-simplex' | 'tight-tree' | 'longest-path';
  spacingFactor?: number;
  zoomFactor?: number;
}

export function createDefaultLayoutOptions() {
  return {
    rankDir: 'TB' as 'TB' | 'BT' | 'LR' | 'RL',
    align: undefined as 'UL' | 'UR' | 'DL' | 'DR' | undefined,
    nodeSep: 50,
    edgeSep: 10,
    rankSep: 50,
    marginx: 0,
    marginy: 0,
    acyclicer: undefined as 'greedy' | undefined,
    ranker: 'network-simplex' as 'network-simplex' | 'tight-tree' | 'longest-path',
    nodeWidth: 100,
    nodeHeight: 40,
    edgeMinLen: 1,
    edgeWeight: 1,
    edgeWidth: 0,
    edgeHeight: 0,
    edgeLabelPos: 'r' as 'l' | 'c' | 'r',
    edgeLabelOffset: 10,
    spacingFactor: 1.0,
    zoomFactor: undefined as number | undefined,
  };
}
