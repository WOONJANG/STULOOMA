import { DOMParser, type Element as XmlElement, type Node as XmlNode } from '@xmldom/xmldom';
import { Color } from 'three';
import type { AssetRecord } from '../../types/project';
import type { VectorDocument, VectorMatrix, VectorObject, VectorPaint, VectorPath, VectorStroke } from '../../types/vector';
import { applyMatrix, ellipsePath, geometryToPathData, identityMatrix, invertMatrix, linePath, multiplyMatrices, parsePathData, rectanglePath, roundedRectanglePath } from './geometry';
import { validateVectorDocument } from './validation';

/** An intentionally bounded, editable subset of SVG. Imported XML is never mounted. */
export const SVG_LIMITS = Object.freeze({ bytes: 12 * 1024 * 1024, elements: 5000, objects: 2000, depth: 32, anchors: 100000, text: 100000, stops: 64 });
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const MAX_COORD = 1e7;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const INHERITED = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'color', 'visibility', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'text-anchor'];
const PRESENTATION = [...INHERITED, 'opacity', 'display', 'clip-path', 'mask', 'stop-color', 'stop-opacity', 'line-height'];
type Style = Record<string, string>;
const uuid = () => `v-${crypto.randomUUID()}`;
const tag = (element: XmlElement) => element.localName || element.nodeName;
const children = (element: XmlElement): XmlElement[] => Array.from(element.childNodes).filter(node => node.nodeType === 1) as XmlElement[];
const attr = (element: XmlElement, name: string) => element.hasAttribute(name) ? element.getAttribute(name)! : undefined;
const href = (element: XmlElement) => attr(element, 'href') ?? element.getAttributeNS(XLINK_NS, 'href') ?? undefined;
const escaped = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const fmt = (value: number) => { if (!Number.isFinite(value) || Math.abs(value) > MAX_COORD) throw new Error('SVG 좌표가 허용 범위를 벗어났습니다.'); return Object.is(value, -0) ? '0' : String(value); };
const matrixText = (matrix: VectorMatrix) => `matrix(${matrix.map(fmt).join(' ')})`;
const number = (raw: string | undefined, fallback = 0, max = MAX_COORD) => {
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!NUMBER.test(raw.trim())) throw new Error(`지원하지 않는 SVG 숫자: ${raw.slice(0, 80)}`);
  const result = Number(raw); if (!Number.isFinite(result) || Math.abs(result) > max) throw new Error('SVG 숫자가 허용 범위를 벗어났습니다.'); return result;
};
const opacity = (raw: string | undefined, fallback = 1) => raw?.trim().endsWith('%') ? Math.max(0, Math.min(1, number(raw.trim().slice(0, -1)) / 100)) : Math.max(0, Math.min(1, number(raw, fallback)));
function numberList(raw: string): number[] {
  if (raw.length > 2 * 1024 * 1024) throw new Error('SVG 숫자 목록이 너무 깁니다.');
  const tokens: string[] = [];
  for (const token of raw.matchAll(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi)) { if (tokens.length >= SVG_LIMITS.anchors * 2) throw new Error('SVG 숫자 목록이 너무 복잡합니다.'); tokens.push(token[0]); }
  if (raw.replace(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi, '').replace(/[\s,]/g, '')) throw new Error('잘못된 SVG 숫자 목록입니다.');
  return tokens.map(token => number(token));
}
function length(raw: string | undefined, fallback = 0, percentBasis?: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|mm|cm|in|pt|pc|%)?$/i.exec(raw.trim());
  if (!match) throw new Error(`지원하지 않는 SVG 길이: ${raw.slice(0, 80)}`);
  const multiplier: Record<string, number> = { px: 1, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pt: 96 / 72, pc: 16 };
  if (match[2] === '%' && percentBasis === undefined) throw new Error('기준 크기가 없는 SVG 백분율입니다.');
  return number(String(Number(match[1]) * (match[2] === '%' ? percentBasis! / 100 : multiplier[match[2]?.toLowerCase() ?? 'px'])));
}

