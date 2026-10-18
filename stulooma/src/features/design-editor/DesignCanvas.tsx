import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Grid2X2, Magnet, Maximize2, Minus, Plus } from 'lucide-react';
import { composeRegion } from '../../core/textures';
import { useStudio } from '../../state/studio';
import type { ArtworkLayer } from '../../types/project';
import './design-canvas.css';

const TEXTURE_SIZE = 1024;
const MIN_ZOOM = .25;
const MAX_ZOOM = 4;
type Point = { x: number; y: number };
type Guide = { axis: 'x' | 'y'; position: number };
type TransformDrag = { kind: 'transform'; id: string; mode: 'move' | 'scale' | 'rotate'; start: Point; layer: ArtworkLayer };
type PanDrag = { kind: 'pan'; start: Point; pan: Point };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
function preference(name: string, fallback: boolean): boolean {
  try { const value = localStorage.getItem(`stulooma.canvas.${name}`); return value === null ? fallback : value === 'true'; }
  catch { return fallback; }
}
function local(layer: ArtworkLayer, point: Point): Point {
  const angle = -layer.rotation * Math.PI / 180;
  const dx = point.x - layer.x, dy = point.y - layer.y;
  return { x: dx * Math.cos(angle) - dy * Math.sin(angle), y: dx * Math.sin(angle) + dy * Math.cos(angle) };
}
function halfBounds(layer: ArtworkLayer): Point {
  const angle = layer.rotation * Math.PI / 180;
  return {
    x: (Math.abs(Math.cos(angle)) * layer.width + Math.abs(Math.sin(angle)) * layer.height) / 2,
    y: (Math.abs(Math.sin(angle)) * layer.width + Math.abs(Math.cos(angle)) * layer.height) / 2,
  };
}

