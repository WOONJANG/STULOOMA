export type VectorMatrix = [number, number, number, number, number, number];
export interface VectorPoint { x: number; y: number }
export interface VectorAnchor extends VectorPoint {
  id: string; in?: VectorPoint; out?: VectorPoint; kind: 'corner' | 'smooth' | 'symmetric';
}
export interface VectorContour { anchors: VectorAnchor[]; closed: boolean }
export interface VectorPath { contours: VectorContour[]; fillRule: 'nonzero' | 'evenodd' }
export interface VectorStop { offset: number; color: string; opacity: number }
export type VectorPaint =
  | { type: 'none' }
  | { type: 'solid'; color: string; opacity: number }
  | { type: 'linear'; x1: number; y1: number; x2: number; y2: number; units: 'objectBoundingBox' | 'userSpaceOnUse'; transform: VectorMatrix; stops: VectorStop[] }
  | { type: 'radial'; cx: number; cy: number; r: number; fx: number; fy: number; units: 'objectBoundingBox' | 'userSpaceOnUse'; transform: VectorMatrix; stops: VectorStop[] };
export interface VectorStroke {
  paint: VectorPaint; width: number; lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'miter' | 'round' | 'bevel'; miterLimit: number; dash: number[]; dashOffset: number;
}
export interface VectorText {
  content: string; fontFamily: string; fontSize: number; fontWeight: number;
  letterSpacing: number; lineHeight: number; alignment: 'start' | 'middle' | 'end';
}
export interface VectorObject {
  id: string; name: string; type: 'path' | 'group' | 'text' | 'image';
  parentId: string | null; artboardId: string; transform: VectorMatrix;
  opacity: number; visible: boolean; locked: boolean; fill: VectorPaint; stroke: VectorStroke;
  geometry?: VectorPath; text?: VectorText; image?: { assetId: string; width: number; height: number };
  clipPathId?: string; maskId?: string;
}
export interface VectorArtboard {
  id: string; name: string; x: number; y: number; width: number; height: number;
  unit: 'px' | 'mm' | 'cm' | 'pt'; background: string | null;
}
export interface VectorDocument {
  id: string; name: string; version: 1; artboards: VectorArtboard[];
  objects: VectorObject[]; assets: string[]; metadata?: Record<string, unknown>;
}
export interface VectorBounds { x: number; y: number; width: number; height: number }
