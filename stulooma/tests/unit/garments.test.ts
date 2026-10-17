import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildGarment, GARMENT_REGIONS } from '../../src/core/garments';
import { readFile } from 'node:fs/promises';
import { importGLB } from '../../src/core/import/glb';

describe.each(['tshirt', 'basketball'] as const)('%s authored garment geometry', kind => {
  it('has actual torso depth, separated open panels and documented regions', () => {
    const group = buildGarment(kind);
    const bounds = new THREE.Box3().setFromObject(group), size = bounds.getSize(new THREE.Vector3());
    expect(size.y).toBeGreaterThan(1.7);
    expect(size.y).toBeLessThan(2);
    expect(size.z).toBeGreaterThan(0.35);
    const meshes = group.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    expect(new Set(meshes.map(mesh => mesh.name)).size).toBe(meshes.length);
    expect(new Set(meshes.map(mesh => mesh.userData.regionId))).toEqual(new Set(GARMENT_REGIONS[kind].map(region => region.id)));
    const front = group.getObjectByName('FRONT') as THREE.Mesh;
    const p = front.geometry.getAttribute('position');
    expect(Math.max(...Array.from({ length: p.count }, (_, i) => p.getZ(i))) - Math.min(...Array.from({ length: p.count }, (_, i) => p.getZ(i)))).toBeGreaterThan(0.15);
    expect(group.getObjectByName('LEFT_SLEEVE') !== undefined).toBe(kind === 'tshirt');
    expect(group.getObjectByName('RIGHT_SLEEVE') !== undefined).toBe(kind === 'tshirt');
  });

  it('provides finite unit normals and complete local UV islands for every region', () => {
    const regionBounds = new Map<string, number[]>();
    buildGarment(kind).traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry;
      const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
      expect(normals.count).toBe(positions.count);
      expect(uv.count).toBe(positions.count);
      expect(geometry.index).not.toBeNull();
      let minU = 1, minV = 1, maxU = 0, maxV = 0;
      for (let i = 0; i < positions.count; i++) {
        expect(Number.isFinite(positions.getX(i) + positions.getY(i) + positions.getZ(i))).toBe(true);
        const length = Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i));
        expect(length, `${object.name} normal ${i}`).toBeGreaterThan(0.98);
        expect(length).toBeLessThan(1.02);
        minU = Math.min(minU, uv.getX(i)); minV = Math.min(minV, uv.getY(i));
        maxU = Math.max(maxU, uv.getX(i)); maxV = Math.max(maxV, uv.getY(i));
      }
      expect(minU).toBeGreaterThanOrEqual(0); expect(minV).toBeGreaterThanOrEqual(0);
      expect(maxU).toBeLessThanOrEqual(1); expect(maxV).toBeLessThanOrEqual(1);
      expect(maxU).toBeGreaterThan(minU); expect(maxV).toBeGreaterThan(minV);
      // Multiple meshes may continue one design region: the full panel must not
      // be stamped again onto its small shoulder continuation.
      if (object.name.endsWith('_SHOULDER')) expect(minV).toBeGreaterThan(0.9);
      const old = regionBounds.get(object.userData.regionId) ?? [1, 1, 0, 0];
      regionBounds.set(object.userData.regionId, [Math.min(old[0], minU), Math.min(old[1], minV), Math.max(old[2], maxU), Math.max(old[3], maxV)]);
    });
    for (const bounds of regionBounds.values()) expect(bounds).toEqual([0, 0, 1, 1]);
  });

  it('keeps front/back UVs readable from their corresponding camera view', () => {
    const group = buildGarment(kind);
    for (const [name, direction] of [['FRONT', 1], ['BACK', -1]] as const) {
      const geometry = (group.getObjectByName(name) as THREE.Mesh).geometry;
      const p = geometry.getAttribute('position'), uv = geometry.getAttribute('uv'), n = geometry.getAttribute('normal');
      const center = Math.floor(p.count / 2);
      expect(n.getZ(center) * direction).toBeGreaterThan(0.5);
      expect((p.getX(1) - p.getX(0)) * (uv.getX(1) - uv.getX(0)) * direction).toBeGreaterThan(0);
      expect(uv.getY(0)).toBe(0);
      expect(uv.getY(p.count - 1)).toBe(1);
    }
  });

  it('ships a self-contained GLB with editable original region metadata', async () => {
    const bytes = await readFile(new URL(`../../assets/models/${kind}.glb`, import.meta.url));
    const imported = await importGLB(bytes);
    expect(imported.meshes.length).toBe(kind === 'tshirt' ? 9 : 7);
    const regions = new Set<string>();
    imported.group.traverse(object => {
      if (object instanceof THREE.Mesh) regions.add(object.userData.regionId as string);
    });
    expect(regions).toEqual(new Set(GARMENT_REGIONS[kind].map(region => region.id)));
    expect(new THREE.Box3().setFromObject(imported.group).getSize(new THREE.Vector3()).z).toBeGreaterThan(0.35);
  });

  it('keeps the neck and lower hem physically open rather than closing a solid extrusion', () => {
    const group = buildGarment(kind);
    group.updateMatrixWorld(true);
    const neck = new THREE.Raycaster(new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, -1, 0));
    const hem = new THREE.Raycaster(new THREE.Vector3(0, -1.2, 0), new THREE.Vector3(0, 1, 0));
    expect(neck.intersectObject(group, true)).toHaveLength(0);
    expect(hem.intersectObject(group, true)).toHaveLength(0);
    const shoulder = (group.getObjectByName('RIGHT_SHOULDER') as THREE.Mesh).geometry.getAttribute('normal');
    expect(shoulder.getY(Math.floor(shoulder.count / 2))).toBeGreaterThan(0.5);
  });
});

it('rejects the supplied damaged and no-UV example assets', async () => {
  for (const name of ['damaged', 'no-uv']) {
    const bytes = await readFile(new URL(`../../samples/invalid/${name}.glb`, import.meta.url));
    await expect(importGLB(bytes)).rejects.toThrow(/GLB import/);
  }
});