export function DesignCanvas() {
  const { project, selectedLayer, selectLayer, execute, beginGroup, endGroup } = useStudio();
  const container = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLParagraphElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<TransformDrag | PanDrag | null>(null);
  const spacePressed = useRef(false);
  const nudgeGroup = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [width, setWidth] = useState(512);
  const [fitSize, setFitSize] = useState(256);
  const [grid, setGrid] = useState(() => preference('grid', true));
  const [snapping, setSnapping] = useState(() => preference('snap', false));
  const [guides, setGuides] = useState<Guide[]>([]);
  const [texture, setTexture] = useState<HTMLCanvasElement | null>(null);
  const view = useRef({ zoom, pan });
  view.current = { zoom, pan };
  const layers = project.layers.filter(layer => layer.regionId === project.activeRegion && layer.visible);

  const finishDrag = useCallback(() => {
    if (drag.current?.kind === 'transform') endGroup();
    drag.current = null;
    setPanning(false);
    setGuides([]);
  }, [endGroup]);

  const fit = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);
  const zoomAt = useCallback((next: number, client?: Point) => {
    const current = view.current;
    const nextZoom = clamp(next, MIN_ZOOM, MAX_ZOOM);
    const rect = viewport.current?.getBoundingClientRect();
    const anchor = rect && client
      ? { x: client.x - rect.left - rect.width / 2, y: client.y - rect.top - rect.height / 2 }
      : { x: 0, y: 0 };
    const ratio = nextZoom / current.zoom;
    const nextPan = {
      x: anchor.x - (anchor.x - current.pan.x) * ratio,
      y: anchor.y - (anchor.y - current.pan.y) * ratio,
    };
    view.current = { zoom: nextZoom, pan: nextPan };
    setZoom(nextZoom);
    setPan(nextPan);
  }, []);

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => {
      const outerHeight = (child: HTMLElement | null) => {
        if (!child) return 0;
        const style = getComputedStyle(child);
        if (style.display === 'none') return 0;
        return child.getBoundingClientRect().height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
      };
      const style = getComputedStyle(element);
      const contentWidth = element.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      const contentHeight = element.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
      const availableHeight = contentHeight - outerHeight(toolbar.current) - outerHeight(ruler.current) - outerHeight(hint.current);
      const size = Math.max(1, Math.floor(Math.min(contentWidth, availableHeight)));
      setFitSize(previous => previous === size ? previous : size);
    };
    measure();
    // Observe both the available flex space and controls: compact widths can
    // wrap the toolbar or hint, and font loading can change their actual height.
    const observer = new ResizeObserver(measure);
    for (const child of [element, toolbar.current, ruler.current, hint.current]) {
      if (child) observer.observe(child);
    }
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const size = entries[0]?.contentRect.width;
      if (size) setWidth(size);
    });
    observer.observe(element);
    // Only wheel gestures over this artboard are owned by the editor. A native
    // non-passive listener prevents browser zoom from moving the whole shell.
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (drag.current) return;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? element.clientHeight : 1;
      if (event.ctrlKey || event.metaKey) {
        zoomAt(view.current.zoom * Math.exp(-event.deltaY * unit * .005), { x: event.clientX, y: event.clientY });
      } else {
        const nextPan = {
          x: view.current.pan.x - (event.shiftKey ? event.deltaY : event.deltaX) * unit,
          y: view.current.pan.y - (event.shiftKey ? 0 : event.deltaY) * unit,
        };
        view.current = { ...view.current, pan: nextPan };
        setPan(nextPan);
      }
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); element.removeEventListener('wheel', wheel); };
  }, [zoomAt]);

  useEffect(() => {
    try {
      localStorage.setItem('stulooma.canvas.grid', String(grid));
      localStorage.setItem('stulooma.canvas.snap', String(snapping));
    } catch { /* Editing remains available when local preferences cannot be stored. */ }
  }, [grid, snapping]);
  useEffect(() => { fit(); finishDrag(); }, [project.id, fit, finishDrag]);
  useEffect(() => { finishDrag(); }, [project.activeRegion, finishDrag]);
  useEffect(() => {
    const releaseKeys = () => {
      spacePressed.current = false;
      setSpaceHeld(false);
      if (nudgeGroup.current) { nudgeGroup.current = false; endGroup(); }
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') { spacePressed.current = false; setSpaceHeld(false); }
      if (event.key.startsWith('Arrow') && nudgeGroup.current) { nudgeGroup.current = false; endGroup(); }
    };
    const blur = () => { releaseKeys(); finishDrag(); };
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', blur);
    return () => {
      releaseKeys();
      finishDrag();
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur);
    };
  }, [endGroup, finishDrag]);

  useEffect(() => {
    let alive = true;
    composeRegion(project, project.activeRegion, TEXTURE_SIZE).then(result => {
      if (alive) setTexture(result);
    }).catch(() => { /* Import and viewer error surfaces report source decode failures. */ });
    return () => { alive = false; };
  }, [project.layers, project.regions, project.assets, project.activeRegion, project.vectorDocuments]);

  useEffect(() => {
    if (!texture || !canvas.current) return;
    const ctx = canvas.current.getContext('2d');
    if (!ctx) return;
    const unit = TEXTURE_SIZE / Math.max(1, width * zoom);
    ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    ctx.drawImage(texture, 0, 0);
    if (grid) {
      ctx.strokeStyle = '#ffffff28';
      ctx.lineWidth = unit;
      for (let i = 0; i <= TEXTURE_SIZE; i += 128) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, TEXTURE_SIZE); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(TEXTURE_SIZE, i); ctx.stroke();
      }
    }
    for (const guide of guides) {
      ctx.strokeStyle = '#ec80e9';
      ctx.lineWidth = 1.25 * unit;
      ctx.setLineDash([5 * unit, 4 * unit]);
      ctx.beginPath();
      if (guide.axis === 'x') { ctx.moveTo(guide.position * TEXTURE_SIZE, 0); ctx.lineTo(guide.position * TEXTURE_SIZE, TEXTURE_SIZE); }
      else { ctx.moveTo(0, guide.position * TEXTURE_SIZE); ctx.lineTo(TEXTURE_SIZE, guide.position * TEXTURE_SIZE); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    const layer = project.layers.find(item => item.id === selectedLayer && item.regionId === project.activeRegion && item.visible);
    if (!layer) return;
    ctx.save();
    ctx.translate(layer.x * TEXTURE_SIZE, layer.y * TEXTURE_SIZE);
    ctx.rotate(layer.rotation * Math.PI / 180);
    const w = layer.width * TEXTURE_SIZE, h = layer.height * TEXTURE_SIZE;
    ctx.strokeStyle = layer.locked ? '#a5afb7' : '#8ce0c2';
    ctx.lineWidth = 1.5 * unit;
    if (layer.locked) ctx.setLineDash([5 * unit, 4 * unit]);
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.setLineDash([]);
    if (!layer.locked) {
      ctx.fillStyle = '#f2faf7';
      const handle = 8 * unit;
      for (const [x, y] of [[-w / 2, -h / 2], [w / 2, -h / 2], [-w / 2, h / 2], [w / 2, h / 2]]) {
        ctx.fillRect(x - handle / 2, y - handle / 2, handle, handle);
        ctx.strokeRect(x - handle / 2, y - handle / 2, handle, handle);
      }
      const rotateOffset = 48 / zoom;
      ctx.beginPath(); ctx.moveTo(0, -h / 2); ctx.lineTo(0, -h / 2 - rotateOffset); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -h / 2 - rotateOffset, 4.5 * unit, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }, [texture, project, selectedLayer, grid, guides, zoom, width]);

  function point(event: React.PointerEvent<HTMLDivElement>): Point {
    const rect = canvas.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  }
  function down(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    canvas.current?.focus({ preventScroll: true });
    if (event.button === 1 || spacePressed.current) {
      drag.current = { kind: 'pan', start: { x: event.clientX, y: event.clientY }, pan: { ...view.current.pan } };
      setPanning(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const p = point(event);
    const selected = layers.find(layer => layer.id === selectedLayer && !layer.locked);
    let hit: ArtworkLayer | undefined;
    let mode: TransformDrag['mode'] = 'move';
    if (selected) {
      const q = local(selected, p);
      const tolerance = 11 / Math.max(1, width * zoom);
      if (Math.hypot(q.x, q.y + selected.height / 2 + 48 / TEXTURE_SIZE / zoom) < tolerance) { hit = selected; mode = 'rotate'; }
      else if (Math.abs(Math.abs(q.x) - selected.width / 2) < tolerance && Math.abs(Math.abs(q.y) - selected.height / 2) < tolerance) { hit = selected; mode = 'scale'; }
    }
    hit ??= [...layers].reverse().find(layer => {
      const q = local(layer, p);
      return Math.abs(q.x) <= layer.width / 2 && Math.abs(q.y) <= layer.height / 2;
    });
    selectLayer(hit?.id ?? null);
    if (hit && !hit.locked) {
      beginGroup();
      drag.current = { kind: 'transform', id: hit.id, mode, start: p, layer: { ...hit } };
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }
  function snapPosition(layer: ArtworkLayer, next: Point): { point: Point; guides: Guide[] } {
    const bounds = halfBounds(layer);
    const threshold = 6 / Math.max(1, width * zoom);
    const targets: Record<'x' | 'y', number[]> = { x: [0, .5, 1], y: [0, .5, 1] };
    for (const other of layers) {
      if (other.id === layer.id) continue;
      const half = halfBounds(other);
      targets.x.push(other.x - half.x, other.x, other.x + half.x);
      targets.y.push(other.y - half.y, other.y, other.y + half.y);
    }
    const result = { ...next };
    const nextGuides: Guide[] = [];
    for (const axis of ['x', 'y'] as const) {
      let best = threshold, correction = 0, guide: number | undefined;
      for (const anchor of [next[axis], next[axis] - bounds[axis], next[axis] + bounds[axis]]) {
        for (const target of targets[axis]) {
          const delta = target - anchor;
          if (Math.abs(delta) < best) { best = Math.abs(delta); correction = delta; guide = target; }
        }
      }
      result[axis] = clamp(result[axis] + correction, -1, 2);
      if (guide !== undefined) nextGuides.push({ axis, position: guide });
    }
    return { point: result, guides: nextGuides };
  }
  function move(event: React.PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current) return;
    if (current.kind === 'pan') {
      const nextPan = { x: current.pan.x + event.clientX - current.start.x, y: current.pan.y + event.clientY - current.start.y };
      view.current = { ...view.current, pan: nextPan };
      setPan(nextPan);
      return;
    }
    const p = point(event);
    let patch: Partial<ArtworkLayer>;
    if (current.mode === 'move') {
      const next = { x: clamp(current.layer.x + p.x - current.start.x, -1, 2), y: clamp(current.layer.y + p.y - current.start.y, -1, 2) };
      const result = snapping && !event.altKey ? snapPosition(current.layer, next) : { point: next, guides: [] };
      patch = result.point;
      setGuides(result.guides);
    } else if (current.mode === 'rotate') {
      const rotation = Math.atan2(p.y - current.layer.y, p.x - current.layer.x) * 180 / Math.PI + 90;
      patch = { rotation: event.shiftKey ? Math.round(rotation / 15) * 15 : rotation };
    } else {
      const before = Math.hypot(current.start.x - current.layer.x, current.start.y - current.layer.y);
      const factor = Math.hypot(p.x - current.layer.x, p.y - current.layer.y) / Math.max(.01, before);
      patch = { width: clamp(current.layer.width * factor, .03, 2), height: clamp(current.layer.height * factor, .03, 2) };
      if (current.layer.type === 'text') patch.fontSize = clamp((current.layer.fontSize ?? 100) * factor, 8, 1024);
    }
    execute({ id: 'artwork.update', layerId: current.id, patch });
  }
  function keyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.target !== canvas.current && event.target !== viewport.current) return;
    const modifier = event.ctrlKey || event.metaKey;
    let handled = true;
    if (event.code === 'Space' && !modifier) { spacePressed.current = true; setSpaceHeld(true); }
    else if (modifier && event.key === '0') fit();
    else if (!modifier && (event.key === '+' || event.key === '=')) zoomAt(zoom * 1.25);
    else if (!modifier && event.key === '-') zoomAt(zoom / 1.25);
    else if (!modifier && event.key.toLowerCase() === 'g') { if (!event.repeat) setGrid(value => !value); }
    else if (!modifier && event.key.toLowerCase() === 's') { if (!event.repeat) setSnapping(value => !value); }
    else if (!modifier && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      const state = useStudio.getState();
      const layer = state.project.layers.find(item => item.id === state.selectedLayer && item.visible && !item.locked);
      if (layer) {
        if (!nudgeGroup.current) { nudgeGroup.current = true; beginGroup(); }
        const step = event.shiftKey ? .01 : .001;
        execute({ id: 'artwork.update', layerId: layer.id, patch: {
          x: clamp(layer.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), -1, 2),
          y: clamp(layer.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0), -1, 2),
        } });
      }
    } else handled = false;
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  }

  return <div ref={container} className="design-canvas-wrap design-editor" onKeyDown={keyDown} style={{ '--design-canvas-size': `${fitSize}px` } as React.CSSProperties}>
    <div ref={toolbar} className="design-canvas-toolbar" role="toolbar" aria-label="2D 캔버스 보기">
      <div className="design-zoom-tools">
        <button type="button" title="2D 축소 (−)" aria-label="2D 축소" disabled={zoom <= MIN_ZOOM} onClick={() => zoomAt(zoom / 1.25)}><Minus size={14}/></button>
        <output aria-label="2D 확대 비율">{Math.round(zoom * 100)}%</output>
        <button type="button" title="2D 확대 (+)" aria-label="2D 확대" disabled={zoom >= MAX_ZOOM} onClick={() => zoomAt(zoom * 1.25)}><Plus size={14}/></button>
        <button type="button" title="화면에 맞춤 (Ctrl/⌘+0)" aria-label="2D 화면에 맞춤" onClick={fit}><Maximize2 size={13}/></button>
      </div>
      <div className="design-view-tools">
        <button type="button" title="그리드 표시 (G)" aria-label="그리드 표시" aria-pressed={grid} onClick={() => setGrid(value => !value)}><Grid2X2 size={14}/></button>
        <button type="button" title="스냅 (S) · Alt로 일시 해제" aria-label="스냅" aria-pressed={snapping} onClick={() => setSnapping(value => !value)}><Magnet size={14}/></button>
      </div>
    </div>
    <div ref={ruler} className="canvas-ruler"><span>0</span><span>패널 UV · 0—1</span><span>1</span></div>
    <div ref={viewport} className={`design-canvas-viewport${spaceHeld ? ' hand-tool' : ''}${panning ? ' is-panning' : ''}`} data-testid="design-viewport" onPointerDown={down} onPointerMove={move} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}>
      <canvas ref={canvas} width={TEXTURE_SIZE} height={TEXTURE_SIZE} tabIndex={0} aria-label="2D 디자인 캔버스" aria-describedby="design-canvas-help" data-testid="design-canvas" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}/>
      {guides.length > 0 && <span className="design-snap-status" role="status" data-testid="snap-indicator">스마트 가이드 · 정렬</span>}
    </div>
    <p ref={hint} className="canvas-hint" id="design-canvas-help">Space+드래그 이동 · Ctrl/⌘+휠 확대<br/>Shift+회전 15° · 방향키 0.1% / Shift 1%</p>
  </div>;
}