/** SVG transform lists compose left to right as matrices (A B maps A(B(p))). */
export function parseSVGTransform(source: string | undefined): VectorMatrix {
  if (!source?.trim()) return identityMatrix();
  if (source.length > 8192) throw new Error('SVG 변환 목록이 너무 깁니다.');
  let result = identityMatrix(), end = 0, count = 0;
  const expression = /([A-Za-z]+)\s*\(([^()]*)\)/g;
  for (const match of source.matchAll(expression)) {
    if (source.slice(end, match.index).replace(/[\s,]/g, '')) throw new Error('잘못된 SVG 변환입니다.');
    end = match.index! + match[0].length; if (++count > 128) throw new Error('SVG 변환이 너무 많습니다.');
    const values = numberList(match[2]); let next: VectorMatrix;
    const angle = (values[0] ?? 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    switch (match[1]) {
      case 'matrix': if (values.length !== 6) throw new Error('matrix 인자는 6개여야 합니다.'); next = values as VectorMatrix; break;
      case 'translate': if (values.length < 1 || values.length > 2) throw new Error('잘못된 translate 인자입니다.'); next = [1, 0, 0, 1, values[0], values[1] ?? 0]; break;
      case 'scale': if (values.length < 1 || values.length > 2) throw new Error('잘못된 scale 인자입니다.'); next = [values[0], 0, 0, values[1] ?? values[0], 0, 0]; break;
      case 'rotate': {
        if (values.length !== 1 && values.length !== 3) throw new Error('잘못된 rotate 인자입니다.');
        next = [cos, sin, -sin, cos, 0, 0];
        if (values.length === 3) next = multiplyMatrices([1, 0, 0, 1, values[1], values[2]], multiplyMatrices(next, [1, 0, 0, 1, -values[1], -values[2]])); break;
      }
      case 'skewX': if (values.length !== 1) throw new Error('잘못된 skewX 인자입니다.'); next = [1, 0, Math.tan(angle), 1, 0, 0]; break;
      case 'skewY': if (values.length !== 1) throw new Error('잘못된 skewY 인자입니다.'); next = [1, Math.tan(angle), 0, 1, 0, 0]; break;
      default: throw new Error(`지원하지 않는 SVG 변환: ${match[1]}`);
    }
    result = multiplyMatrices(result, next);
    if (result.some(value => !Number.isFinite(value) || Math.abs(value) > 1e6)) throw new Error('SVG 변환 범위가 너무 큽니다.');
  }
  if (!count || source.slice(end).replace(/[\s,]/g, '')) throw new Error('잘못된 SVG 변환입니다.');
  return result;
}

function parseColor(raw: string, current = '#000000'): { color: string; alpha: number } {
  const value = raw.trim().toLowerCase();
  if (value === 'currentcolor') return { color: current, alpha: 1 };
  if (value === 'transparent') return { color: '#000000', alpha: 0 };
  if (/^#[\da-f]{3,4}$/.test(value)) { const hex = value.slice(1).split('').map(char => char + char).join(''); return { color: `#${hex.slice(0, 6)}`, alpha: hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1 }; }
  if (/^#[\da-f]{6}(?:[\da-f]{2})?$/.test(value)) return { color: value.slice(0, 7), alpha: value.length === 9 ? parseInt(value.slice(7), 16) / 255 : 1 };
  const named = Color.NAMES[value as keyof typeof Color.NAMES];
  if (named !== undefined) return { color: `#${named.toString(16).padStart(6, '0')}`, alpha: 1 };
  const rgb = /^rgba?\(([^()]*)\)$/.exec(value);
  if (rgb) {
    const parts = rgb[1].split(/\s*[,/]\s*|\s+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) throw new Error('잘못된 SVG RGB 색상입니다.');
    const channels = parts.slice(0, 3).map(part => Math.round(Math.max(0, Math.min(255, part.endsWith('%') ? number(part.slice(0, -1)) * 2.55 : number(part)))));
    return { color: `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`, alpha: opacity(parts[3]) };
  }
  const hsl = /^hsla?\(([^()]*)\)$/.exec(value);
  if (hsl) {
    const parts = hsl[1].split(/\s*[,/]\s*|\s+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4 || !parts[1].endsWith('%') || !parts[2].endsWith('%')) throw new Error('잘못된 SVG HSL 색상입니다.');
    const h = ((number(parts[0].replace(/deg$/, '')) % 360) + 360) % 360 / 360, s = opacity(parts[1]), l = opacity(parts[2]);
    const a = s * Math.min(l, 1 - l), channel = (n: number) => { const k = (n + h * 12) % 12; return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255); };
    return { color: `#${[channel(0), channel(8), channel(4)].map(component => component.toString(16).padStart(2, '0')).join('')}`, alpha: opacity(parts[3]) };
  }
  throw new Error(`지원하지 않는 SVG 색상: ${raw.slice(0, 80)}`);
}

const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => { let result = byte; for (let bit = 0; bit < 8; bit++) result = result & 1 ? 0xedb88320 ^ (result >>> 1) : result >>> 1; return result >>> 0; });
function pngCRC(bytes: Uint8Array): number { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function decodePNG(data: string): { width: number; height: number } {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length > 12 * 1024 * 1024) throw new Error('SVG 이미지는 내장 PNG만 허용합니다.');
  const base64 = data.slice(data.indexOf(',') + 1); if (base64.length % 4 !== 0) throw new Error('잘못된 PNG base64입니다.');
  let binary: string; try { binary = atob(base64); } catch { throw new Error('잘못된 PNG base64입니다.'); }
  if (binary.length < 45 || [137, 80, 78, 71, 13, 10, 26, 10].some((value, index) => binary.charCodeAt(index) !== value)) throw new Error('SVG 내장 이미지가 PNG가 아닙니다.');
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0)), view = new DataView(bytes.buffer);
  if (view.getUint32(8) !== 13 || binary.slice(12, 16) !== 'IHDR') throw new Error('PNG 헤더가 잘못되었습니다.');
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > 8192 || height > 8192 || width * height > 32e6) throw new Error('SVG 내장 PNG의 픽셀 크기가 너무 큽니다.');
  const validDepths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!validDepths[bytes[25]]?.includes(bytes[24]) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] > 1) throw new Error('지원하지 않는 PNG 헤더입니다.');
  let position = 8, ended = false, hasPixels = false, chunks = 0;
  while (position < bytes.length) {
    if (position + 12 > bytes.length || ++chunks > 100000) throw new Error('잘못된 PNG 청크입니다.');
    const size = view.getUint32(position); if (size > bytes.length - position - 12) throw new Error('PNG 청크가 파일 범위를 벗어났습니다.');
    const type = binary.slice(position + 4, position + 8); if (!/^[A-Za-z]{4}$/.test(type)) throw new Error('잘못된 PNG 청크 종류입니다.');
    if (pngCRC(bytes.subarray(position + 4, position + 8 + size)) !== view.getUint32(position + 8 + size)) throw new Error('PNG 체크섬이 일치하지 않습니다.');
    if (type === 'IDAT') hasPixels = true;
    position += size + 12;
    if (type === 'IEND') { if (size !== 0 || position !== bytes.length) throw new Error('PNG 종료 청크가 잘못되었습니다.'); ended = true; break; }
  }
  if (!ended || !hasPixels) throw new Error('PNG 이미지 데이터가 없습니다.');
  return { width, height };
}

