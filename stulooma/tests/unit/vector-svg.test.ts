import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bytesToDataUrl } from '../../src/core/project';
import { applyMatrix, getPathBounds, multiplyMatrices } from '../../src/core/vector/geometry';
import { exportSVG, importSVG, parseSVGTransform } from '../../src/core/vector/svg';
import type { VectorDocument, VectorObject } from '../../src/types/vector';
import { png } from '../security/fixtures';

const svg = (content: string, attributes = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" ${attributes}>${content}</svg>`;
function world(document: VectorDocument, object: VectorObject): [number, number, number, number, number, number] {
  return object.parentId ? multiplyMatrices(world(document, document.objects.find(parent => parent.id === object.parentId)!), object.transform) : object.transform;
}
const painted = (document: VectorDocument) => document.objects.filter(object => object.geometry);

describe('bounded editable SVG exchange', () => {
  it('converts all basic shapes and full path commands into editable geometry', () => {
    const { document, warnings } = importSVG(svg('<rect x="2" y="3" width="40" height="30" rx="4"/><circle cx="60" cy="40" r="12"/><ellipse cx="100" cy="50" rx="20" ry="8"/><line x1="1" y1="2" x2="5" y2="8"/><polyline points="0,0 10,5 20,0"/><polygon points="30,0 40,5 50,0"/><path d="M0 0h20v20l-10 5q-5 5-10 0t-10-10c1 2 3 4 5 6s7 8 9 10a5 10 30 0 1 12 13z"/>'));
    expect(warnings).toEqual([]); expect(painted(document)).toHaveLength(7);
    expect(painted(document).every(object => object.geometry!.contours[0].anchors.every(anchor => !!anchor.id))).toBe(true);
    expect(painted(document).at(-1)!.geometry!.contours[0].anchors.some(anchor => anchor.in || anchor.out)).toBe(true);
    expect(painted(document)[3].geometry!.contours[0].closed).toBe(false);
  });

  it('preserves nested transforms, inherited styling and group opacity in round-trip', () => {
    const input = importSVG(svg('<g transform="translate(30 20) rotate(90)" opacity=".6" fill="#f80" stroke="navy" stroke-width="3"><g transform="scale(2 3)"><rect width="20" height="10"/></g></g>', 'viewBox="-10 -20 320 240"')).document;
    const rectangle = painted(input)[0], position = applyMatrix(world(input, rectangle), { x: 20, y: 10 });
    expect(position.x).toBeCloseTo(0); expect(position.y).toBeCloseTo(60);
    expect(rectangle.fill).toEqual({ type: 'solid', color: '#ff8800', opacity: 1 });
    expect(rectangle.stroke.paint).toEqual({ type: 'solid', color: '#000080', opacity: 1 });
    const output = exportSVG(input); expect(output).toContain('viewBox="-10 -20 320 240"'); expect(output).toContain('data-vector-object=');
    const restored = importSVG(output).document, restoredRectangle = painted(restored)[0];
    expect(restored.objects.map(object => object.type)).toEqual(input.objects.map(object => object.type));
    expect(getPathBounds(restoredRectangle.geometry!, world(restored, restoredRectangle))).toEqual(getPathBounds(rectangle.geometry!, world(input, rectangle)));
    expect(restored.objects[0].opacity).toBe(.6); expect(restoredRectangle.stroke).toEqual(rectangle.stroke);
  });

  it('composes SVG transform order including rotation about a point and skews', () => {
    expect(applyMatrix(parseSVGTransform('translate(10 20) scale(2)'), { x: 3, y: 4 })).toEqual({ x: 16, y: 28 });
    const rotated = applyMatrix(parseSVGTransform('rotate(90 10 10)'), { x: 20, y: 10 });
    expect(rotated.x).toBeCloseTo(10); expect(rotated.y).toBeCloseTo(20);
    expect(applyMatrix(parseSVGTransform('skewX(45)'), { x: 0, y: 10 }).x).toBeCloseTo(10);
    expect(() => parseSVGTransform('scale(1) evil(2)')).toThrow(); expect(() => parseSVGTransform('matrix(1 2)')).toThrow();
  });

  it('round-trips editable linear/radial gradients including local inheritance and alpha', () => {
    const input = importSVG(svg('<defs><linearGradient id="base"><stop offset="0" stop-color="#ff000080"/><stop offset="100%" stop-color="rgb(0, 0, 255)"/></linearGradient><linearGradient id="gradient" href="#base" x2="80%" gradientTransform="rotate(20)"/><radialGradient id="radial" cx="40%" cy="60%" r="30%"><stop offset="0" stop-color="white"/><stop offset="1" stop-color="black" stop-opacity=".2"/></radialGradient></defs><rect width="90" height="90" fill="url(#gradient)" fill-opacity=".5"/><circle cx="180" cy="80" r="40" fill="url(#radial)"/>'));
    expect(input.warnings).toEqual([]); const first = painted(input.document)[0].fill;
    expect(first.type).toBe('linear'); if (first.type !== 'linear') throw new Error('linear missing');
    expect(first.x2).toBe(.8); expect(first.stops[0].opacity).toBeCloseTo(128 / 255 * .5);
    const restored = importSVG(exportSVG(input.document));
    expect(painted(restored.document).map(object => object.fill)).toEqual(painted(input.document).map(object => object.fill));
  });

  it('keeps compound holes and clip geometry editable without painting the clip source twice', () => {
    const input = importSVG(svg('<defs><clipPath id="cut" transform="translate(5 0)"><path clip-rule="evenodd" d="M0 0H80V80H0z M20 20H60V60H20z"/></clipPath></defs><g transform="translate(40 30)"><rect width="100" height="100" transform="scale(2)" clip-path="url(#cut)" fill="red"/></g>'));
    const target = input.document.objects.find(object => object.clipPathId)!;
    const clip = input.document.objects.find(object => object.id === target.clipPathId)!;
    expect(world(input.document, clip)).toEqual([2, 0, 0, 2, 50, 30]);
    const clipPath = input.document.objects.find(object => object.parentId === clip.id)!;
    expect(clipPath.geometry!.fillRule).toBe('evenodd'); expect(clipPath.geometry!.contours).toHaveLength(2);
    const output = exportSVG(input.document); expect(output.match(/<clipPath /g)).toHaveLength(1);
    expect(output.split('</defs>')[1]).not.toContain(`data-vector-object="${clip.id}"`);
    const restored = importSVG(output); const restoredTarget = restored.document.objects.find(object => object.clipPathId)!;
    const restoredClip = restored.document.objects.find(object => object.id === restoredTarget.clipPathId)!;
    expect(world(restored.document, restoredClip)).toEqual(world(input.document, clip));
    expect(restored.document.objects.find(object => object.parentId === restoredClip.id)!.geometry!.contours).toHaveLength(2);
  });

  it('escapes Korean text and names and retains multiline text metrics', () => {
    const imported = importSVG(svg('<text x="20" y="40" font-family="Noto Sans KR Variable" font-size="24" font-weight="700" letter-spacing="2" text-anchor="middle">정관장 &amp; STULOOMA &lt;서울&gt;</text>'));
    const object = imported.document.objects[0]; object.name = '문자 "이름"'; object.text!.content += '\n유니폼 디자인'; object.text!.lineHeight = 1.5;
    const output = exportSVG(imported.document); expect(output).toContain('&lt;서울&gt;'); expect(output).toContain('&quot;이름&quot;');
    const restored = importSVG(output).document.objects[0]; expect(restored.text).toEqual(object.text); expect(restored.transform).toEqual(object.transform);
  });

  it('preserves non-bundled font intent while warning about local font substitution', () => {
    const result = importSVG(svg('<text font-family="Arial" font-size="20">서울 STULOOMA</text>'));
    expect(result.document.objects[0].text!.fontFamily).toBe('Arial');
    expect(result.warnings.some(warning => warning.includes('Noto Sans KR') && warning.includes('Arial'))).toBe(true);
  });

  it('retains original embedded PNG bytes and safely round-trips editable image placement', () => {
    const data = bytesToDataUrl(png(), 'image/png');
    const imported = importSVG(svg(`<image href="${data}" x="12" y="24" width="80" height="40"/>`));
    expect(imported.assets[0].data).toBe(data); expect(imported.document.assets).toEqual([imported.assets[0].id]);
    expect(imported.document.objects[0].image).toMatchObject({ width: 40, height: 40 });
    expect(imported.document.objects[0].transform).toEqual([1, 0, 0, 1, 32, 24]);
    const restored = importSVG(exportSVG(imported.document, undefined, Object.fromEntries(imported.assets.map(asset => [asset.id, asset]))));
    expect(restored.assets[0].data).toBe(data); expect(restored.document.objects[0].transform).toEqual([1, 0, 0, 1, 32, 24]);
  });

  it('exports selected artwork with its ancestor transforms and excludes siblings', () => {
    const input = importSVG(svg('<g transform="translate(10 20)"><rect id="chosen" width="10" height="10"/><circle id="other" r="10"/></g>')).document;
    const chosen = input.objects.find(object => object.name === 'chosen')!;
    const restored = importSVG(exportSVG(input, undefined, {}, { selection: [chosen.id] })).document;
    expect(restored.objects.map(object => object.name)).toEqual(['g', 'chosen']); expect(getPathBounds(painted(restored)[0].geometry!, world(restored, painted(restored)[0]))).toEqual({ x: 10, y: 20, width: 10, height: 10 });
  });

  it('reports safe unsupported content instead of claiming complete compatibility', () => {
    const result = importSVG(svg('<filter id="blur"/><rect width="10" height="10" filter="url(#blur)" style="mix-blend-mode:multiply"/><animate attributeName="x"/>'));
    expect(result.warnings.some(warning => warning.includes('filter'))).toBe(true); expect(result.warnings.some(warning => warning.includes('animate'))).toBe(true);
    expect(result.document.metadata?.svgImportWarnings).toEqual(result.warnings);
  });

  it.each([
    '<script>alert(1)</script>', '<rect width="1" onload="alert(1)"/>', '<g onclick="alert(1)"/>',
    '<foreignObject><div>unsafe</div></foreignObject>', '<use href="#cycle" id="cycle"/>', '<style>@import "https://example.com/a.css";</style>',
    '<image href="https://example.com/logo.png"/>', '<image href="file:///etc/passwd"/>', '<image href="data:image/svg+xml;base64,PHN2Zy8+"/>',
    '<rect fill="url(https://example.com/a.svg#paint)"/>', '<rect style="fill:url(//example.com/a.svg#paint)"/>',
    '<rect fill="url(&quot;https://example.com/a.svg#paint&quot;)"/>', '<a href="java&#x73;cript:alert(1)"><rect/></a>',
    '<g xmlns:x="urn:external"><x:script/></g>',
  ])('rejects active content and external resources before any document can be returned: %s', content => {
    expect(() => importSVG(svg(content))).toThrow();
  });

  it('rejects malicious/malformed XML, duplicate IDs, huge nesting and invalid coordinates', () => {
    for (const source of ['<!DOCTYPE svg [<!ENTITY exploit "hello">]><svg>&exploit;</svg>', '<svg><path></svg>', '<svg/> <svg/>', '<svg>&unknown;</svg>', svg('<rect id="same"/><path id="same"/>'), svg('<g>'.repeat(40) + '<rect/>' + '</g>'.repeat(40)), svg('<rect width="1e100"/>'), svg('<path d="M0 0LNaN 10"/>')]) expect(() => importSVG(source)).toThrow();
  });

  it('enforces element/object/token/text budgets before returning an editable document', () => {
    expect(() => importSVG(svg('<g/>'.repeat(11000)))).toThrow(/요소/);
    expect(() => importSVG(svg('<rect width="1" height="1"/>'.repeat(2001)))).toThrow(/2,000/);
    expect(() => importSVG(svg(`<polyline points="${'1 1 '.repeat(100001)}"/>`))).toThrow(/복잡/);
    expect(() => importSVG(svg(`<text>${'한'.repeat(20001)}</text>`))).toThrow(/문자열/);
    expect(() => importSVG(svg('<path d="M10000001 0L0 0"/>'))).toThrow(/좌표/);
  });

  it('reports unsupported attributes and paint servers and checks embedded PNG CRCs', () => {
    const imported = importSVG(svg('<defs><pattern id="p"><rect width="1" height="1"/></pattern></defs><rect width="10" height="10" data-mystery="original" fill="url(#p)"/>'));
    expect(imported.warnings.some(warning => warning.includes('data-mystery'))).toBe(true);
    expect(imported.warnings.some(warning => warning.includes('pattern'))).toBe(true);
    const bytes = png(); bytes[bytes.length - 1] ^= 1;
    expect(() => importSVG(svg(`<image href="${bytesToDataUrl(bytes, 'image/png')}"/>`))).toThrow(/체크섬/);
  });

  it('rejects unresolved/cyclic references and malformed embedded PNGs', () => {
    for (const content of ['<rect fill="url(#missing)"/>', '<defs><linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/></defs><rect fill="url(#a)"/>', '<rect clip-path="url(#missing)"/>', '<image href="data:image/png;base64,AAAA"/>', '<defs><clipPath id="a"><g clip-path="url(#a)"><rect width="10" height="10"/></g></clipPath></defs><rect width="10" height="10" clip-path="url(#a)"/>']) expect(() => importSVG(svg(content))).toThrow();
  });

  it('refuses to emit unsafe or missing assets even for programmatically constructed documents', () => {
    const input = importSVG(svg('<rect width="10" height="10"/>')).document;
    input.objects[0].fill = { type: 'solid', color: 'url(https://example.com/a)', opacity: 1 }; expect(() => exportSVG(input)).toThrow();
    input.objects[0].fill = { type: 'solid', color: '#000000', opacity: 1 }; input.objects[0].clipPathId = input.objects[0].id; expect(() => exportSVG(input)).toThrow();
  });

  it('imports the independently authored public-spec fixture', () => {
    const result = importSVG(readFileSync(new URL('../../samples/vector/editable-showcase.svg', import.meta.url), 'utf8'));
    expect(result.warnings).toEqual([]); expect(result.document.objects.some(object => object.text?.content.includes('유니폼'))).toBe(true);
    expect(importSVG(exportSVG(result.document)).document.objects.length).toBe(result.document.objects.length);
  });
});
