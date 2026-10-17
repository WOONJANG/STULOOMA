import { useEffect, useRef } from 'react';
import { composeRegion } from '../../core/textures';
import { useStudio } from '../../state/studio';
import type { ArtworkLayer } from '../../types/project';

export function DesignCanvas() {
  const { project, selectedLayer, selectLayer, execute, beginGroup, endGroup } = useStudio();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: string; mode: 'move' | 'scale' | 'rotate'; x: number; y: number; layer: ArtworkLayer } | null>(null);
  const layers = project.layers.filter(l => l.regionId === project.activeRegion && l.visible);
  useEffect(() => {
    let alive = true;
    composeRegion(project, project.activeRegion, 1024).then(texture => {
      if (!alive || !canvas.current) return;
      const ctx = canvas.current.getContext('2d')!; ctx.clearRect(0, 0, 1024, 1024); ctx.drawImage(texture, 0, 0);
      ctx.strokeStyle = '#ffffff20'; ctx.lineWidth = 1;
      for (let i = 0; i <= 1024; i += 128) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 1024); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(1024, i); ctx.stroke(); }
      const layer = layers.find(l => l.id === selectedLayer);
      if (layer) {
        ctx.save(); ctx.translate(layer.x * 1024, layer.y * 1024); ctx.rotate(layer.rotation * Math.PI / 180);
        const w = layer.width * 1024, h = layer.height * 1024;
        ctx.strokeStyle = '#36b898'; ctx.lineWidth = 3; ctx.setLineDash([10, 5]); ctx.strokeRect(-w / 2, -h / 2, w, h); ctx.setLineDash([]);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#18876f';
        for (const [x, y] of [[-w/2,-h/2],[w/2,-h/2],[-w/2,h/2],[w/2,h/2]]) { ctx.fillRect(x-8,y-8,16,16); ctx.strokeRect(x-8,y-8,16,16); }
        ctx.beginPath(); ctx.moveTo(0,-h/2); ctx.lineTo(0,-h/2-48); ctx.stroke(); ctx.beginPath(); ctx.arc(0,-h/2-48,10,0,Math.PI*2); ctx.fill(); ctx.stroke(); ctx.restore();
      }
    }).catch(() => { /* source imports and viewer surface decode failures */ });
    return () => { alive = false; };
  }, [project, selectedLayer]);
  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const r = event.currentTarget.getBoundingClientRect(); return { x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height };
  }
  function local(layer: ArtworkLayer, x: number, y: number) {
    const angle = -layer.rotation * Math.PI / 180, dx = x - layer.x, dy = y - layer.y;
    return { x: dx * Math.cos(angle) - dy * Math.sin(angle), y: dx * Math.sin(angle) + dy * Math.cos(angle) };
  }
  function down(event: React.PointerEvent<HTMLCanvasElement>) {
    const p = point(event); const selected = layers.find(l => l.id === selectedLayer && !l.locked);
    let hit: ArtworkLayer | undefined; let mode: 'move' | 'scale' | 'rotate' = 'move';
    if (selected) {
      const q = local(selected, p.x, p.y);
      if (Math.hypot(q.x, q.y + selected.height/2 + 48/1024) < .035) { hit = selected; mode = 'rotate'; }
      else if (Math.abs(Math.abs(q.x)-selected.width/2) < .035 && Math.abs(Math.abs(q.y)-selected.height/2) < .035) { hit = selected; mode = 'scale'; }
    }
    hit ??= [...layers].reverse().find(layer => { const q = local(layer, p.x, p.y); return Math.abs(q.x) <= layer.width/2 && Math.abs(q.y) <= layer.height/2; });
    selectLayer(hit?.id ?? null);
    if (hit && !hit.locked) { beginGroup(); drag.current = { id: hit.id, mode, ...p, layer: { ...hit } }; event.currentTarget.setPointerCapture(event.pointerId); }
  }
  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current; if (!d) return; const p = point(event);
    let patch: Partial<ArtworkLayer>;
    if (d.mode === 'move') patch = { x: Math.max(-1,Math.min(2,d.layer.x + p.x - d.x)), y: Math.max(-1,Math.min(2,d.layer.y + p.y - d.y)) };
    else if (d.mode === 'rotate') patch = { rotation: Math.atan2(p.y-d.layer.y,p.x-d.layer.x)*180/Math.PI+90 };
    else { const before = Math.hypot(d.x-d.layer.x,d.y-d.layer.y); const factor = Math.hypot(p.x-d.layer.x,p.y-d.layer.y)/Math.max(.01,before); patch = { width: Math.max(.03, Math.min(2, d.layer.width*factor)), height: Math.max(.03, Math.min(2, d.layer.height*factor)) }; }
    execute({ id: 'artwork.update', layerId: d.id, patch });
  }
  function up() { if (drag.current) { drag.current = null; endGroup(); } }
  return <div className="design-canvas-wrap"><div className="canvas-ruler"><span>0</span><span>패널 UV · 0—1</span><span>1</span></div><canvas ref={canvas} width={1024} height={1024} aria-label="2D 디자인 캔버스" data-testid="design-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}/><p className="canvas-hint">드래그하여 이동 · 모서리로 크기 조절 · 위쪽 핸들로 회전</p></div>;
}
