import type { VectorAnchor, VectorBounds, VectorContour, VectorMatrix, VectorPath, VectorPoint } from '../../types/vector';

/** SVG affine matrices act on column vectors. multiplyMatrices(a,b) applies b first. */
export const identityMatrix = (): VectorMatrix => [1, 0, 0, 1, 0, 0];
export function multiplyMatrices(a: VectorMatrix, b: VectorMatrix): VectorMatrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
export function invertMatrix(m: VectorMatrix): VectorMatrix {
  const d = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(d) || Math.abs(d) < 1e-14) throw new Error('역변환할 수 없는 벡터 변환입니다.');
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
}
export const applyMatrix = (m: VectorMatrix, p: VectorPoint): VectorPoint => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
export const translationMatrix = (x: number, y: number): VectorMatrix => [1, 0, 0, 1, x, y];
export const scaleMatrix = (x: number, y = x): VectorMatrix => [x, 0, 0, y, 0, 0];
export function rotationMatrix(degrees: number, cx = 0, cy = 0): VectorMatrix {
  const r = degrees * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}

const point = (x: number, y: number): VectorPoint => ({ x, y });
let localId = 0;
const newId = () => `anchor-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${++localId}`}`;
const anchor = (x: number, y: number): VectorAnchor => ({ id: newId(), x, y, kind: 'corner' });
const clone = <T>(value: T): T => structuredClone(value);
const lerp = (a: VectorPoint, b: VectorPoint, t: number): VectorPoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const samePoint = (a: VectorPoint, b: VectorPoint) => a.x === b.x && a.y === b.y;
const pathOf = (anchors: VectorAnchor[], closed = true): VectorPath => ({ contours: anchors.length ? [{ anchors, closed }] : [], fillRule: 'nonzero' });
function finite(...values: number[]) { if (values.some(v => !Number.isFinite(v) || Math.abs(v) > 1e9)) throw new Error('벡터 좌표는 유한한 ±10억 범위여야 합니다.'); }
function normalizedBox(x: number, y: number, w: number, h: number) { finite(x, y, w, h); return { x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h) }; }

export function transformPath(path: VectorPath, matrix: VectorMatrix): VectorPath {
  return { fillRule: path.fillRule, contours: path.contours.map(contour => ({ closed: contour.closed, anchors: contour.anchors.map(a => ({ ...a, ...applyMatrix(matrix, a), ...(a.in ? { in: applyMatrix(matrix, a.in) } : {}), ...(a.out ? { out: applyMatrix(matrix, a.out) } : {}) })) })) };
}

export function rectanglePath(x: number, y: number, width: number, height: number): VectorPath {
  const b = normalizedBox(x, y, width, height);
  return pathOf([anchor(b.x, b.y), anchor(b.x + b.w, b.y), anchor(b.x + b.w, b.y + b.h), anchor(b.x, b.y + b.h)]);
}
export function linePath(x1: number, y1: number, x2: number, y2: number): VectorPath { finite(x1, y1, x2, y2); return pathOf([anchor(x1, y1), anchor(x2, y2)], false); }

/** Arc cubics use the SVG endpoint-to-center algorithm. Segments are reduced until
 * their analytic maximum unit-circle radial error times max(rx,ry) is ≤.01 px.
 * The resulting editable cubics approximate an arc; quadratic conversion is exact. */
function arcCubics(start: VectorPoint, rx: number, ry: number, rotation: number, large: boolean, sweep: boolean, end: VectorPoint): { c1: VectorPoint; c2: VectorPoint; end: VectorPoint }[] {
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (samePoint(start, end) || !rx || !ry) return [];
  const phi = rotation * Math.PI / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (start.x - end.x) / 2, dy = (start.y - end.y) / 2;
  const xp = cp * dx + sp * dy, yp = -sp * dx + cp * dy;
  const radiiScale = Math.hypot(xp / rx, yp / ry);
  if (radiiScale > 1) { rx *= radiiScale; ry *= radiiScale; }
  finite(rx, ry);
  const ux = xp / rx, uy = yp / ry, denominator = ux * ux + uy * uy;
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (1 - denominator) / denominator));
  const cxp = factor * rx * uy, cyp = -factor * ry * ux;
  const cx = cp * cxp - sp * cyp + (start.x + end.x) / 2, cy = sp * cxp + cp * cyp + (start.y + end.y) / 2;
  finite(cx, cy);
  const u = point((xp - cxp) / rx, (yp - cyp) / ry), v = point((-xp - cxp) / rx, (-yp - cyp) / ry);
  const startAngle = Math.atan2(u.y, u.x);
  let delta = Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;
  let segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  while (unitArcError(Math.abs(delta) / segments) * Math.max(rx, ry) > .01) segments *= 2;
  if (segments > 4096) throw new Error('타원 호가 너무 복잡합니다.');
  const map = (p: VectorPoint): VectorPoint => point(cx + cp * rx * p.x - sp * ry * p.y, cy + sp * rx * p.x + cp * ry * p.y);
  const output: { c1: VectorPoint; c2: VectorPoint; end: VectorPoint }[] = [];
  for (let i = 0; i < segments; i++) {
    const a = startAngle + delta * i / segments, b = startAngle + delta * (i + 1) / segments, k = 4 / 3 * Math.tan((b - a) / 4);
    output.push({ c1: map(point(Math.cos(a) - k * Math.sin(a), Math.sin(a) + k * Math.cos(a))), c2: map(point(Math.cos(b) + k * Math.sin(b), Math.sin(b) - k * Math.cos(b))), end: i === segments - 1 ? { ...end } : map(point(Math.cos(b), Math.sin(b))) });
  }
  return output;
}
function unitArcError(angle: number): number {
  const k = 4 / 3 * Math.tan(angle / 4), t = (3 - Math.sqrt(3)) / 6;
  const p = cubicPoint(point(1, 0), point(1, k), point(Math.cos(angle) + k * Math.sin(angle), Math.sin(angle) - k * Math.cos(angle)), point(Math.cos(angle), Math.sin(angle)), t);
  return Math.abs(Math.hypot(p.x, p.y) - 1);
}
function appendArc(anchors: VectorAnchor[], rx: number, ry: number, rotation: number, large: boolean, sweep: boolean, end: VectorPoint) {
  const previous = anchors.at(-1)!;
  if (samePoint(previous, end)) return;
  if (!rx || !ry) { anchors.push(anchor(end.x, end.y)); return; }
  for (const segment of arcCubics(previous, rx, ry, rotation, large, sweep, end)) {
    finite(segment.c1.x, segment.c1.y, segment.c2.x, segment.c2.y, segment.end.x, segment.end.y);
    anchors.at(-1)!.out = segment.c1;
    anchors.push({ ...anchor(segment.end.x, segment.end.y), in: segment.c2, kind: 'smooth' });
  }
}
function mergeClosingAnchor(anchors: VectorAnchor[]) {
  if (anchors.length > 1 && samePoint(anchors[0], anchors.at(-1)!)) {
    const last = anchors.pop()!;
    if (last.in) anchors[0].in = last.in;
  }
}
export function ellipsePath(cx: number, cy: number, rx: number, ry: number): VectorPath {
  finite(cx, cy, rx, ry); rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) return pathOf([]);
  const a = [anchor(cx + rx, cy)];
  appendArc(a, rx, ry, 0, false, true, point(cx - rx, cy));
  appendArc(a, rx, ry, 0, false, true, point(cx + rx, cy));
  mergeClosingAnchor(a); a.forEach(p => { p.kind = 'smooth'; }); return pathOf(a);
}
export function roundedRectanglePath(x: number, y: number, width: number, height: number, rx: number, ry = rx): VectorPath {
  const b = normalizedBox(x, y, width, height); finite(rx, ry);
  rx = Math.min(Math.abs(rx), b.w / 2); ry = Math.min(Math.abs(ry), b.h / 2);
  if (!rx || !ry) return rectanglePath(b.x, b.y, b.w, b.h);
  const a = [anchor(b.x + rx, b.y), anchor(b.x + b.w - rx, b.y)];
  appendArc(a, rx, ry, 0, false, true, point(b.x + b.w, b.y + ry)); a.push(anchor(b.x + b.w, b.y + b.h - ry));
  appendArc(a, rx, ry, 0, false, true, point(b.x + b.w - rx, b.y + b.h)); a.push(anchor(b.x + rx, b.y + b.h));
  appendArc(a, rx, ry, 0, false, true, point(b.x, b.y + b.h - ry)); a.push(anchor(b.x, b.y + ry));
  appendArc(a, rx, ry, 0, false, true, point(b.x + rx, b.y)); mergeClosingAnchor(a); return pathOf(a);
}
export function polygonPath(x: number, y: number, width: number, height: number, sides = 6, rotation = -90): VectorPath {
  if (!Number.isInteger(sides) || sides < 3 || sides > 1024) throw new Error('다각형의 변 수는 3–1024여야 합니다.');
  const b = normalizedBox(x, y, width, height); finite(rotation);
  return pathOf(Array.from({ length: sides }, (_, i) => { const a = (rotation + 360 * i / sides) * Math.PI / 180; return anchor(b.x + b.w / 2 * (1 + Math.cos(a)), b.y + b.h / 2 * (1 + Math.sin(a))); }));
}
export function starPath(x: number, y: number, width: number, height: number, points = 5, innerRatio = .45, rotation = -90): VectorPath {
  if (!Number.isInteger(points) || points < 3 || points > 512 || !Number.isFinite(innerRatio) || innerRatio <= 0 || innerRatio >= 1) throw new Error('별 꼭짓점 또는 내부 반경이 유효하지 않습니다.');
  const b = normalizedBox(x, y, width, height); finite(rotation);
  return pathOf(Array.from({ length: points * 2 }, (_, i) => { const a = (rotation + 180 * i / points) * Math.PI / 180, r = i % 2 ? innerRatio : 1; return anchor(b.x + b.w / 2 * (1 + r * Math.cos(a)), b.y + b.h / 2 * (1 + r * Math.sin(a))); }));
}

export function cubicPoint(p0: VectorPoint, p1: VectorPoint, p2: VectorPoint, p3: VectorPoint, t: number): VectorPoint {
  const u = 1 - t;
  return point(u ** 3 * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * p3.x, u ** 3 * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * p3.y);
}
function extrema(a: number, b: number, c: number, d: number): number[] {
  const qa = -a + 3 * b - 3 * c + d, qb = 2 * (a - 2 * b + c), qc = b - a;
  if (Math.abs(qa) < 1e-14) return Math.abs(qb) < 1e-14 ? [] : [-qc / qb].filter(t => t > 0 && t < 1);
  const discriminant = qb * qb - 4 * qa * qc;
  if (discriminant < 0) return [];
  return [(-qb + Math.sqrt(discriminant)) / (2 * qa), (-qb - Math.sqrt(discriminant)) / (2 * qa)].filter(t => t > 0 && t < 1);
}
export function getPathBounds(path: VectorPath, matrix?: VectorMatrix): VectorBounds {
  const p = matrix ? transformPath(path, matrix) : path;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (v: VectorPoint) => { minX = Math.min(minX, v.x); minY = Math.min(minY, v.y); maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y); };
  for (const contour of p.contours) {
    for (const a of contour.anchors) include(a);
    const count = contour.closed ? contour.anchors.length : contour.anchors.length - 1;
    for (let i = 0; i < count; i++) {
      const a = contour.anchors[i], b = contour.anchors[(i + 1) % contour.anchors.length], c1 = a.out ?? a, c2 = b.in ?? b;
      if (!a.out && !b.in) continue;
      for (const t of [...extrema(a.x, c1.x, c2.x, b.x), ...extrema(a.y, c1.y, c2.y, b.y)]) include(cubicPoint(a, c1, c2, b, t));
    }
  }
  return minX === Infinity ? { x: 0, y: 0, width: 0, height: 0 } : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
export const pathBounds = getPathBounds;

// JavaScript's shortest round-trip representation preserves every stored double;
// fixed decimal rounding here would destructively quantize exported artwork.
const formatNumber = (n: number) => { if (!Number.isFinite(n)) throw new Error('유효하지 않은 벡터 좌표입니다.'); return Object.is(n, -0) ? '0' : String(n); };
export function geometryToPathData(path: VectorPath): string {
  const p = (v: VectorPoint) => `${formatNumber(v.x)} ${formatNumber(v.y)}`;
  return path.contours.filter(c => c.anchors.length).map(contour => {
    const a = contour.anchors; let output = `M${p(a[0])}`;
    const count = contour.closed ? a.length : a.length - 1;
    for (let i = 0; i < count; i++) {
      const from = a[i], to = a[(i + 1) % a.length];
      if (from.out || to.in) output += `C${p(from.out ?? from)} ${p(to.in ?? to)} ${p(to)}`;
      else if (i < a.length - 1) output += `L${p(to)}`;
    }
    return output + (contour.closed ? 'Z' : '');
  }).join(' ');
}
export const pathToSVGData = geometryToPathData;
export const pathToSvgD = geometryToPathData;

class PathScanner {
  pos = 0; commaAllowed = false;
  constructor(readonly input: string) {}
  skipSpace() { while (/\s/.test(this.input[this.pos] ?? '') && this.pos < this.input.length) this.pos++; }
  parameterPrefix() {
    this.skipSpace();
    if (this.input[this.pos] === ',') { if (!this.commaAllowed) throw new Error('잘못된 SVG 경로 구분자입니다.'); this.pos++; this.skipSpace(); }
  }
  number(): number {
    this.parameterPrefix();
    const match = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(this.input.slice(this.pos));
    if (!match) throw new Error(`SVG 경로 좌표가 없습니다 (${this.pos}).`);
    this.pos += match[0].length; this.commaAllowed = true;
    const n = Number(match[0]); finite(n); return n;
  }
  flag(): boolean {
    this.parameterPrefix(); const char = this.input[this.pos++];
    if (char !== '0' && char !== '1') throw new Error('SVG 호의 플래그는 0 또는 1이어야 합니다.');
    this.commaAllowed = true; return char === '1';
  }
}

/** Strict SVG path parser, maximum 2 MiB and 100k anchors. Rejects malformed
 * commands/numbers rather than silently repairing user artwork. */
export function parsePathData(data: string): VectorPath {
  if (typeof data !== 'string' || data.length > 2 * 1024 * 1024) throw new Error('SVG 경로 데이터가 너무 큽니다.');
  const scanner = new PathScanner(data), contours: VectorContour[] = [];
  let command = '', previousCommand = '', current = point(0, 0), subStart = point(0, 0), contour: VectorContour | undefined;
  let quadraticControl: VectorPoint | undefined, cubicControl: VectorPoint | undefined, anchorCount = 0;
  const last = () => { if (!contour?.anchors.length) throw new Error('SVG 경로는 M 명령으로 시작해야 합니다.'); return contour.anchors.at(-1)!; };
  const add = (p: VectorPoint, incoming?: VectorPoint, kind: VectorAnchor['kind'] = 'corner') => { finite(p.x, p.y); if (incoming) finite(incoming.x, incoming.y); contour!.anchors.push({ ...anchor(p.x, p.y), ...(incoming ? { in: incoming } : {}), kind }); current = p; if (++anchorCount > 100000) throw new Error('SVG 경로의 점이 너무 많습니다.'); };
  while (true) {
    scanner.skipSpace(); if (scanner.pos >= data.length) break;
    if (/[A-Za-z]/.test(data[scanner.pos])) {
      command = data[scanner.pos++]; scanner.commaAllowed = false;
      if (!'MmLlHhVvCcSsQqTtAaZz'.includes(command)) throw new Error(`지원하지 않는 SVG 경로 명령: ${command}`);
    } else if (!command) throw new Error('SVG 경로 명령이 없습니다.');
    const upper = command.toUpperCase(), relative = command !== upper;
    const readPoint = (): VectorPoint => { const x = scanner.number(), y = scanner.number(); return point(x + (relative ? current.x : 0), y + (relative ? current.y : 0)); };
    if (upper !== 'M' && !contour) throw new Error('SVG 경로는 M 명령으로 시작해야 합니다.');
    if (upper === 'M') {
      const p = readPoint(); contour = { anchors: [], closed: false }; contours.push(contour); add(p); subStart = { ...p }; command = relative ? 'l' : 'L';
    } else if (upper === 'Z') {
      contour!.closed = true; mergeClosingAnchor(contour!.anchors); current = { ...subStart }; command = '';
    } else {
      // Drawing after Z starts a new subpath at the current point (SVG 2).
      if (contour!.closed) { contour = { anchors: [anchor(current.x, current.y)], closed: false }; contours.push(contour); subStart = { ...current }; anchorCount++; }
      if (upper === 'L') add(readPoint());
      else if (upper === 'H') { const x = scanner.number(); add(point(x + (relative ? current.x : 0), current.y)); }
      else if (upper === 'V') { const y = scanner.number(); add(point(current.x, y + (relative ? current.y : 0))); }
      else if (upper === 'C') { const c1 = readPoint(), c2 = readPoint(), p = readPoint(); finite(c1.x, c1.y); last().out = c1; add(p, c2); cubicControl = c2; }
      else if (upper === 'S') { const c1 = previousCommand === 'C' || previousCommand === 'S' ? point(2 * current.x - cubicControl!.x, 2 * current.y - cubicControl!.y) : { ...current }, c2 = readPoint(), p = readPoint(); finite(c1.x, c1.y); last().out = c1; add(p, c2, 'smooth'); cubicControl = c2; }
      else if (upper === 'Q' || upper === 'T') {
        const q = upper === 'Q' ? readPoint() : previousCommand === 'Q' || previousCommand === 'T' ? point(2 * current.x - quadraticControl!.x, 2 * current.y - quadraticControl!.y) : { ...current }, p = readPoint();
        const c1 = lerp(current, q, 2 / 3); finite(c1.x, c1.y); last().out = c1; add(p, lerp(p, q, 2 / 3), upper === 'T' ? 'smooth' : 'corner'); quadraticControl = q;
      } else if (upper === 'A') {
        const rx = scanner.number(), ry = scanner.number(), rotation = scanner.number(), large = scanner.flag(), sweep = scanner.flag(), end = readPoint();
        const before = contour!.anchors.length; appendArc(contour!.anchors, rx, ry, rotation, large, sweep, end); anchorCount += contour!.anchors.length - before;
        if (anchorCount > 100000) throw new Error('SVG 경로의 점이 너무 많습니다.'); current = end;
      }
    }
    if (upper !== 'C' && upper !== 'S') cubicControl = undefined;
    if (upper !== 'Q' && upper !== 'T') quadraticControl = undefined;
    previousCommand = upper;
  }
  return { contours, fillRule: 'nonzero' };
}

/** Polygonization has a geometric error bound: each cubic's entire control hull
 * must lie within tolerance of the emitted chord. No zoom-dependent tolerance. */
export function flattenPath(path: VectorPath, tolerance = .25): { points: VectorPoint[]; closed: boolean }[] {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error('평탄화 허용 오차는 양수여야 합니다.');
  let emitted = 0;
  function distance(p: VectorPoint, a: VectorPoint, b: VectorPoint) {
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }
  function flatten(a: VectorPoint, b: VectorPoint, c: VectorPoint, d: VectorPoint, output: VectorPoint[], depth = 0) {
    if (Math.max(distance(b, a, d), distance(c, a, d)) <= tolerance) { output.push({ ...d }); if (++emitted > 1000000) throw new Error('평탄화한 경로가 너무 복잡합니다.'); return; }
    if (depth >= 30) throw new Error('곡선을 허용 오차 안에서 평탄화할 수 없습니다.');
    const ab = lerp(a, b, .5), bc = lerp(b, c, .5), cd = lerp(c, d, .5), abc = lerp(ab, bc, .5), bcd = lerp(bc, cd, .5), middle = lerp(abc, bcd, .5);
    flatten(a, ab, abc, middle, output, depth + 1); flatten(middle, bcd, cd, d, output, depth + 1);
  }
  return path.contours.map(contour => {
    const points: VectorPoint[] = contour.anchors.length ? [{ x: contour.anchors[0].x, y: contour.anchors[0].y }] : [], count = contour.closed ? contour.anchors.length : contour.anchors.length - 1;
    for (let i = 0; i < count; i++) { const a = contour.anchors[i], d = contour.anchors[(i + 1) % contour.anchors.length]; if (a.out || d.in) flatten(a, a.out ?? a, d.in ?? d, d, points); else if (!samePoint(points.at(-1)!, d)) points.push(point(d.x, d.y)); }
    if (contour.closed && points.length > 1 && samePoint(points[0], points.at(-1)!)) points.pop();
    return { points, closed: contour.closed };
  });
}

export function addAnchor(path: VectorPath, contourIndex: number, segmentIndex: number, t = .5): VectorPath {
  const result = clone(path), contour = result.contours[contourIndex];
  if (!contour || segmentIndex < 0 || !Number.isInteger(segmentIndex) || segmentIndex >= contour.anchors.length - (contour.closed ? 0 : 1) || !Number.isFinite(t) || t <= 0 || t >= 1) throw new Error('분할할 선분 또는 위치가 유효하지 않습니다.');
  const a = contour.anchors[segmentIndex], d = contour.anchors[(segmentIndex + 1) % contour.anchors.length];
  let inserted: VectorAnchor;
  if (!a.out && !d.in) { const p = lerp(a, d, t); inserted = anchor(p.x, p.y); }
  else {
    const b = a.out ?? a, c = d.in ?? d, ab = lerp(a, b, t), bc = lerp(b, c, t), cd = lerp(c, d, t), abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t), p = lerp(abc, bcd, t);
    a.out = ab; d.in = cd; inserted = { ...anchor(p.x, p.y), in: abc, out: bcd, kind: 'smooth' };
  }
  contour.anchors.splice(segmentIndex + 1, 0, inserted); return result;
}
export function removeAnchor(path: VectorPath, contourIndex: number, anchorIndex: number): VectorPath {
  const result = clone(path), contour = result.contours[contourIndex];
  if (!contour || !Number.isInteger(anchorIndex) || anchorIndex < 0 || anchorIndex >= contour.anchors.length) throw new Error('삭제할 앵커가 없습니다.');
  contour.anchors.splice(anchorIndex, 1);
  if (!contour.anchors.length) result.contours.splice(contourIndex, 1);
  else if (contour.anchors.length < 2) contour.closed = false;
  return result;
}
export function reversePath(path: VectorPath): VectorPath { return { fillRule: path.fillRule, contours: path.contours.map(c => ({ closed: c.closed, anchors: [...c.anchors].reverse().map(a => { const b: VectorAnchor = { id: a.id, x: a.x, y: a.y, kind: a.kind }; if (a.out) b.in = { ...a.out }; if (a.in) b.out = { ...a.in }; return b; }) })) }; }
export function setPathClosed(path: VectorPath, closed: boolean, contourIndex?: number): VectorPath {
  const result = clone(path);
  if (contourIndex !== undefined && !result.contours[contourIndex]) throw new Error('경로가 없습니다.');
  result.contours.forEach((c, i) => { if (contourIndex === undefined || i === contourIndex) c.closed = closed && c.anchors.length > 1; }); return result;
}
/** Splitting a closed contour opens it at the selected anchor. An open contour
 * produces two paths, retaining exact cubic handles and distinct endpoint IDs. */
export function splitPath(path: VectorPath, contourIndex: number, anchorIndex: number): VectorPath[] {
  const contour = clone(path.contours[contourIndex]);
  if (!contour || !Number.isInteger(anchorIndex) || anchorIndex < 0 || anchorIndex >= contour.anchors.length) throw new Error('분리할 앵커가 없습니다.');
  const output: VectorPath[] = path.contours.filter((_, i) => i !== contourIndex).map(c => ({ contours: [clone(c)], fillRule: path.fillRule }));
  if (contour.closed) {
    const a = [...contour.anchors.slice(anchorIndex), ...contour.anchors.slice(0, anchorIndex + 1)]; a[a.length - 1] = { ...a.at(-1)!, id: newId() };
    delete a[0].in; delete a.at(-1)!.out; output.push({ contours: [{ anchors: a, closed: false }], fillRule: path.fillRule });
  } else {
    if (!anchorIndex || anchorIndex === contour.anchors.length - 1) throw new Error('열린 경로의 내부 앵커를 선택하세요.');
    const a = contour.anchors.slice(0, anchorIndex + 1), b = clone(contour.anchors.slice(anchorIndex)); b[0].id = newId(); delete a.at(-1)!.out; delete b[0].in;
    output.push({ contours: [{ anchors: a, closed: false }], fillRule: path.fillRule }, { contours: [{ anchors: b, closed: false }], fillRule: path.fillRule });
  }
  return output;
}
export function joinPaths(first: VectorPath, second: VectorPath): VectorPath {
  if (first.contours.length !== 1 || second.contours.length !== 1 || first.contours[0].closed || second.contours[0].closed || !first.contours[0].anchors.length || !second.contours[0].anchors.length) throw new Error('연결하려면 두 개의 열린 단일 경로를 선택하세요.');
  const a = clone(first.contours[0].anchors), b = clone(second.contours[0].anchors);
  // Join closest endpoints; reverse handles along with direction.
  const distance = (p: VectorPoint, q: VectorPoint) => Math.hypot(p.x - q.x, p.y - q.y);
  const choices = [[false, false], [true, false], [false, true], [true, true]] as const;
  let best = choices[0] as readonly [boolean, boolean], bestDistance = Infinity;
  for (const choice of choices) { const d = distance(choice[0] ? a[0] : a.at(-1)!, choice[1] ? b.at(-1)! : b[0]); if (d < bestDistance) { bestDistance = d; best = choice; } }
  const aa = best[0] ? reversePath(pathOf(a, false)).contours[0].anchors : a, bb = best[1] ? reversePath(pathOf(b, false)).contours[0].anchors : b;
  if (samePoint(aa.at(-1)!, bb[0])) { if (bb[0].out) aa.at(-1)!.out = bb[0].out; bb.shift(); }
  else { delete aa.at(-1)!.out; delete bb[0].in; }
  const ids = new Set(aa.map(p => p.id)); bb.forEach(p => { if (ids.has(p.id)) p.id = newId(); ids.add(p.id); });
  return { contours: [{ anchors: [...aa, ...bb], closed: false }], fillRule: first.fillRule };
}
export function createCompoundPath(paths: VectorPath[], fillRule: VectorPath['fillRule'] = 'evenodd'): VectorPath {
  return { contours: paths.flatMap(path => path.contours.map(contour => ({ ...clone(contour), anchors: contour.anchors.map(a => ({ ...clone(a), id: newId() })) }))), fillRule };
}
export function releaseCompoundPath(path: VectorPath): VectorPath[] { return path.contours.map(contour => ({ contours: [clone(contour)], fillRule: path.fillRule })); }
