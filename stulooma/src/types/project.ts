import type { VectorDocument } from './vector';

export type GarmentKind = 'tshirt' | 'basketball' | 'custom';
export type Vec3 = [number, number, number];
export interface AssetRecord { id: string; name: string; mime: 'image/png' | 'model/gltf-binary'; data: string }
export interface ArtworkLayer {
  id: string; name: string; type: 'image' | 'text' | 'vector'; regionId: string; assetId?: string;
  vectorDocumentId?: string; vectorArtboardId?: string;
  text?: string; color?: string; fontSize?: number;
  x: number; y: number; width: number; height: number; rotation: number;
  opacity: number; visible: boolean; locked: boolean;
}
export interface RegionDesign { color: string; roughness: number; metalness: number }
export interface GarmentSelection {
  kind: GarmentKind; name: string; assetId?: string;
  regionMeshes?: Record<string, string[]>;
}
export interface ProjectDocument {
  format: 'STULOOMA'; version: 1 | 2; id: string; name: string; createdAt: string; updatedAt: string;
  garment: GarmentSelection; activeRegion: string; regions: Record<string, RegionDesign>;
  layers: ArtworkLayer[]; assets: Record<string, AssetRecord>;
  vectorDocuments?: Record<string, VectorDocument>;
  camera: { position: Vec3; target: Vec3 };
  settings: { textureSize: 1024 | 2048; background: string; transparent: boolean; mode: 'simple' | 'expert' };
  metadata?: Record<string, unknown>;
}
export interface RegionDefinition { id: string; label: string }
