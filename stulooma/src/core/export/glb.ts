import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

/** Export binary glTF with object names, geometry, and userData extras intact. */
export async function exportGLB(group: THREE.Group): Promise<Uint8Array> {
  let meshCount = 0;
  group.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    meshCount++;
    const geometry = child.geometry as THREE.BufferGeometry;
    if (!geometry.getAttribute('position') || !geometry.getAttribute('normal') || !geometry.getAttribute('uv')) {
      throw new Error('GLB export: Every garment mesh needs positions, normals, and UV coordinates.');
    }
  });
  if (!meshCount) throw new Error('GLB export: There are no garment meshes to export.');
  try {
    const result = await new GLTFExporter().parseAsync(group, {
      binary: true,
      onlyVisible: false,
      trs: false,
      includeCustomExtensions: false,
    });
    if (!(result instanceof ArrayBuffer)) throw new Error('The exporter did not produce binary glTF.');
    return new Uint8Array(result);
  } catch {
    throw new Error('GLB export: The garment could not be exported. Check that its textures are fully loaded and try again.');
  }
}
