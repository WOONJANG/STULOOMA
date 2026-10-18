import { describe, expect, it } from 'vitest';
import type { VectorPath, VectorPoint } from '../../src/types/vector';
import { addAnchor, applyMatrix, createCompoundPath, cubicPoint, ellipsePath, flattenPath, geometryToPathData, getPathBounds, identityMatrix, invertMatrix, joinPaths, linePath, multiplyMatrices, parsePathData, polygonPath, rectanglePath, releaseCompoundPath, removeAnchor, reversePath, rotationMatrix, roundedRectanglePath, scaleMatrix, setPathClosed, splitPath, starPath, transformPath, translationMatrix } from '../../src/core/vector/geometry';
import { booleanOperation, booleanPath, getPathArea } from '../../src/core/vector/boolean';

const nearPoint = (a: VectorPoint, b: VectorPoint, precision = 8) => { expect(a.x).toBeCloseTo(b.x, precision); expect(a.y).toBeCloseTo(b.y, precision); };
const curve = () => parsePathData('M0 0 C0 100 100 100 100 0');
const area = (path: VectorPath) => getPathArea(path, .01);

describe('editable vector geometry', () => {
  it('uses SVG affine transform order and exactly inverts a rotated, scaled translation', () => {
    const m = multiplyMatrices(translationMatrix(30, -12), multiplyMatrices(rotationMatrix(37), scaleMatrix(2, .5)));
    const p = { x: 12.75, y: -8.5 };
    nearPoint(applyMatrix(invertMatrix(m), applyMatrix(m, p)), p);
    nearPoint(applyMatrix(multiplyMatrices(translationMatrix(10, 20), scaleMatrix(2)), { x: 1, y: 2 }), { x: 12, y: 24 });
    expect(multiplyMatrices(m, identityMatrix())).toEqual(m);
    expect(() => invertMatrix(scaleMatrix(0, 1))).toThrow();
  });

  it('finds true cubic extrema and transforms handles before bounding', () => {
    expect(getPathBounds(curve())).toEqual({ x: 0, y: 0, width: 100, height: 75 });
    const b = getPathBounds(curve(), multiplyMatrices(translationMatrix(10, 20), scaleMatrix(2, 3)));
    expect(b).toEqual({ x: 10, y: 20, width: 200, height: 225 });
    expect(getPathBounds({ contours: [], fillRule: 'nonzero' })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('builds editable primitive paths with real curved ellipses and rounded corners', () => {
    expect(rectanglePath(100, 80, -100, -80).contours[0].anchors.map(p => [p.x, p.y])).toEqual([[0, 0], [100, 0], [100, 80], [0, 80]]);
    expect(linePath(1, 2, 3, 4).contours[0].closed).toBe(false);
    const ellipse = ellipsePath(100, 80, 100, 50);
    expect(ellipse.contours[0].anchors.every(a => a.in && a.out)).toBe(true);
    expect(area(ellipse)).toBeCloseTo(Math.PI * 100 * 50, -1);
    const rounded = roundedRectanglePath(0, 0, 100, 100, 20);
    expect(area(rounded)).toBeCloseTo(10000 - 1600 + Math.PI * 400, -1);
    expect(polygonPath(0, 0, 100, 100, 7).contours[0].anchors).toHaveLength(7);
    expect(starPath(0, 0, 100, 100, 6).contours[0].anchors).toHaveLength(12);
    expect(() => polygonPath(0, 0, 10, 10, 2)).toThrow();
    expect(() => starPath(0, 0, 10, 10, 5, 1)).toThrow();
  });

  it('parses absolute/relative SVG line, horizontal, vertical and implicit moveto commands', () => {
    const p = parsePathData('m10 20 30 0 h10 v20 l-40 0 z M100,100 L110 110');
    expect(p.contours).toHaveLength(2);
    expect(p.contours[0].anchors.map(a => [a.x, a.y])).toEqual([[10, 20], [40, 20], [50, 20], [50, 40], [10, 40]]);
    expect(p.contours[0].closed).toBe(true); expect(p.contours[1].closed).toBe(false);
    expect(parsePathData('M1e1-2e1L.5.25').contours[0].anchors.map(a => [a.x, a.y])).toEqual([[10, -20], [.5, .25]]);
  });

  it('converts quadratic and reflected Q/T/S commands to exact editable cubic handles', () => {
    const p = parsePathData('M0 0 q30 60 60 0 t60 0 c10 20 20 20 30 0 s20-20 30 0');
    const a = p.contours[0].anchors;
    nearPoint(a[0].out!, { x: 20, y: 40 }); nearPoint(a[1].in!, { x: 40, y: 40 });
    nearPoint(a[1].out!, { x: 80, y: -40 }); nearPoint(a[2].in!, { x: 100, y: -40 });
    nearPoint(a[3].out!, { x: 160, y: -20 }); nearPoint(a[4], { x: 180, y: 0 });
    const noReflection = parsePathData('M0 0 L20 20 S40 40 60 20').contours[0].anchors;
    nearPoint(noReflection[1].out!, { x: 20, y: 20 });
  });

  it('parses compact arc flags, relative rotated elliptical arcs, degenerate arcs and large arcs', () => {
    const p = parsePathData('M100 0A100 100 0 01100 200A100 100 0 01100 0z');
    expect(area(p)).toBeCloseTo(Math.PI * 10000, -1);
    const rotated = parsePathData('M0 0 a60 30 45 1 0 100 40');
    expect(rotated.contours[0].anchors.length).toBeGreaterThan(2);
    nearPoint(rotated.contours[0].anchors.at(-1)!, { x: 100, y: 40 });
    expect(parsePathData('M0 0A0 10 0 0 1 20 30').contours[0].anchors).toHaveLength(2);
    expect(parsePathData('M0 0A10 10 0 1 1 0 0').contours[0].anchors).toHaveLength(1);
  });

  it('serializes multiple contours and closing cubic handles without losing geometry', () => {
    const p = createCompoundPath([ellipsePath(0, 0, 60, 50), reversePath(ellipsePath(0, 0, 20, 10)), curve()]);
    const loaded = parsePathData(geometryToPathData(p));
    expect(loaded.contours.map(c => c.closed)).toEqual([true, true, false]);
    expect(geometryToPathData(loaded)).toBe(geometryToPathData(p));
    expect(getPathBounds(loaded)).toEqual(getPathBounds(p));
    const precise = parsePathData('M10000000.0000001 0.30000000000000004C0.12345678901234567 1.2345678901234567 5.555555555555555 6.666666666666667 9.876543210987655 2.2222222222222223');
    const preciseAgain = parsePathData(geometryToPathData(precise));
    expect(preciseAgain.contours[0].anchors.map(({ id, ...a }) => a)).toEqual(precise.contours[0].anchors.map(({ id, ...a }) => a));
  });

  it('rejects malformed, incomplete, unsupported and unbounded SVG data', () => {
    for (const d of ['L0 0', 'M', 'M0', 'M0 0L', 'M0 0K10 10', 'M0,,0', 'M,0 0', 'M0 0,', 'M0 0A10 10 0 2 0 10 10', 'MNaN 0', 'M1e500 0', 'M1000000001 0', 'M0 0C10 10 20 20', 'M0 0z10 20']) expect(() => parsePathData(d), d).toThrow();
    expect(parsePathData(' \n ')).toEqual({ contours: [], fillRule: 'nonzero' });
  });

  it('adds a cubic anchor with exact de Casteljau subdivision at any parameter', () => {
    const original = curve(), p = original.contours[0].anchors, t = .37, divided = addAnchor(original, 0, 0, t), a = divided.contours[0].anchors;
    expect(a).toHaveLength(3); expect(original.contours[0].anchors).toHaveLength(2);
    for (let i = 0; i <= 100; i++) {
      const u = i / 100, expected = cubicPoint(p[0], p[0].out!, p[1].in!, p[1], u);
      const actual = u <= t ? cubicPoint(a[0], a[0].out!, a[1].in!, a[1], u / t) : cubicPoint(a[1], a[1].out!, a[2].in!, a[2], (u - t) / (1 - t));
      nearPoint(actual, expected);
    }
    expect(removeAnchor(divided, 0, 1).contours[0].anchors).toHaveLength(2);
    expect(() => addAnchor(original, 0, 1)).toThrow();
  });

  it('adds anchors on the closing segment and reverses exact curve geometry', () => {
    const ellipse = ellipsePath(0, 0, 100, 60), n = ellipse.contours[0].anchors.length;
    const edited = addAnchor(ellipse, 0, n - 1);
    expect(edited.contours[0].anchors).toHaveLength(n + 1);
    expect(area(edited)).toBeCloseTo(area(ellipse), 7);
    expect(reversePath(reversePath(ellipse))).toEqual(ellipse);
    expect(area(reversePath(ellipse))).toBeCloseTo(area(ellipse), 7);
  });

  it('opens, closes, splits and joins paths while retaining cubic geometry', () => {
    const p = addAnchor(curve(), 0, 0), parts = splitPath(p, 0, 1), joined = joinPaths(parts[0], parts[1]);
    expect(parts).toHaveLength(2); expect(parts[0].contours[0].anchors.at(-1)!.id).not.toBe(parts[1].contours[0].anchors[0].id);
    expect(geometryToPathData(joined)).toBe(geometryToPathData(p));
    const closed = setPathClosed(p, true); expect(closed.contours[0].closed).toBe(true); expect(p.contours[0].closed).toBe(false);
    const opened = splitPath(rectanglePath(0, 0, 100, 100), 0, 2);
    expect(opened).toHaveLength(1); expect(opened[0].contours[0].closed).toBe(false); expect(opened[0].contours[0].anchors).toHaveLength(5);
    expect(() => joinPaths(closed, parts[0])).toThrow();
  });

  it('bounds flattening error independently of viewport zoom, including loops', () => {
    const source = parsePathData('M0 0C1000 800 -900 600 0 0'), flat = flattenPath(source, .25)[0].points, a = source.contours[0].anchors;
    const distanceToSegment = (p: VectorPoint, a: VectorPoint, b: VectorPoint) => { const dx = b.x - a.x, dy = b.y - a.y, t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); };
    for (let i = 0; i <= 200; i++) {
      const p = cubicPoint(a[0], a[0].out!, a[1].in!, a[1], i / 200);
      expect(Math.min(...flat.slice(1).map((b, j) => distanceToSegment(p, flat[j], b)))).toBeLessThanOrEqual(.25);
    }
    expect(() => flattenPath(source, 0)).toThrow();
  });
});

describe('real Boolean boundaries and compound holes', () => {
  const left = () => rectanglePath(0, 0, 100, 100), right = () => rectanglePath(50, 0, 100, 100);

  it('calculates union, difference, intersection and xor areas with editable boundaries', () => {
    const expected = { union: 15000, difference: 5000, intersection: 5000, xor: 10000 } as const;
    for (const [op, expectedArea] of Object.entries(expected)) {
      const result = booleanPath(op as keyof typeof expected, [left(), right()]);
      expect(area(result)).toBeCloseTo(expectedArea, 8);
      expect(result.contours.every(c => c.closed && c.anchors.every(a => a.kind === 'corner' && !a.in && !a.out))).toBe(true);
    }
  });

  it('divides overlapping shapes into disjoint faces instead of layered visual overlap', () => {
    const faces = booleanOperation('divide', [left(), right()]);
    expect(faces).toHaveLength(3); expect(faces.map(area).sort((a, b) => a - b)).toEqual([5000, 5000, 5000]);
    for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) expect(area(booleanPath('intersection', [faces[i], faces[j]]))).toBe(0);
  });

  it('retains contained holes and disjoint islands and handles coincident or touching edges', () => {
    const hole = rectanglePath(20, 20, 60, 60), donut = booleanPath('difference', [left(), hole]);
    expect(donut.contours).toHaveLength(2); expect(donut.fillRule).toBe('evenodd'); expect(area(donut)).toBe(6400);
    const separate = booleanPath('union', [left(), rectanglePath(200, 0, 100, 100)]);
    expect(separate.contours).toHaveLength(2); expect(area(separate)).toBe(20000);
    expect(booleanOperation('intersection', [left(), rectanglePath(200, 0, 100, 100)])).toEqual([]);
    expect(area(booleanPath('xor', [left(), left()]))).toBe(0);
    const touching = booleanPath('union', [left(), rectanglePath(100, 0, 100, 100)]);
    expect(touching.contours).toHaveLength(1); expect(area(touching)).toBe(20000);
    expect(booleanOperation('divide', [left(), hole]).map(area).sort((a, b) => a - b)).toEqual([3600, 6400]);
  });

  it('subtracts real curved ellipse boundaries and keeps the empty interior', () => {
    const outer = ellipsePath(100, 100, 100, 100), inner = ellipsePath(100, 100, 50, 50), ring = booleanPath('difference', [outer, inner], .01);
    expect(ring.contours).toHaveLength(2); expect(area(ring)).toBeCloseTo(Math.PI * 7500, -1);
    expect(area(booleanPath('intersection', [ring, inner], .01))).toBeLessThan(.00001);
    expect(addAnchor(ring, 0, 0).contours[0].anchors).toHaveLength(ring.contours[0].anchors.length + 1);
  });

  it('implements evenodd and nonzero winding rules rather than subtracting all nested contours', () => {
    const outer = left(), middle = rectanglePath(10, 10, 80, 80), inner = rectanglePath(20, 20, 60, 60);
    const evenodd = createCompoundPath([outer, middle, inner], 'evenodd'); expect(area(evenodd)).toBe(7200);
    const nonzero = createCompoundPath([outer, middle], 'nonzero'); expect(area(nonzero)).toBe(10000);
    const counter = createCompoundPath([outer, reversePath(middle)], 'nonzero'); expect(area(counter)).toBe(3600);
    // Three overlapping windings: +1 +1 -1 remains filled, not an XOR hole.
    const triple = createCompoundPath([outer, middle, reversePath(inner)], 'nonzero'); expect(area(triple)).toBe(10000);
    expect(releaseCompoundPath(evenodd)).toHaveLength(3);
    expect(new Set(evenodd.contours.flatMap(c => c.anchors.map(a => a.id))).size).toBe(12);
  });

  it('uses transformed document coordinates and never changes source geometry', () => {
    const source = left(), copy = structuredClone(source), transformed = transformPath(source, multiplyMatrices(translationMatrix(80, 0), scaleMatrix(2, 1)));
    expect(area(booleanPath('intersection', [source, transformed]))).toBe(2000);
    expect(source).toEqual(copy);
    expect(area(rectanglePath(1e8, 1e8, 10, 10))).toBe(100);
  });

  it('fails clearly on open paths and unsafe Boolean complexity/tolerance', () => {
    expect(() => booleanPath('union', [linePath(0, 0, 100, 100), left()])).toThrow(/닫힌/);
    expect(() => booleanPath('union', [left()], 1)).toThrow();
    expect(() => booleanOperation('divide', Array.from({ length: 17 }, left))).toThrow();
  });

  it('rejects self-crossing or backtracking rings before Boolean without changing originals', () => {
    for (const d of ['M0 0L100 100L0 100L100 0Z', 'M0 0L100 0L50 0L50 100Z', 'M0 0L100 0L100 100L50 0L0 100Z']) {
      const path = parsePathData(d), before = structuredClone(path);
      expect(() => booleanPath('union', [path, left()])).toThrow(/자체 교차|겹쳐/); expect(path).toEqual(before);
    }
    expect(area(booleanPath('union', [starPath(0, 0, 100, 100, 5), left()]))).toBe(10000);
  });

  it('caps adversarial intersection-check work even for a noncrossing long zigzag', () => {
    const zigzag = parsePathData(`M0 0${Array.from({ length: 2200 }, (_, i) => `L${(i + 1) % 2} ${i + 1}`).join('')}L-1 2200L-1 0Z`);
    expect(() => booleanPath('union', [zigzag])).toThrow(/검증이 너무 복잡/);
  });
});
