import { parse, type Font, type PathCommand } from 'opentype.js';
import type { VectorAnchor, VectorContour, VectorPath, VectorText } from '../../types/vector';

export const VECTOR_FONT_FAMILY = 'STULOOMA Noto Sans KR';
export const VECTOR_FONT_URL = '/fonts/NotoSansCJKkr-Regular.otf';
let fontPromise: Promise<Font> | undefined;

/** One bundled, redistribution-licensed font is shared by editable text and outlines. */
async function localFont(): Promise<Font> {
  if (!fontPromise) {
    fontPromise = (async () => {
      const response = await fetch(VECTOR_FONT_URL);
      if (!response.ok) throw new Error('로컬 벡터 글꼴을 읽을 수 없습니다.');
      const bytes = await response.arrayBuffer();
      const parsed = parse(bytes);
      if (typeof FontFace !== 'undefined' && typeof document !== 'undefined') {
        const face = new FontFace(VECTOR_FONT_FAMILY, bytes, { weight: '400', style: 'normal' });
        await face.load();
        document.fonts.add(face);
      }
      return parsed;
    })();
    fontPromise.catch(() => { fontPromise = undefined; });
  }
  return fontPromise;
}

export async function ensureVectorFont(): Promise<void> { await localFont(); }

function outlineCommands(commands: PathCommand[], prefix: string): VectorContour[] {
  const contours: VectorContour[] = [];
  let current: VectorContour | undefined;
  let count = 0;
  const point = (x: number, y: number): VectorAnchor => ({ id: `${prefix}-${count++}`, x, y, kind: 'corner' });
  const close = () => {
    if (!current) return;
    // CFF outlines can omit explicit Z commands; every glyph contour is closed.
    current.closed = true;
    const first = current.anchors[0];
    const last = current.anchors.at(-1)!;
    if (current.anchors.length > 1 && Math.abs(first.x - last.x) < 1e-8 && Math.abs(first.y - last.y) < 1e-8) {
      if (last.in) first.in = last.in;
      current.anchors.pop();
    }
    current = undefined;
  };
  for (const command of commands) {
    if (command.type === 'M') {
      close();
      current = { closed: false, anchors: [point(command.x, command.y)] };
      contours.push(current);
    } else if (command.type === 'Z') {
      close();
    } else if (current) {
      const previous = current.anchors.at(-1)!;
      const next = point(command.x, command.y);
      if (command.type === 'C') {
        previous.out = { x: command.x1, y: command.y1 };
        next.in = { x: command.x2, y: command.y2 };
      } else if (command.type === 'Q') {
        previous.out = { x: previous.x + 2 / 3 * (command.x1 - previous.x), y: previous.y + 2 / 3 * (command.y1 - previous.y) };
        next.in = { x: next.x + 2 / 3 * (command.x1 - next.x), y: next.y + 2 / 3 * (command.y1 - next.y) };
      }
      current.anchors.push(next);
    }
  }
  close();
  return contours.filter(contour => contour.anchors.length > 1);
}

/** Real editable glyph contours. Unsupported fonts are rejected, never replaced by an image. */
export async function textToPath(text: VectorText): Promise<VectorPath> {
  if (text.fontFamily !== VECTOR_FONT_FAMILY || text.fontWeight !== 400) {
    throw new Error('윤곽선 변환은 로컬 Noto Sans KR Regular(400) 글꼴에서 지원합니다.');
  }
  const font = await localFont();
  const options = { kerning: true, letterSpacing: text.letterSpacing / text.fontSize, features: { liga: false, rlig: false } };
  const contours: VectorContour[] = [];
  const lines = text.content.split('\n');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    for (const glyph of font.stringToGlyphs(line)) {
      if (glyph.index === 0) throw new Error('선택한 글꼴에 없는 문자가 있어 윤곽선으로 변환할 수 없습니다.');
    }
    // opentype includes the final tracking advance; alignment uses only gaps between glyphs.
    const measured = font.getAdvanceWidth(line, text.fontSize, options) - (line.length ? text.letterSpacing : 0);
    const x = text.alignment === 'middle' ? -measured / 2 : text.alignment === 'end' ? -measured : 0;
    const y = lineIndex * text.fontSize * text.lineHeight;
    const path = font.getPath(line, x, y, text.fontSize, options);
    contours.push(...outlineCommands(path.commands, `glyph-${lineIndex}`));
  }
  return { contours, fillRule: 'nonzero' };
}
