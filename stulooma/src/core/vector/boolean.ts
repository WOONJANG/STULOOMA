import * as clipping from 'polygon-clipping';
import type { MultiPolygon, Pair, Ring } from 'polygon-clipping';
import type { VectorPath } from '../../types/vector';
import { createCompoundPath, flattenPath } from './geometry';

export type VectorBooleanOperation = 'union' | 'difference' | 'intersection' | 'xor' | 'divide';
const MAX_POINTS = 100000;
const MAX_FACES = 2048;
const union = (a: MultiPolygon, b: MultiPolygon): MultiPolygon => !a.length ? b : !b.length ? a : clipping.union(a, b);
const difference = (a: MultiPolygon, b: MultiPolygon): MultiPolygon => !a.length || !b.length ? a : clipping.difference(a, b);
const intersection = (a: MultiPolygon, b: MultiPolygon): MultiPolygon => !a.length || !b.length ? [] : clipping.intersection(a, b);

export function signedRingArea(points: { x: number; y: number }[]): number {
  let area = 0; const origin = points[0] ?? { x: 0, y: 0 };
  for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; area += (a.x - origin.x) * (b.y - origin.y) - (b.x - origin.x) * (a.y - origin.y); }
  return area / 2;
}

/** Polygon-clipping normalizes individual self-crossing rings with nonzero
 * winding, so accepting one as evenodd could silently change its filled area.
 * Reject ambiguous rings before mutation. X-sweep/AABB pruning plus a hard
 * comparison budget keeps malicious complexity from blocking the UI. */
function assertSimpleRing(points: { x: number; y: number }[], budget: GeometryBudget) {
  const segments = points.map((a, i) => {
    const b = points[(i + 1) % points.length];
    return { a, b, i, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) };
  }).sort((a, b) => a.minX - b.minX || a.minY - b.minY);
  const orient = (a: VectorPointLike, b: VectorPointLike, c: VectorPointLike) => {
    const x = (b.x - a.x) * (c.y - a.y), y = (b.y - a.y) * (c.x - a.x), value = x - y;
    const error = (Math.abs(x) + Math.abs(y)) * Number.EPSILON * 16;
    return Math.abs(value) <= error ? 0 : Math.sign(value);
  };
  let active: typeof segments = [];
  const unsupported = () => { throw new Error('자체 교차하거나 겹쳐 되돌아가는 경로의 도형 연산은 지원하지 않습니다. 원본 경로를 유지했습니다.'); };
  for (const current of segments) {
    active = active.filter(s => s.maxX >= current.minX);
    for (const previous of active) {
      if (++budget.comparisons > 2000000) throw new Error('경로의 자체 교차 검증이 너무 복잡합니다. 경로를 분리한 뒤 다시 시도하세요.');
      if (previous.maxY < current.minY || current.maxY < previous.minY) continue;
      const a = orient(previous.a, previous.b, current.a), b = orient(previous.a, previous.b, current.b), c = orient(current.a, current.b, previous.a), d = orient(current.a, current.b, previous.b);
      const adjacent = Math.abs(previous.i - current.i) === 1 || Math.abs(previous.i - current.i) === points.length - 1;
      if (adjacent) {
        if (!a && !b) {
          const overlapX = Math.min(previous.maxX, current.maxX) - Math.max(previous.minX, current.minX), overlapY = Math.min(previous.maxY, current.maxY) - Math.max(previous.minY, current.minY);
          if (overlapX > 0 || overlapY > 0) unsupported();
        }
      } else if (a * b <= 0 && c * d <= 0) unsupported();
    }
    active.push(current);
  }
}
type VectorPointLike = { x: number; y: number };
interface GeometryBudget { points: number; comparisons: number }

/** Curves are polygonized with a ≤.25 document-pixel control-hull error bound.
 * Every result is real closed editable geometry, including interior rings.
 * Nonzero contours are accumulated by integer winding level, not by merely
 * subtracting every nested contour (which incorrectly punches same-winding holes). */