export function importSVG(source: string): { document: VectorDocument; assets: AssetRecord[]; warnings: string[] } {
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > SVG_LIMITS.bytes) throw new Error('SVG는 12 MB 이하로 선택하세요.');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source) || /<\?(?!xml\s)/i.test(source)) throw new Error('DOCTYPE·엔티티·처리 명령은 SVG에서 허용하지 않습니다.');
  // Bound DOM allocation before the XML parser creates nodes. This conservative
  // budget also counts markup-looking text inside comments/CDATA.
  let markupCount = 0; for (let index = 0; index < source.length; index++) if (source.charCodeAt(index) === 60 && ++markupCount > SVG_LIMITS.elements * 2 + 16) throw new Error('SVG 요소 수 제한을 초과했습니다.');
  let xml: ReturnType<DOMParser['parseFromString']>;
  try { xml = new DOMParser({ onError: () => { throw new Error('잘못된 SVG XML입니다.'); } }).parseFromString(source, 'image/svg+xml'); } catch { throw new Error('잘못된 SVG XML입니다.'); }
  const root = xml.documentElement;
  if (!root || tag(root) !== 'svg' || (root.namespaceURI && root.namespaceURI !== SVG_NS)) throw new Error('SVG 루트 요소가 필요합니다.');
  const warnings: string[] = [], seenWarnings = new Set<string>(), ids = new Map<string, XmlElement>();
  const warn = (message: string) => { if (!seenWarnings.has(message) && warnings.length < 128) { seenWarnings.add(message); warnings.push(message); } };
  let elementCount = 0, textCount = 0;
  const inspect = (node: XmlNode, depth: number) => {
    if (depth > SVG_LIMITS.depth) throw new Error('SVG 중첩이 너무 깊습니다.');
    if (node.nodeType === 3 || node.nodeType === 4) { textCount += node.nodeValue?.length ?? 0; if (textCount > SVG_LIMITS.text) throw new Error('SVG 문자가 너무 많습니다.'); }
    if (node.nodeType === 1) {
      const element = node as XmlElement, name = tag(element);
      if (++elementCount > SVG_LIMITS.elements || element.attributes.length > 80) throw new Error('SVG 요소 또는 속성이 너무 많습니다.');
      if (['script', 'foreignObject', 'iframe', 'object', 'embed', 'use', 'style'].includes(name)) throw new Error(`보안을 위해 SVG ${name} 요소를 허용하지 않습니다.`);
      if (element.namespaceURI && element.namespaceURI !== SVG_NS) warn(`SVG 외부 네임스페이스 요소(${name})는 가져오지 않았습니다.`);
      for (const attribute of Array.from(element.attributes)) {
        const key = attribute.localName || attribute.name, value = attribute.value, compact = value.replace(/[\u0000-\u0020\u007f]/g, '').toLowerCase();
        if (/^on/i.test(key) || /^(?:javascript|vbscript):/.test(compact)) throw new Error('SVG 스크립트 또는 이벤트 핸들러는 허용하지 않습니다.');
        if ((key === 'href' || key === 'src') && value && !(name === 'image' && /^data:image\/png;base64,/.test(value)) && !/^#[^\s'"()<>]+$/.test(value)) throw new Error('SVG 외부 리소스는 허용하지 않습니다.');
        if (/@import|expression\s*\(|-moz-binding/i.test(value)) throw new Error('위험한 SVG 스타일은 허용하지 않습니다.');
        for (const url of value.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi)) if (!/^#[^\s'"()<>]+$/.test(url[2].trim())) throw new Error('SVG 외부 URL은 허용하지 않습니다.');
        const common = ['id', 'transform', 'style', 'class', 'data-name', 'data-vector-object', 'data-vector-locked', 'aria-label', 'clip-rule', ...PRESENTATION];
        const known: Record<string, string[]> = { svg: ['width', 'height', 'viewBox', 'preserveAspectRatio', 'x', 'y', 'version'], path: ['d'], rect: ['x', 'y', 'width', 'height', 'rx', 'ry'], circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'], line: ['x1', 'y1', 'x2', 'y2'], polyline: ['points'], polygon: ['points'], text: ['x', 'y'], tspan: ['x', 'dy'], image: ['x', 'y', 'width', 'height', 'href', 'preserveAspectRatio'], linearGradient: ['href', 'x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform', 'spreadMethod'], radialGradient: ['href', 'cx', 'cy', 'r', 'fx', 'fy', 'gradientUnits', 'gradientTransform', 'spreadMethod'], stop: ['offset'], clipPath: ['clipPathUnits'] };
        if (!attribute.name.startsWith('xmlns') && attribute.name !== 'xml:space' && !common.includes(attribute.name) && !(known[name] ?? []).includes(key)) warn(`지원하지 않는 SVG 속성(${name}.${attribute.name})을 생략했습니다.`);
      }
      const id = attr(element, 'id'); if (id) { if (id.length > 256 || ids.has(id)) throw new Error('SVG ID가 중복되었거나 너무 깁니다.'); ids.set(id, element); }
    }
    for (const child of Array.from(node.childNodes)) inspect(child, depth + (child.nodeType === 1 ? 1 : 0));
  };
  inspect(root, 1);
  const viewBox = attr(root, 'viewBox') ? numberList(attr(root, 'viewBox')!) : undefined;
  if (viewBox && (viewBox.length !== 4 || viewBox[2] <= 0 || viewBox[3] <= 0)) throw new Error('SVG viewBox가 잘못되었습니다.');
  const width = viewBox?.[2] ?? length(attr(root, 'width'), 300, 300), height = viewBox?.[3] ?? length(attr(root, 'height'), 150, 150);
  if (width <= 0 || height <= 0 || width > 100000 || height > 100000) throw new Error('SVG 아트보드 크기가 허용 범위를 벗어났습니다.');
  const artboard = { id: uuid(), name: 'SVG 아트보드', x: viewBox?.[0] ?? 0, y: viewBox?.[1] ?? 0, width, height, unit: 'px' as const, background: null };
  const document: VectorDocument = { id: uuid(), name: children(root).find(element => tag(element) === 'title')?.textContent?.slice(0, 160) || '가져온 SVG', version: 1, artboards: [artboard], objects: [], assets: [] };
  const assets: AssetRecord[] = [], objects = document.objects, clipRequests: { target: VectorObject; reference: string }[] = [];
  let anchorCount = 0;
  const styleOf = (element: XmlElement, inherited: Style): Style => {
    const style: Style = {}; for (const property of INHERITED) if (inherited[property] !== undefined) style[property] = inherited[property];
    for (const property of PRESENTATION) { const value = attr(element, property); if (value !== undefined) style[property] = value.trim(); }
    const inline = attr(element, 'style');
    if (inline) for (const declaration of inline.split(';')) {
      if (!declaration.trim()) continue; const colon = declaration.indexOf(':');
      if (colon <= 0 || /[{}@\\]/.test(declaration)) throw new Error('지원하지 않는 SVG 스타일 구문입니다.');
      const property = declaration.slice(0, colon).trim().toLowerCase(), value = declaration.slice(colon + 1).trim();
      if (PRESENTATION.includes(property)) style[property] = value.replace(/\s*!important\s*$/i, ''); else warn(`지원하지 않는 SVG 스타일(${property})을 생략했습니다.`);
    }
    for (const key of Object.keys(style)) if (style[key] === 'inherit') { if (inherited[key] !== undefined) style[key] = inherited[key]; else delete style[key]; }
    return style;
  };
  const localRef = (raw: string) => { const match = /^url\(\s*(['"]?)(#[^\s'"()<>]+)\1\s*\)$/.exec(raw.trim()); if (!match) throw new Error('잘못된 SVG 내부 참조입니다.'); return match[2].slice(1); };
  const gradients = new Map<string, VectorPaint>();
  const readGradient = (id: string, stack: Set<string> = new Set()): VectorPaint => {
    const cached = gradients.get(id); if (cached) return structuredClone(cached);
    const element = ids.get(id); if (!element || !['linearGradient', 'radialGradient'].includes(tag(element))) throw new Error('SVG 그라디언트 참조가 없습니다.');
    if (stack.has(id) || stack.size > 16) throw new Error('SVG 그라디언트 참조가 순환합니다.'); stack.add(id);
    const reference = href(element), parent = reference ? ids.get(reference.slice(1)) : undefined;
    if (reference && (!reference.startsWith('#') || !parent || !['linearGradient', 'radialGradient'].includes(tag(parent)))) throw new Error('잘못된 SVG 그라디언트 상속입니다.');
    const parentPaint = reference ? readGradient(reference.slice(1), stack) : undefined;
    const inheritedAttribute = (key: string): string | undefined => { let current: XmlElement | undefined = element; const visited = new Set<XmlElement>(); while (current) { if (visited.has(current)) throw new Error('SVG 그라디언트 참조가 순환합니다.'); visited.add(current); if (current.hasAttribute(key)) return current.getAttribute(key)!; const reference = href(current); current = reference ? ids.get(reference.slice(1)) : undefined; } return undefined; };
    const units = inheritedAttribute('gradientUnits') ?? 'objectBoundingBox'; if (units !== 'objectBoundingBox' && units !== 'userSpaceOnUse') throw new Error('잘못된 SVG 그라디언트 좌표계입니다.');
    if (inheritedAttribute('spreadMethod') && inheritedAttribute('spreadMethod') !== 'pad') warn('반복·반사 그라디언트를 끝 색상 연장(pad)으로 가져왔습니다.');
    const coord = (key: string, fallback: string, axis: 'x' | 'y' | 'r') => length(inheritedAttribute(key) ?? fallback, 0, units === 'objectBoundingBox' ? 1 : axis === 'x' ? width : axis === 'y' ? height : Math.hypot(width, height) / Math.SQRT2);
    const stopElements = children(element).filter(stop => tag(stop) === 'stop');
    if (stopElements.length > SVG_LIMITS.stops) throw new Error('SVG 그라디언트 색상점은 64개 이하로 선택하세요.');
    let lastOffset = 0;
    const stops = stopElements.map(stop => {
      const style = styleOf(stop, {}), color = parseColor(style['stop-color'] ?? '#000000');
      const offset = Math.max(lastOffset, opacity(attr(stop, 'offset'), 0)); lastOffset = offset;
      return { offset, color: color.color, opacity: color.alpha * opacity(style['stop-opacity']) };
    });
    const common = { units: units as 'objectBoundingBox' | 'userSpaceOnUse', transform: parseSVGTransform(inheritedAttribute('gradientTransform')), stops: stops.length ? stops : parentPaint && (parentPaint.type === 'linear' || parentPaint.type === 'radial') ? parentPaint.stops : [{ offset: 0, color: '#000000', opacity: 0 }] };
    const paint: VectorPaint = tag(element) === 'linearGradient'
      ? { type: 'linear', ...common, x1: coord('x1', '0%', 'x'), y1: coord('y1', '0%', 'y'), x2: coord('x2', '100%', 'x'), y2: coord('y2', '0%', 'y') }
      : { type: 'radial', ...common, cx: coord('cx', '50%', 'x'), cy: coord('cy', '50%', 'y'), r: coord('r', '50%', 'r'), fx: coord('fx', inheritedAttribute('cx') ?? '50%', 'x'), fy: coord('fy', inheritedAttribute('cy') ?? '50%', 'y') };
    if (paint.type === 'radial' && paint.r < 0) throw new Error('SVG 그라디언트 반지름은 양수여야 합니다.');
    gradients.set(id, paint); return structuredClone(paint);
  };
  const readPaint = (raw: string | undefined, alpha: string | undefined, fallback: string, style: Style): VectorPaint => {
    const value = (raw ?? fallback).trim(); if (value === 'none') return { type: 'none' };
    if (/^url\(/.test(value.trim())) { const reference = localRef(value), element = ids.get(reference); if (element && !['linearGradient', 'radialGradient'].includes(tag(element))) { warn(`지원하지 않는 SVG 칠 서버(${tag(element)})를 투명으로 가져왔습니다.`); return { type: 'none' }; } const paint = readGradient(reference), multiplier = opacity(alpha); if (paint.type === 'linear' || paint.type === 'radial') paint.stops.forEach(stop => { stop.opacity *= multiplier; }); if (paint.type === 'radial' && paint.r === 0) { const last = paint.stops.at(-1)!; return { type: 'solid', color: last.color, opacity: last.opacity }; } return paint; }
    let color: { color: string; alpha: number }; try { color = parseColor(value, parseColor(style.color ?? '#000000').color); } catch (error) { warn(`${(error as Error).message}; 검정으로 대체했습니다.`); color = { color: '#000000', alpha: 1 }; }
    return { type: 'solid', color: color.color, opacity: color.alpha * opacity(alpha) };
  };
  const register = (object: VectorObject) => { if (objects.length >= SVG_LIMITS.objects) throw new Error('SVG 편집 객체는 2,000개 이하로 선택하세요.'); if (object.geometry) { anchorCount += object.geometry.contours.reduce((sum, contour) => sum + contour.anchors.length, 0); if (anchorCount > SVG_LIMITS.anchors) throw new Error('SVG 앵커가 너무 많습니다.'); for (const contour of object.geometry.contours) for (const anchor of contour.anchors) for (const point of [anchor, anchor.in, anchor.out]) if (point && (!Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > MAX_COORD || Math.abs(point.y) > MAX_COORD)) throw new Error('SVG 경로 좌표가 허용 범위를 벗어났습니다.'); } objects.push(object); return object; };
  const readElement = (element: XmlElement, parentId: string | null, inherited: Style, definition = false): VectorObject | undefined => {
    const name = tag(element);
    if (element.namespaceURI && element.namespaceURI !== SVG_NS) return undefined;
    if (['defs', 'linearGradient', 'radialGradient', 'clipPath', 'title', 'desc', 'metadata'].includes(name)) return undefined;
    if (!['g', 'svg', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'image'].includes(name)) { warn(`지원하지 않는 SVG 요소(${name})와 하위 내용을 생략했습니다.`); return undefined; }
    const style = styleOf(element, inherited), object: VectorObject = {
      id: uuid(), name: (attr(element, 'data-name') || attr(element, 'aria-label') || attr(element, 'id') || name).slice(0, 160), type: name === 'g' || name === 'svg' ? 'group' : name === 'text' ? 'text' : name === 'image' ? 'image' : 'path',
      parentId, artboardId: artboard.id, transform: parseSVGTransform(attr(element, 'transform')), opacity: opacity(style.opacity), visible: style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse', locked: attr(element, 'data-vector-locked') === 'true',
      fill: readPaint(style.fill, style['fill-opacity'], '#000000', style), stroke: { paint: readPaint(style.stroke, style['stroke-opacity'], 'none', style), width: length(style['stroke-width'], 1), lineCap: ['butt', 'round', 'square'].includes(style['stroke-linecap']) ? style['stroke-linecap'] as VectorStroke['lineCap'] : 'butt', lineJoin: ['miter', 'round', 'bevel'].includes(style['stroke-linejoin']) ? style['stroke-linejoin'] as VectorStroke['lineJoin'] : 'miter', miterLimit: number(style['stroke-miterlimit'], 4), dash: !style['stroke-dasharray'] || style['stroke-dasharray'] === 'none' ? [] : numberList(style['stroke-dasharray']), dashOffset: length(style['stroke-dashoffset'], 0) },
    };
    if (object.stroke.width < 0 || object.stroke.miterLimit < 1 || object.stroke.dash.some(value => value < 0) || object.stroke.dash.length > 128) throw new Error('SVG 획 설정이 잘못되었습니다.');
    if (object.stroke.dash.length && object.stroke.dash.every(value => value === 0)) object.stroke.dash = [];
    const x = (key: string, fallback = 0) => length(attr(element, key), fallback, width), y = (key: string, fallback = 0) => length(attr(element, key), fallback, height);
    if (object.type === 'path') {
      let path: VectorPath;
      switch (name) {
        case 'path': path = parsePathData(attr(element, 'd') ?? ''); break;
        case 'rect': { const w = x('width'), h = y('height'); if (w < 0 || h < 0) throw new Error('SVG 사각형 크기가 음수입니다.'); const rx = attr(element, 'rx'), ry = attr(element, 'ry'); const radiusX = length(rx ?? ry, 0, width), radiusY = length(ry ?? rx, 0, height); if (radiusX < 0 || radiusY < 0) throw new Error('SVG 모서리 반경이 음수입니다.'); path = radiusX || radiusY ? roundedRectanglePath(x('x'), y('y'), w, h, Math.min(radiusX, w / 2), Math.min(radiusY, h / 2)) : rectanglePath(x('x'), y('y'), w, h); break; }
        case 'circle': { const radius = length(attr(element, 'r'), 0, Math.hypot(width, height) / Math.SQRT2); if (radius < 0) throw new Error('SVG 원 반지름이 음수입니다.'); path = ellipsePath(x('cx'), y('cy'), radius, radius); break; }
        case 'ellipse': { const rx = x('rx'), ry = y('ry'); if (rx < 0 || ry < 0) throw new Error('SVG 타원 반지름이 음수입니다.'); path = ellipsePath(x('cx'), y('cy'), rx, ry); break; }
        case 'line': path = linePath(x('x1'), y('y1'), x('x2'), y('y2')); break;
        default: { const points = numberList(attr(element, 'points') ?? ''); if (points.length % 2) throw new Error('SVG 점 좌표의 개수가 잘못되었습니다.'); path = { fillRule: 'nonzero', contours: points.length ? [{ closed: name === 'polygon', anchors: Array.from({ length: points.length / 2 }, (_, index) => ({ id: uuid(), x: points[index * 2], y: points[index * 2 + 1], kind: 'corner' as const })) }] : [] }; }
      }
      path.fillRule = style['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero'; object.geometry = path;
    } else if (object.type === 'text') {
      const spans = children(element).filter(child => tag(child) === 'tspan');
      let content = ''; for (const node of Array.from(element.childNodes)) { if (node.nodeType === 3 || node.nodeType === 4) content += node.nodeValue ?? ''; else if (node.nodeType === 1 && tag(node as XmlElement) === 'tspan') { const span = node as XmlElement; if (content && (span.hasAttribute('dy') || span.hasAttribute('x'))) content += '\n'; content += span.textContent ?? ''; if (span.hasAttribute('style') || span.hasAttribute('font-size') || span.hasAttribute('fill')) warn('문자 내부 tspan별 서식을 기본 문자 서식으로 통합했습니다.'); } }
      if (children(element).some(child => tag(child) !== 'tspan')) warn('패스 위 문자 등 지원하지 않는 문자 자식 요소를 생략했습니다.');
      const fontSize = length(style['font-size'], 16), fontWeight = style['font-weight'] === 'bold' ? 700 : style['font-weight'] === 'normal' || !style['font-weight'] ? 400 : number(style['font-weight']);
      if (fontSize <= 0 || fontSize > 4096 || fontWeight < 1 || fontWeight > 1000) throw new Error('SVG 글꼴 크기 또는 굵기가 잘못되었습니다.');
      let lineHeight = 1.2; if (spans.length > 1 && attr(spans[1], 'dy')) lineHeight = length(attr(spans[1], 'dy'), fontSize * 1.2) / fontSize;
      if (style['line-height']) lineHeight = style['line-height'].endsWith('%') ? length(style['line-height'], 0, 1) : number(style['line-height']);
      object.text = { content, fontFamily: (style['font-family'] ?? 'Noto Sans KR Variable').replace(/^["']|["']$/g, '').slice(0, 200), fontSize, fontWeight, letterSpacing: style['letter-spacing'] === 'normal' ? 0 : length(style['letter-spacing'], 0), lineHeight: Math.max(0.1, Math.min(10, lineHeight)), alignment: ['start', 'middle', 'end'].includes(style['text-anchor']) ? style['text-anchor'] as 'start' | 'middle' | 'end' : 'start' };
      if (!['Noto Sans KR Variable', 'STULOOMA Noto Sans KR'].includes(object.text.fontFamily)) warn(`글꼴 '${object.text.fontFamily}'은 설치 상태에 따라 Noto Sans KR로 대체될 수 있습니다. 원래 글꼴 이름은 보존했습니다.`);
      object.transform = multiplyMatrices(object.transform, [1, 0, 0, 1, x('x'), y('y')]);
      if (element.hasAttribute('dx') || element.hasAttribute('dy') || element.hasAttribute('rotate') || element.hasAttribute('textLength')) warn('문자 dx/dy/rotate/textLength 상세 배치는 가져오지 않았습니다.');
    } else if (object.type === 'image') {
      const data = href(element); if (!data) throw new Error('SVG 이미지 데이터가 없습니다.'); const intrinsic = decodePNG(data);
      let imageWidth = x('width', intrinsic.width), imageHeight = y('height', intrinsic.height), imageX = x('x'), imageY = y('y');
      if (imageWidth <= 0 || imageHeight <= 0) throw new Error('SVG 이미지 크기가 잘못되었습니다.');
      const preserve = attr(element, 'preserveAspectRatio') ?? 'xMidYMid meet';
      if (preserve !== 'none') {
        const match = /^(xMin|xMid|xMax)(YMin|YMid|YMax)(?:\s+(meet|slice))?$/.exec(preserve);
        if (!match) throw new Error('지원하지 않는 SVG 이미지 비율 설정입니다.');
        if (match[3] === 'slice') warn('이미지 slice 자르기는 meet 맞춤으로 가져왔습니다.');
        const scale = Math.min(imageWidth / intrinsic.width, imageHeight / intrinsic.height), fitWidth = intrinsic.width * scale, fitHeight = intrinsic.height * scale;
        imageX += (imageWidth - fitWidth) * (match[1] === 'xMid' ? 0.5 : match[1] === 'xMax' ? 1 : 0); imageY += (imageHeight - fitHeight) * (match[2] === 'YMid' ? 0.5 : match[2] === 'YMax' ? 1 : 0); imageWidth = fitWidth; imageHeight = fitHeight;
      }
      let asset = assets.find(existing => existing.data === data);
      if (!asset) { if (assets.length >= 64) throw new Error('SVG 내장 이미지는 64개 이하로 선택하세요.'); asset = { id: uuid(), name: `${object.name.slice(0, 156)}.png`, mime: 'image/png', data }; assets.push(asset); document.assets.push(asset.id); }
      object.image = { assetId: asset.id, width: imageWidth, height: imageHeight }; object.transform = multiplyMatrices(object.transform, [1, 0, 0, 1, imageX, imageY]);
    }
    register(object);
    if (style['clip-path'] && style['clip-path'] !== 'none') { if (definition) throw new Error('중첩 클리핑 정의는 지원하지 않습니다.'); clipRequests.push({ target: object, reference: localRef(style['clip-path']) }); }
    if (style.mask && style.mask !== 'none') warn('SVG 불투명도 마스크는 가져오지 않았습니다. 클리핑 경로를 사용하세요.');
    if (object.type === 'group') {
      if (name === 'svg') {
        warn('중첩 SVG의 뷰포트 자르기는 가져오지 않았습니다.');
        const innerBox = attr(element, 'viewBox') ? numberList(attr(element, 'viewBox')!) : undefined;
        if (innerBox && (innerBox.length !== 4 || innerBox[2] <= 0 || innerBox[3] <= 0)) throw new Error('중첩 SVG viewBox가 잘못되었습니다.');
        object.transform = multiplyMatrices(object.transform, [1, 0, 0, 1, x('x'), y('y')]);
        if (innerBox) { const w = x('width', innerBox[2]), h = y('height', innerBox[3]); const preserve = attr(element, 'preserveAspectRatio') ?? 'xMidYMid meet'; let sx = w / innerBox[2], sy = h / innerBox[3], tx = 0, ty = 0; if (preserve !== 'none') { const scale = preserve.endsWith('slice') ? Math.max(sx, sy) : Math.min(sx, sy); sx = scale; sy = scale; tx = preserve.startsWith('xMin') ? 0 : preserve.startsWith('xMax') ? w - innerBox[2] * sx : (w - innerBox[2] * sx) / 2; ty = /YMin/.test(preserve) ? 0 : /YMax/.test(preserve) ? h - innerBox[3] * sy : (h - innerBox[3] * sy) / 2; } object.transform = multiplyMatrices(object.transform, [sx, 0, 0, sy, tx - innerBox[0] * sx, ty - innerBox[1] * sy]); }
      }
      for (const child of children(element)) readElement(child, object.id, style, definition);
    }
    for (const unsupported of ['filter', 'vector-effect', 'mix-blend-mode', 'paint-order']) if (element.hasAttribute(unsupported)) warn(`지원하지 않는 SVG 속성(${unsupported})을 생략했습니다.`);
    return object;
  };
  const rootStyle = styleOf(root, {}), rootTransform = parseSVGTransform(attr(root, 'transform'));
  if (rootStyle.mask && rootStyle.mask !== 'none') warn('SVG 불투명도 마스크는 가져오지 않았습니다. 클리핑 경로를 사용하세요.');
  let rootParent: string | null = null;
  if (opacity(rootStyle.opacity) !== 1 || rootStyle.display === 'none' || (rootStyle['clip-path'] && rootStyle['clip-path'] !== 'none')) {
    const group: VectorObject = { id: uuid(), name: 'SVG', type: 'group', parentId: null, artboardId: artboard.id, transform: rootTransform, opacity: opacity(rootStyle.opacity), visible: rootStyle.display !== 'none', locked: false, fill: { type: 'none' }, stroke: { paint: { type: 'none' }, width: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 4, dash: [], dashOffset: 0 } }; register(group); rootParent = group.id; if (rootStyle['clip-path'] && rootStyle['clip-path'] !== 'none') clipRequests.push({ target: group, reference: localRef(rootStyle['clip-path']) });
  }
  for (const child of children(root)) { const object = readElement(child, rootParent, rootStyle); if (object && !rootParent) object.transform = multiplyMatrices(rootTransform, object.transform); }
  const world = (object: VectorObject): VectorMatrix => object.parentId ? multiplyMatrices(world(objects.find(parent => parent.id === object.parentId)!), object.transform) : object.transform;
  for (const { target, reference } of clipRequests) {
    const definition = ids.get(reference); if (!definition || tag(definition) !== 'clipPath') throw new Error('SVG 클리핑 경로 참조가 없습니다.');
    if ((attr(definition, 'clipPathUnits') ?? 'userSpaceOnUse') !== 'userSpaceOnUse') { warn('objectBoundingBox 클리핑은 가져오지 않았습니다. userSpaceOnUse를 사용하세요.'); continue; }
    const clip: VectorObject = { id: uuid(), name: (attr(definition, 'data-name') || attr(definition, 'id') || '클리핑 경로').slice(0, 160), type: 'group', parentId: null, artboardId: artboard.id, transform: multiplyMatrices(world(target), parseSVGTransform(attr(definition, 'transform'))), opacity: 1, visible: true, locked: false, fill: { type: 'none' }, stroke: { paint: { type: 'none' }, width: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 4, dash: [], dashOffset: 0 } }; register(clip);
    const style = styleOf(definition, {}); if (attr(definition, 'clip-rule')) style['fill-rule'] = attr(definition, 'clip-rule')!;
    for (const child of children(definition)) { const clipped = readElement(child, clip.id, style, true); if (clipped && attr(child, 'clip-rule') && clipped.geometry) clipped.geometry.fillRule = attr(child, 'clip-rule') === 'evenodd' ? 'evenodd' : 'nonzero'; }
    target.clipPathId = clip.id;
  }
  if (!objects.some(object => object.type !== 'group')) warn('가져올 수 있는 벡터 도형이 없습니다.');
  if (warnings.length) document.metadata = { svgImportWarnings: warnings };
  return { document: validateVectorDocument(document, Object.fromEntries(assets.map(asset => [asset.id, asset]))), assets, warnings };
}

export function exportSVG(document: VectorDocument, artboardId?: string, assets: Record<string, AssetRecord> = {}, options: { background?: boolean; selection?: string[] } = {}): string {
  validateVectorDocument(document, assets);
  const artboard = document.artboards.find(board => board.id === (artboardId ?? document.artboards[0]?.id)); if (!artboard) throw new Error('내보낼 아트보드가 없습니다.');
  const objects = document.objects.filter(object => object.artboardId === artboard.id), byId = new Map(objects.map(object => [object.id, object])), indices = new Map(objects.map((object, index) => [object.id, index]));
  if (byId.size !== objects.length || objects.length > SVG_LIMITS.objects) throw new Error('SVG 객체 ID 또는 개수가 잘못되었습니다.');
  const descendants = new Map<string | null, VectorObject[]>(); for (const object of objects) { if (object.parentId && !byId.has(object.parentId)) throw new Error('SVG 부모 객체가 없습니다.'); const list = descendants.get(object.parentId) ?? []; list.push(object); descendants.set(object.parentId, list); }
  const worldCache = new Map<string, VectorMatrix>(), worldStack = new Set<string>();
  const world = (object: VectorObject): VectorMatrix => { const cached = worldCache.get(object.id); if (cached) return cached; if (worldStack.has(object.id) || worldStack.size > SVG_LIMITS.depth) throw new Error('SVG 객체 계층이 순환하거나 너무 깊습니다.'); worldStack.add(object.id); const result = object.parentId ? multiplyMatrices(world(byId.get(object.parentId)!), object.transform) : object.transform; worldStack.delete(object.id); worldCache.set(object.id, result); return result; };
  objects.forEach(world);
  const excluded = new Set<string>(), referenceVisited = new Set<string>(), referenceStack = new Set<string>();
  const inspectReferences = (object: VectorObject) => { if (referenceStack.has(object.id) || referenceStack.size > SVG_LIMITS.depth) throw new Error('SVG 클리핑·마스크 참조가 순환합니다.'); if (referenceVisited.has(object.id)) return; referenceStack.add(object.id); for (const id of [object.clipPathId, object.maskId, ...(descendants.get(object.id) ?? []).map(child => child.id)]) if (id) { const referenced = byId.get(id); if (!referenced) throw new Error('SVG 참조 객체가 없습니다.'); inspectReferences(referenced); } referenceStack.delete(object.id); referenceVisited.add(object.id); };
  objects.forEach(inspectReferences);
  const excludeTree = (id: string, stack = new Set<string>()) => { if (stack.has(id)) throw new Error('SVG 참조가 순환합니다.'); if (excluded.has(id)) return; if (!byId.has(id)) throw new Error('SVG 클리핑·마스크 참조가 없습니다.'); stack.add(id); excluded.add(id); for (const child of descendants.get(id) ?? []) excludeTree(child.id, stack); stack.delete(id); };
  for (const object of objects) for (const id of [object.clipPathId, object.maskId]) if (id) excludeTree(id);
  let included: Set<string> | undefined;
  if (options.selection) {
    included = new Set(); const addChildren = (id: string) => { if (included!.has(id)) return; const object = byId.get(id); if (!object) return; included!.add(id); for (const child of descendants.get(id) ?? []) addChildren(child.id); };
    for (const id of options.selection) { addChildren(id); let object = byId.get(id); while (object?.parentId) { included.add(object.parentId); object = byId.get(object.parentId); } }
  }
  const definitions: string[] = [];
  const safeColor = (color: string) => { if (!/^#[\da-f]{6}$/i.test(color)) throw new Error('SVG 색상은 HEX RGB여야 합니다.'); return color; };
  const paint = (value: VectorPaint, id: string): { value: string; alpha?: number } => {
    if (value.type === 'none') return { value: 'none' };
    if (value.type === 'solid') return { value: safeColor(value.color), alpha: opacity(String(value.opacity)) };
    if (value.stops.length > SVG_LIMITS.stops || !value.stops.length || !['objectBoundingBox', 'userSpaceOnUse'].includes(value.units)) throw new Error('SVG 그라디언트가 잘못되었습니다.');
    const attributes = value.type === 'linear' ? `x1="${fmt(value.x1)}" y1="${fmt(value.y1)}" x2="${fmt(value.x2)}" y2="${fmt(value.y2)}"` : `cx="${fmt(value.cx)}" cy="${fmt(value.cy)}" r="${fmt(value.r)}" fx="${fmt(value.fx)}" fy="${fmt(value.fy)}"`;
    definitions.push(`<${value.type === 'linear' ? 'linearGradient' : 'radialGradient'} id="${id}" gradientUnits="${value.units}" gradientTransform="${matrixText(value.transform)}" ${attributes}>${value.stops.map(stop => `<stop offset="${fmt(opacity(String(stop.offset)))}" stop-color="${safeColor(stop.color)}" stop-opacity="${fmt(opacity(String(stop.opacity)))}"/>`).join('')}</${value.type === 'linear' ? 'linearGradient' : 'radialGradient'}>`);
    return { value: `url(#${id})` };
  };
  const renderStack = new Set<string>();
  const render = (object: VectorObject, definition = false, override?: VectorMatrix): string => {
    if (!definition && (excluded.has(object.id) || (included && !included.has(object.id)))) return '';
    if (renderStack.has(object.id) || renderStack.size > SVG_LIMITS.depth) throw new Error('SVG 정의가 순환합니다.'); renderStack.add(object.id);
    const index = indices.get(object.id)!, fill = paint(object.fill, `paint-${index}-fill`), stroke = paint(object.stroke.paint, `paint-${index}-stroke`);
    let attributes = `data-vector-object="${escaped(object.id)}" data-name="${escaped(object.name)}" transform="${matrixText(override ?? object.transform)}" opacity="${fmt(opacity(String(object.opacity)))}" fill="${fill.value}"${fill.alpha === undefined ? '' : ` fill-opacity="${fmt(fill.alpha)}"`} stroke="${stroke.value}"${stroke.alpha === undefined ? '' : ` stroke-opacity="${fmt(stroke.alpha)}"`} stroke-width="${fmt(object.stroke.width)}" stroke-linecap="${escaped(object.stroke.lineCap)}" stroke-linejoin="${escaped(object.stroke.lineJoin)}" stroke-miterlimit="${fmt(object.stroke.miterLimit)}"${object.stroke.dash.length ? ` stroke-dasharray="${object.stroke.dash.map(fmt).join(' ')}" stroke-dashoffset="${fmt(object.stroke.dashOffset)}"` : ''}${object.visible ? '' : ' display="none"'}${object.locked ? ' data-vector-locked="true"' : ''}`;
    for (const [kind, id] of [['clip', object.clipPathId], ['mask', object.maskId]] as const) if (id) {
      const source = byId.get(id); if (!source) throw new Error('SVG 클리핑·마스크 객체가 없습니다.'); const definitionId = `${kind}-${index}`;
      if (renderStack.has(id)) throw new Error('SVG 클리핑·마스크 참조가 순환합니다.');
      const inverseTarget = invertMatrix(world(object)), relative = multiplyMatrices(inverseTarget, world(source));
      const content = kind === 'clip' && source.type === 'group' && !source.clipPathId && !source.maskId ? (descendants.get(source.id) ?? []).map(child => render(child, true)).join('') : render(source, true, relative);
      const corners = [{ x: artboard.x, y: artboard.y }, { x: artboard.x + artboard.width, y: artboard.y }, { x: artboard.x, y: artboard.y + artboard.height }, { x: artboard.x + artboard.width, y: artboard.y + artboard.height }].map(point => applyMatrix(inverseTarget, point));
      const minX = Math.min(...corners.map(point => point.x)), minY = Math.min(...corners.map(point => point.y)), maxX = Math.max(...corners.map(point => point.x)), maxY = Math.max(...corners.map(point => point.y));
      definitions.push(kind === 'clip' ? `<clipPath id="${definitionId}" data-name="${escaped(source.name)}" clipPathUnits="userSpaceOnUse"${source.type === 'group' && !source.clipPathId && !source.maskId ? ` transform="${matrixText(relative)}"` : ''}>${content}</clipPath>` : `<mask id="${definitionId}" mask-type="alpha" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="${fmt(minX)}" y="${fmt(minY)}" width="${fmt(maxX - minX)}" height="${fmt(maxY - minY)}">${content}</mask>`);
      attributes += kind === 'clip' ? ` clip-path="url(#${definitionId})"` : ` mask="url(#${definitionId})"`;
    }
    let output: string;
    if (object.type === 'group') output = `<g ${attributes}>${(descendants.get(object.id) ?? []).map(child => render(child, definition)).join('')}</g>`;
    else if (object.type === 'path' && object.geometry) output = `<path ${attributes} fill-rule="${object.geometry.fillRule}" clip-rule="${object.geometry.fillRule}" d="${escaped(geometryToPathData(object.geometry))}"/>`;
    else if (object.type === 'text' && object.text) {
      const text = object.text;
      if (text.content.length > SVG_LIMITS.text) throw new Error('SVG 문자가 너무 많습니다.');
      const lines = text.content.split('\n'); output = `<text ${attributes} font-family="${escaped(text.fontFamily)}" font-size="${fmt(text.fontSize)}" font-weight="${fmt(text.fontWeight)}" letter-spacing="${fmt(text.letterSpacing)}" text-anchor="${escaped(text.alignment)}" xml:space="preserve">${lines.length === 1 ? escaped(text.content) : lines.map((line, index) => `<tspan x="0" dy="${fmt(index ? text.fontSize * text.lineHeight : 0)}">${escaped(line)}</tspan>`).join('')}</text>`;
    } else if (object.type === 'image' && object.image) {
      const asset = assets[object.image.assetId]; if (!asset || asset.mime !== 'image/png') throw new Error('SVG 이미지 에셋이 없습니다.'); decodePNG(asset.data);
      output = `<image ${attributes} width="${fmt(object.image.width)}" height="${fmt(object.image.height)}" preserveAspectRatio="none" href="${asset.data}"/>`;
    } else throw new Error('SVG 객체 구조가 잘못되었습니다.');
    renderStack.delete(object.id); return output;
  };
  const content = (descendants.get(null) ?? []).map(object => render(object)).join('');
  const background = options.background && artboard.background ? `<rect x="${fmt(artboard.x)}" y="${fmt(artboard.y)}" width="${fmt(artboard.width)}" height="${fmt(artboard.height)}" fill="${safeColor(artboard.background)}"/>` : '';
  const output = `<svg xmlns="${SVG_NS}" width="${fmt(artboard.width)}" height="${fmt(artboard.height)}" viewBox="${[artboard.x, artboard.y, artboard.width, artboard.height].map(fmt).join(' ')}"><title>${escaped(document.name)}</title>${definitions.length ? `<defs>${definitions.join('')}</defs>` : ''}${background}${content}</svg>`;
  if (new TextEncoder().encode(output).length > SVG_LIMITS.bytes) throw new Error('내보낼 SVG가 12 MB를 초과합니다.');
  return output;
}
