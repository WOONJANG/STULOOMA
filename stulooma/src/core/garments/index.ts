import * as THREE from 'three';
import type { RegionDefinition } from '../../types/project';

export type BuiltInGarment = 'tshirt' | 'basketball';

export const GARMENT_REGIONS: Record<BuiltInGarment, RegionDefinition[]> = {
  tshirt: [
    { id: 'FRONT', label: '앞판' }, { id: 'BACK', label: '뒤판' },
    { id: 'LEFT_SLEEVE', label: '왼쪽 소매' }, { id: 'RIGHT_SLEEVE', label: '오른쪽 소매' },
    { id: 'COLLAR', label: '목둘레' }, { id: 'LEFT_SIDE', label: '왼쪽 옆판' },
    { id: 'RIGHT_SIDE', label: '오른쪽 옆판' },
  ],
  basketball: [
    { id: 'FRONT', label: '앞판' }, { id: 'BACK', label: '뒤판' },
    { id: 'LEFT_SIDE', label: '왼쪽 옆판' }, { id: 'RIGHT_SIDE', label: '오른쪽 옆판' },
    { id: 'COLLAR', label: '목둘레' },
  ],
};

type Point = [number, number, number];
const HEM = -0.9;
const TOP = 0.87;
const UNDERARM = 0.27;
const TORSO_ANGLE = 1.13;
const DEPTH = 0.205;
const NECK = 0.225;
const smoothstep = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function width(v: number, kind: BuiltInGarment) {
  if (kind === 'basketball') return 0.48 + 0.04 * Math.sin(v * Math.PI) - 0.09 * smoothstep(0.64, 1, v);
  return 0.48 + 0.05 * Math.sin(v * Math.PI / 2);
}

function topBoundary(t: number, front: boolean, kind: BuiltInGarment): Point {
  const topWidth = width(1, kind);
  const x = t * topWidth;
  const absX = Math.abs(x);
  if (absX <= NECK) {
    const arc = Math.sqrt(Math.max(0, 1 - (x / NECK) ** 2));
    return [x, TOP - (front ? 0.205 : 0.055) * arc, (front ? 1 : -1) * 0.19 * arc];
  }
  const shoulder = (absX - NECK) / (topWidth - NECK);
  return [x, TOP - (kind === 'tshirt' ? 0.12 : 0.045) * shoulder,
    (front ? 1 : -1) * DEPTH * Math.cos(TORSO_ANGLE) * Math.sin(shoulder * Math.PI / 2)];
}

function panelPoint(t: number, v: number, front: boolean, kind: BuiltInGarment): Point {
  const [, topY, topZ] = topBoundary(t, front, kind);
  const y = THREE.MathUtils.lerp(HEM, topY, v);
  const x = t * width(v, kind);
  const theta = Math.asin(t * Math.sin(TORSO_ANGLE));
  const depth = DEPTH * (0.97 + 0.03 * Math.cos(v * Math.PI));
  const z = THREE.MathUtils.lerp((front ? 1 : -1) * depth * Math.cos(theta), topZ, v ** 10);
  return [x, y, z];
}

function edgeAtY(y: number, front: boolean, kind: BuiltInGarment): Point {
  const topY = topBoundary(1, front, kind)[1];
  return panelPoint(1, (y - HEM) / (topY - HEM), front, kind);
}

