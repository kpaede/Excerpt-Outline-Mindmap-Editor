export interface InkPoint {
  x: number;
  y: number;
  pressure: number;
  tiltX?: number;
  tiltY?: number;
  time?: number;
}

export interface PressurePenOptions {
  color: string;
  size: number;
  smoothing?: number;
  thinning?: number;
  streamline?: number;
}

export interface PressurePenData {
  path: InkPoint[];
  rawPath?: InkPoint[];
  beautification?: {
    kind: 'line' | 'rectangle' | 'ellipse' | 'freeform';
    confidence: number;
  };
  options: PressurePenOptions;
}

export interface ExportedDrawingItem {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export interface DrawingDocument {
  format: 'eome-drawing';
  version: 1;
  createdAt: string;
  updatedAt: string;
  items: ExportedDrawingItem[];
}