export function pathToPolygons(path: VectorPath, tolerance = .25, budget: GeometryBudget = { points: 0, comparisons: 0 }): MultiPolygon {
  if (!Number.isFinite(tolerance) || tolerance <= 0 || tolerance > .25) throw new Error('도형 연산 허용 오차는 0보다 크고 0.25 px 이하여야 합니다.');
  const contours = flattenPath(path, tolerance);
  const rings: { ring: Ring; winding: number }[] = [];
  for (const contour of contours) {
    if (!contour.closed && contour.points.length > 1) throw new Error('도형 연산에는 닫힌 경로를 선택하세요.');
    const points = contour.points.filter((p, i, all) => !i || p.x !== all[i - 1].x || p.y !== all[i - 1].y);
    if (points.length > 1 && points[0].x === points.at(-1)!.x && points[0].y === points.at(-1)!.y) points.pop();
    if (points.length < 3) continue;
    budget.points += points.length;
    if (budget.points > MAX_POINTS) throw new Error('도형 연산의 앵커 수가 너무 많습니다.');
    assertSimpleRing(points, budget);
    const ring: Pair[] = points.map(p => [p.x, p.y]); ring.push([...ring[0]] as Pair);
    rings.push({ ring, winding: signedRingArea(points) < 0 ? -1 : 1 });
  }
  if (rings.length > 1024) throw new Error('도형 연산의 경로 수가 너무 많습니다.');
  if (path.fillRule === 'evenodd') {
    let result: MultiPolygon = [];
    for (const { ring } of rings) { const region = clipping.union([ring]); result = !result.length ? region : clipping.xor(result, region); }
    return result;
  }
  let levels = new Map<number, MultiPolygon>();
  for (const { ring, winding } of rings) {
    const region = clipping.union([ring]), next = new Map<number, MultiPolygon>();
    let occupied: MultiPolygon = [];
    const add = (level: number, value: MultiPolygon) => { if (level && value.length) next.set(level, union(next.get(level) ?? [], value)); };
    for (const [level, current] of levels) {
      occupied = union(occupied, current);
      add(level, difference(current, region)); add(level + winding, intersection(current, region));
    }
    add(winding, difference(region, occupied)); levels = next;
  }
  let result: MultiPolygon = [];
  for (const value of levels.values()) result = union(result, value);
  return result;
}

let nextAnchor = 0;
export function polygonsToPath(polygons: MultiPolygon): VectorPath {
  const count = polygons.reduce((n, polygon) => n + polygon.reduce((m, ring) => m + ring.length, 0), 0);
  if (count > MAX_POINTS) throw new Error('도형 연산 결과의 앵커 수가 너무 많습니다.');
  return {
    fillRule: 'evenodd',
    contours: polygons.flatMap(polygon => polygon.map(ring => {
      const points = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
      return { closed: true, anchors: points.map(([x, y]) => ({ id: `boolean-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : ++nextAnchor}`, x, y, kind: 'corner' as const })) };
    })).filter(c => c.anchors.length >= 3),
  };
}

export function booleanOperation(operation: VectorBooleanOperation, paths: VectorPath[], tolerance = .25): VectorPath[] {
  if (!['union', 'difference', 'intersection', 'xor', 'divide'].includes(operation)) throw new Error('지원하지 않는 도형 연산입니다.');
  if (!paths.length) return [];
  if (paths.length > 64 || (operation === 'divide' && paths.length > 16)) throw new Error('한 번에 연산할 수 있는 도형 수를 초과했습니다.');
  const budget: GeometryBudget = { points: 0, comparisons: 0 };
  const geometries = paths.map(path => pathToPolygons(path, tolerance, budget));
  const pointCount = geometries.reduce((total, geometry) => total + geometry.reduce((n, polygon) => n + polygon.reduce((m, ring) => m + ring.length, 0), 0), 0);
  if (pointCount > MAX_POINTS) throw new Error('도형 연산의 총 앵커 수가 너무 많습니다.');
  if (operation === 'divide') {
    let faces: MultiPolygon[] = [], occupied: MultiPolygon = [];
    for (const geometry of geometries) {
      const next: MultiPolygon[] = [];
      for (const face of faces) { const outside = difference(face, geometry), inside = intersection(face, geometry); if (outside.length) next.push(outside); if (inside.length) next.push(inside); }
      const novel = difference(geometry, occupied); if (novel.length) next.push(novel);
      faces = next; occupied = union(occupied, geometry);
      if (faces.length > MAX_FACES || faces.reduce((n, face) => n + face.length, 0) > MAX_FACES) throw new Error('도형 분할 결과가 너무 복잡합니다.');
    }
    return faces.flatMap(face => face.map(polygon => polygonsToPath([polygon])));
  }
  let result = geometries[0];
  for (const geometry of geometries.slice(1)) {
    if (operation === 'union') result = union(result, geometry);
    else if (operation === 'difference') result = difference(result, geometry);
    else if (operation === 'intersection') result = intersection(result, geometry);
    else result = !result.length ? geometry : !geometry.length ? result : clipping.xor(result, geometry);
  }
  return result.length ? [polygonsToPath(result)] : [];
}

/** Difference uses the first (back) path as subject and removes following paths. */
export function booleanPath(operation: VectorBooleanOperation, paths: VectorPath[], tolerance = .25): VectorPath {
  return createCompoundPath(booleanOperation(operation, paths, tolerance), 'evenodd');
}

/** Actual filled area, useful for verification and downstream geometry tools. */
export function getPathArea(path: VectorPath, tolerance = .25): number {
  return pathToPolygons(path, tolerance).reduce((total, polygon) => total + polygon.reduce((n, ring, i) => {
    const area = Math.abs(signedRingArea(ring.map(([x, y]) => ({ x, y })))); return n + (i ? -area : area);
  }, 0), 0);
}