function surface(cols: number, rows: number, at: (u: number, v: number) => Point, reverse = false, mirrorUV = false) {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const u = col / cols, v = row / rows;
      positions.push(...at(u, v));
      uvs.push(mirrorUV ? 1 - u : u, v);
      if (row < rows && col < cols) {
        const a = row * (cols + 1) + col, b = a + 1, c = a + cols + 1, d = c + 1;
        if (reverse) indices.push(a, c, b, b, c, d);
        else indices.push(a, b, c, b, d, c);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function cloth(geometry: THREE.BufferGeometry, name: string, regionId: string) {
  const material = new THREE.MeshStandardMaterial({ color: 0xf2f1ee, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.userData = { regionId, meshId: name, source: 'STULOOMA original parametric garment' };
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function shoulder(kind: BuiltInGarment, sign: number) {
  const w = width(1, kind);
  const geometry = surface(28, 10, (u, v) => {
    const x = THREE.MathUtils.lerp(NECK, w, u);
    const front = topBoundary(x / w, true, kind), back = topBoundary(x / w, false, kind);
    return [sign * x, front[1] + 0.012 * Math.sin(v * Math.PI) * Math.sin(u * Math.PI), THREE.MathUtils.lerp(back[2], front[2], v)];
  }, sign > 0);
  // This continuation of the back panel samples only its shoulder band. Mapping
  // the complete panel here would duplicate the back logo on each shoulder.
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, 0.5 - position.getX(i) / (w * 2), 0.98 - 0.025 * Math.sin(uv.getY(i) * Math.PI));
  }
  return geometry;
}

function sidePanel(kind: BuiltInGarment, sign: number) {
  return surface(14, 28, (u, v) => {
    const y = THREE.MathUtils.lerp(HEM, UNDERARM, v);
    const edge = edgeAtY(y, true, kind);
    const angle = THREE.MathUtils.lerp(TORSO_ANGLE, Math.PI - TORSO_ANGLE, u);
    const x = edge[0] * Math.sin(angle) / Math.sin(TORSO_ANGLE);
    const z = edge[2] * Math.cos(angle) / Math.cos(TORSO_ANGLE);
    return [sign * x, y, z];
  }, sign < 0);
}

/** Sleeve attachment follows the curved torso edge; the cuff remains physically open. */
function sleeve(sign: number) {
  const topY = topBoundary(1, true, 'tshirt')[1];
  const midY = (topY + UNDERARM) / 2;
  return surface(64, 18, (u, v) => {
    const perimeter = u * 4;
    let y: number, z: number;
    if (perimeter <= 1) {
      y = THREE.MathUtils.lerp(UNDERARM, topY, perimeter);
      z = edgeAtY(y, true, 'tshirt')[2];
    } else if (perimeter <= 2) {
      y = topY;
      z = THREE.MathUtils.lerp(edgeAtY(y, true, 'tshirt')[2], edgeAtY(y, false, 'tshirt')[2], perimeter - 1);
    } else if (perimeter <= 3) {
      y = THREE.MathUtils.lerp(topY, UNDERARM, perimeter - 2);
      z = edgeAtY(y, false, 'tshirt')[2];
    } else {
      y = UNDERARM;
      z = THREE.MathUtils.lerp(edgeAtY(y, false, 'tshirt')[2], edgeAtY(y, true, 'tshirt')[2], perimeter - 3);
    }
    let innerX = edgeAtY(y, true, 'tshirt')[0];
    if (perimeter >= 3) {
      // Match the curved side panel across the underarm, not a chord across it.
      const edgeZ = edgeAtY(UNDERARM, true, 'tshirt')[2];
      const cosine = z / edgeZ * Math.cos(TORSO_ANGLE);
      innerX = innerX * Math.sqrt(Math.max(0, 1 - cosine * cosine)) / Math.sin(TORSO_ANGLE);
    }
    // Gradually round the arm section, avoiding a flat silhouette or rigid extruded polygon.
    const angle = u * Math.PI * 2 - Math.PI / 4;
    const outerY = midY - 0.16 + Math.sin(angle) * 0.175;
    const outerZ = Math.cos(angle) * 0.155;
    const round = smoothstep(0, 1, v);
    return [sign * THREE.MathUtils.lerp(innerX, 0.94, v),
      THREE.MathUtils.lerp(y, outerY, round), THREE.MathUtils.lerp(z, outerZ, round)];
  }, sign > 0);
}

function collar() {
  return surface(80, 4, (u, v) => {
    const angle = u * Math.PI * 2;
    const forward = Math.cos(angle);
    const y = TOP - (forward >= 0 ? 0.205 : -0.055) * forward;
    const radius = THREE.MathUtils.lerp(0.98, 1.085, v);
    return [NECK * Math.sin(angle) * radius, y + 0.008 - 0.018 * v, 0.19 * forward * radius];
  }, true);
}

/** Average coincident seam normals while preserving each region's independent UV island. */
function smoothSeams(group: THREE.Group) {
  const buckets = new Map<string, { attribute: THREE.BufferAttribute; index: number }[]>();
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute('position');
    const normal = object.geometry.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      const key = [position.getX(i), position.getY(i), position.getZ(i)].map(n => Math.round(n * 100000)).join(',');
      const entries = buckets.get(key) ?? [];
      entries.push({ attribute: normal, index: i });
      buckets.set(key, entries);
    }
  });
  for (const entries of buckets.values()) {
    if (entries.length < 2) continue;
    const sum = new THREE.Vector3();
    for (const { attribute, index } of entries) sum.add(new THREE.Vector3().fromBufferAttribute(attribute, index));
    if (sum.lengthSq() < 1e-10) continue;
    sum.normalize();
    for (const { attribute, index } of entries) attribute.setXYZ(index, sum.x, sum.y, sum.z);
  }
}

/** Original source geometry: open neck/hem/cuffs, curved torso, separate UV regions. */
export function buildGarment(kind: BuiltInGarment): THREE.Group {
  const group = new THREE.Group();
  group.name = kind === 'tshirt' ? 'STULOOMA_TSHIRT' : 'STULOOMA_BASKETBALL';
  group.userData = { garmentKind: kind, license: 'STULOOMA original geometry — project license' };
  group.add(cloth(surface(72, 52, (u, v) => panelPoint(u * 2 - 1, v, true, kind)), 'FRONT', 'FRONT'));
  group.add(cloth(surface(72, 52, (u, v) => panelPoint(u * 2 - 1, v, false, kind), true, true), 'BACK', 'BACK'));
  for (const sign of [-1, 1]) {
    const side = sign < 0 ? 'LEFT' : 'RIGHT';
    group.add(cloth(sidePanel(kind, sign), `${side}_SIDE`, `${side}_SIDE`));
    group.add(cloth(shoulder(kind, sign), `${side}_SHOULDER`, 'BACK'));
    if (kind === 'tshirt') group.add(cloth(sleeve(sign), `${side}_SLEEVE`, `${side}_SLEEVE`));
  }
  group.add(cloth(collar(), 'COLLAR', 'COLLAR'));
  smoothSeams(group);
  return group;
}
