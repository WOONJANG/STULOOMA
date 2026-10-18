import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Circle,
  Copy,
  Download,
  Eye,
  EyeOff,
  Hand,
  Hexagon,
  Layers,
  LockKeyhole,
  Magnet,
  Maximize2,
  Minus,
  MousePointer2,
  PenTool,
  Plus,
  RotateCcw,
  Square,
  Star,
  Trash2,
  Type,
  Ungroup,
  UnlockKeyhole,
  Upload,
  ZoomIn,
} from "lucide-react";
import { useStudio } from "../../state/studio";
import { TextField } from "../../components/NumberField";
import {
  createVectorDocument,
  createVectorObject,
} from "../../core/vector/document";
import {
  addAnchor,
  applyMatrix,
  createCompoundPath,
  ellipsePath,
  identityMatrix,
  invertMatrix,
  joinPaths,
  linePath,
  multiplyMatrices,
  polygonPath,
  rectanglePath,
  releaseCompoundPath,
  removeAnchor,
  reversePath,
  rotationMatrix,
  roundedRectanglePath,
  scaleMatrix,
  setPathClosed,
  splitPath,
  starPath,
  transformPath,
  translationMatrix,
} from "../../core/vector/geometry";
import { booleanOperation } from "../../core/vector/boolean";
import { exportSVG, importSVG } from "../../core/vector/svg";
import { renderVectorDocument } from "../../core/vector/render";
import {
  ensureVectorFont,
  textToPath,
  VECTOR_FONT_FAMILY,
} from "../../core/vector/text";
import { importPNG } from "../../core/import/png";
import type { AssetRecord } from "../../types/project";
import type {
  VectorAnchor,
  VectorBounds,
  VectorDocument,
  VectorMatrix,
  VectorObject,
  VectorPaint,
  VectorPath,
  VectorPoint,
} from "../../types/vector";
import {
  bounds,
  copy,
  descendants,
  roots,
  unionBounds,
  unlocked,
  VectorScene,
  worldMatrix,
} from "./scene";
import "./vector-studio.css";

export interface VectorStudioHandle {
  command(id: string): void;
  importSVG(source: string, name?: string): void;
}
interface Props {
  onSelectionChange?: (count: number, canPaste: boolean) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onExport?: (
    kind: "svg" | "png",
    data: Uint8Array,
    name: string,
  ) => Promise<boolean | void>;
}
type Tool =
  | "select"
  | "direct"
  | "pen"
  | "rect"
  | "roundrect"
  | "ellipse"
  | "line"
  | "polygon"
  | "star"
  | "text"
  | "hand"
  | "zoom";
type AnchorSelection = { objectId: string; contour: number; anchor: number };
type Drag =
  | { kind: "pan"; start: VectorPoint; pan: VectorPoint }
  | {
      kind: "marquee";
      start: VectorPoint;
      current: VectorPoint;
      additive: boolean;
    }
  | {
      kind: "transform";
      mode: "move" | "scale" | "rotate";
      start: VectorPoint;
      original: VectorDocument;
      ids: string[];
      bounds: VectorBounds;
      pivot: VectorPoint;
    }
  | {
      kind: "shape";
      start: VectorPoint;
      objectId: string;
      original: VectorDocument;
      tool: Tool;
    }
  | {
      kind: "anchor";
      start: VectorPoint;
      original: VectorDocument;
      points: AnchorSelection[];
      handle?: "in" | "out";
    }
  | {
      kind: "pen";
      objectId: string;
      contour: number;
      anchor: number;
      start: VectorPoint;
    };
const toolInfo: {
  id: Tool;
  label: string;
  key: string;
  icon: typeof Square;
}[] = [
  { id: "select", label: "선택", key: "V", icon: MousePointer2 },
  { id: "direct", label: "직접 선택", key: "A", icon: MousePointer2 },
  { id: "pen", label: "펜", key: "P", icon: PenTool },
  { id: "line", label: "직선", key: "\\", icon: Minus },
  { id: "rect", label: "사각형", key: "M", icon: Square },
  { id: "ellipse", label: "타원", key: "L", icon: Circle },
  { id: "roundrect", label: "둥근 사각형", key: "", icon: Square },
  { id: "polygon", label: "다각형", key: "", icon: Hexagon },
  { id: "star", label: "별", key: "", icon: Star },
  { id: "text", label: "문자", key: "T", icon: Type },
  { id: "hand", label: "손", key: "H", icon: Hand },
  { id: "zoom", label: "확대", key: "Z", icon: ZoomIn },
];
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const intersect = (a: VectorBounds, b: VectorBounds) =>
  a.x <= b.x + b.width &&
  a.x + a.width >= b.x &&
  a.y <= b.y + b.height &&
  a.y + a.height >= b.y;
const rectBetween = (a: VectorPoint, b: VectorPoint): VectorBounds => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(b.x - a.x),
  height: Math.abs(b.y - a.y),
});
const solid = (color: string): VectorPaint => ({
  type: "solid",
  color,
  opacity: 1,
});
const paintColor = (paint?: VectorPaint) =>
  paint?.type === "solid"
    ? paint.color
    : paint?.type === "linear" || paint?.type === "radial"
      ? (paint.stops[0]?.color ?? "#60d5b5")
      : "#60d5b5";
const fieldValue = (value: number) => Math.round(value * 100) / 100;
const inputTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !!target.closest('input,textarea,select,[contenteditable="true"]');

/** Keep incomplete signs/decimals out of document geometry until committed. */
function CoordinateField({ label, caption, value, onCommit }: {
  label: string;
  caption: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const displayed = fieldValue(value);
  const [draft, setDraft] = useState(String(displayed));
  useEffect(() => setDraft(String(displayed)), [displayed]);
  const commit = () => {
    const number = Number(draft);
    if (!draft.trim() || !Number.isFinite(number)) setDraft(String(displayed));
    else if (number !== displayed) onCommit(number);
  };
  return (
    <label>
      <span>{caption}</span>
      <input
        type="number"
        step="1"
        aria-label={label}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(String(displayed));
          }
        }}
      />
    </label>
  );
}

export const VectorStudio = forwardRef<VectorStudioHandle, Props>(
  function VectorStudio(
    { onSelectionChange, onError, onNotice, onExport },
    ref,
  ) {
    const { project, execute, beginGroup, endGroup } = useStudio();
    const [documentId, setDocumentId] = useState<string | null>(null);
    const [draft, setDraft] = useState(() =>
      createVectorDocument("벡터 디자인 1"),
    );
    const [artboardId, setArtboardId] = useState<string | null>(null);
    const [selection, setSelection] = useState<string[]>([]);
    const [anchorSelection, setAnchorSelection] = useState<AnchorSelection[]>(
      [],
    );
    const [tool, setTool] = useState<Tool>("select");
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState<VectorPoint>({ x: 0, y: 0 });
    const [viewportSize, setViewportSize] = useState({
      width: 600,
      height: 600,
    });
    const [grid, setGrid] = useState(false);
    const [snapping, setSnapping] = useState(true);
    const [snapGuides, setSnapGuides] = useState<{ x?: number; y?: number }>(
      {},
    );
    const [marquee, setMarquee] = useState<VectorBounds | null>(null);
    const [defaultFill, setDefaultFill] = useState("#55d5b0");
    const [defaultStroke, setDefaultStroke] = useState("#142b29");
    const [defaultStrokeWidth, setDefaultStrokeWidth] = useState(0);
    const [polygonSides, setPolygonSides] = useState(6);
    const [cornerRadius, setCornerRadius] = useState(48);
    const [menu, setMenu] = useState<string | null>(null);
    const [context, setContext] = useState<VectorPoint | null>(null);
    const [clipboardReady, setClipboardReady] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [spaceHeld, setSpaceHeld] = useState(false);
    const [bindingRegion, setBindingRegion] = useState(project.activeRegion);
    const workspace = useRef<HTMLDivElement>(null),
      viewport = useRef<HTMLDivElement>(null),
      svg = useRef<SVGSVGElement>(null),
      world = useRef<SVGGElement>(null),
      importInput = useRef<HTMLInputElement>(null),
      pngInput = useRef<HTMLInputElement>(null);
    const drag = useRef<Drag | null>(null),
      penId = useRef<string | null>(null),
      clipboard = useRef<{
        objects: VectorObject[];
        assets: AssetRecord[];
      } | null>(null),
      keyGroup = useRef(false);
    const documents = Object.values(project.vectorDocuments ?? {});
    const document =
      documents.find((item) => item.id === documentId) ?? documents[0] ?? draft;
    const artboard =
      document?.artboards.find((item) => item.id === artboardId) ??
      document?.artboards[0];
    const activeObjects =
      document?.objects.filter((item) => item.artboardId === artboard?.id) ??
      [];
    const selected = activeObjects.filter((item) =>
      selection.includes(item.id),
    );
    const single = selected.length === 1 ? selected[0] : undefined;
    const selectedBounds =
      document && selected.length
        ? unionBounds(
            roots(document, selection, true).map((item) => bounds(document, item)),
          )
        : null;
    const fitScale = artboard
      ? Math.max(
          0.015,
          Math.min(
            (viewportSize.width - 90) / artboard.width,
            (viewportSize.height - 100) / artboard.height,
          ),
        )
      : 0.4;
    const scale = fitScale * zoom;
    const offset = artboard
      ? {
          x:
            viewportSize.width / 2 -
            (artboard.x + artboard.width / 2) * scale +
            pan.x,
          y:
            viewportSize.height / 2 -
            (artboard.y + artboard.height / 2) * scale +
            pan.y,
        }
      : { x: 0, y: 0 };
    const latest = useRef({
      document,
      artboard,
      selection,
      anchorSelection,
      tool,
      scale,
      zoom,
      pan,
    });
    latest.current = {
      document,
      artboard,
      selection,
      anchorSelection,
      tool,
      scale,
      zoom,
      pan,
    };

    const commit = useCallback(
      (next: VectorDocument, assets?: AssetRecord[]) => {
        try {
          execute({ id: "vector.document.set", document: next, assets });
          return true;
        } catch (error) {
          onError(
            error instanceof Error
              ? error.message
              : "벡터 편집을 적용하지 못했습니다.",
          );
          return false;
        }
      },
      [execute, onError],
    );
    const finishPen = useCallback(() => {
      if (penId.current) {
        penId.current = null;
        endGroup();
      }
    }, [endGroup]);
    const finishDrag = useCallback(() => {
      if (
        drag.current &&
        drag.current.kind !== "pen" &&
        drag.current.kind !== "pan" &&
        drag.current.kind !== "marquee"
      )
        endGroup();
      drag.current = null;
      setMarquee(null);
      setSnapGuides({});
    }, [endGroup]);
    useEffect(() => {
      const created = createVectorDocument("벡터 디자인 1");
      setDraft(created);
      setDocumentId(null);
      setArtboardId(null);
      setSelection([]);
      setAnchorSelection([]);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return () => {
        finishPen();
        finishDrag();
      };
    }, [project.id, finishPen, finishDrag]);
    useEffect(() => {
      onSelectionChange?.(selected.length, clipboardReady);
    }, [selected.length, clipboardReady, onSelectionChange]);
    useEffect(() => {
      ensureVectorFont().catch((error) =>
        onError(
          error instanceof Error
            ? error.message
            : "벡터 글꼴을 읽을 수 없습니다.",
        ),
      );
    }, []);
    useEffect(() => {
      setBindingRegion(project.activeRegion);
    }, [project.activeRegion]);
    useEffect(() => {
      if (!document?.objects.some((object) => selection.includes(object.id)))
        setAnchorSelection([]);
    }, [document?.objects, selection]);
    useLayoutEffect(() => {
      const element = viewport.current;
      if (!element) return;
      const observer = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (rect) setViewportSize({ width: rect.width, height: rect.height });
      });
      observer.observe(element);
      return () => observer.disconnect();
    }, []);
    const zoomAt = useCallback((next: number, client?: VectorPoint) => {
      const current = latest.current;
      const nextZoom = clamp(next, 0.1, 32);
      const rect = viewport.current?.getBoundingClientRect();
      const anchor =
        rect && client
          ? {
              x: client.x - rect.left - rect.width / 2,
              y: client.y - rect.top - rect.height / 2,
            }
          : { x: 0, y: 0 };
      const ratio = nextZoom / current.zoom;
      setPan({
        x: anchor.x - (anchor.x - current.pan.x) * ratio,
        y: anchor.y - (anchor.y - current.pan.y) * ratio,
      });
      setZoom(nextZoom);
    }, []);
    useEffect(() => {
      const element = viewport.current;
      if (!element) return;
      const wheel = (event: WheelEvent) => {
        event.preventDefault();
        if (drag.current) return;
        const factor = event.deltaMode === 1 ? 16 : 1;
        if (event.ctrlKey || event.metaKey)
          zoomAt(
            latest.current.zoom * Math.exp(-event.deltaY * factor * 0.005),
            { x: event.clientX, y: event.clientY },
          );
        else
          setPan((previous) => ({
            x:
              previous.x -
              (event.shiftKey ? event.deltaY : event.deltaX) * factor,
            y: previous.y - (event.shiftKey ? 0 : event.deltaY) * factor,
          }));
      };
      element.addEventListener("wheel", wheel, { passive: false });
      return () => element.removeEventListener("wheel", wheel);
    }, [zoomAt]);
    useEffect(() => {
      const keyup = (event: KeyboardEvent) => {
        if (event.code === "Space") setSpaceHeld(false);
        if (event.key.startsWith("Arrow") && keyGroup.current) {
          keyGroup.current = false;
          endGroup();
        }
      };
      const blur = () => {
        setSpaceHeld(false);
        if (keyGroup.current) {
          keyGroup.current = false;
          endGroup();
        }
        finishDrag();
      };
      window.addEventListener("keyup", keyup);
      window.addEventListener("blur", blur);
      return () => {
        window.removeEventListener("keyup", keyup);
        window.removeEventListener("blur", blur);
      };
    }, [endGroup, finishDrag]);

    function updateObjects(update: (object: VectorObject) => void) {
      if (!document) return;
      finishPen();
      const next = copy(document);
      for (const object of next.objects)
        if (selection.includes(object.id) && unlocked(document, object)) update(object);
      commit(next);
    }
    function transformSelection(
      matrix: VectorMatrix,
      source = document,
      ids = selection,
    ) {
      if (!source) return;
      const next = copy(source);
      for (const object of roots(source, ids)) {
        const parent = source.objects.find(
          (item) => item.id === object.parentId,
        );
        const parentWorld = parent
          ? worldMatrix(source, parent)
          : identityMatrix();
        const replacement = next.objects.find((item) => item.id === object.id)!;
        replacement.transform = multiplyMatrices(
          invertMatrix(parentWorld),
          multiplyMatrices(matrix, worldMatrix(source, object)),
        );
      }
      commit(next);
    }
    function removeSelected() {
      if (!document) return;
      finishPen();
      const removed = new Set(
        descendants(
          document,
          roots(document, selection)
            .filter((object) => unlocked(document, object))
            .map((object) => object.id),
        ),
      );
      const next = copy(document);
      next.objects = next.objects.filter((object) => !removed.has(object.id));
      for (const object of next.objects) {
        if (object.clipPathId && removed.has(object.clipPathId))
          delete object.clipPathId;
        if (object.maskId && removed.has(object.maskId)) delete object.maskId;
      }
      commit(next);
      setSelection([]);
      setAnchorSelection([]);
    }
    function copySelected() {
      if (!document || !selection.length) return;
      const all = new Set(descendants(document, selection));
      for (let i = 0; i < document.objects.length; i++)
        for (const object of document.objects)
          if (all.has(object.id)) {
            if (object.clipPathId)
              descendants(document, [object.clipPathId]).forEach((id) =>
                all.add(id),
              );
            if (object.maskId)
              descendants(document, [object.maskId]).forEach((id) =>
                all.add(id),
              );
          }
      const copiedObjects = copy(
        document.objects.filter((object) => all.has(object.id)),
      );
      for (const object of copiedObjects)
        if (object.parentId && !all.has(object.parentId)) {
          object.transform = worldMatrix(document, object);
          object.parentId = null;
        }
      clipboard.current = {
        objects: copiedObjects,
        assets: Object.values(project.assets).filter((asset) =>
          document.assets.includes(asset.id),
        ),
      };
      setClipboardReady(true);
      onNotice("벡터 개체를 복사했습니다.");
    }
    function pasteSelected(duplicate = false) {
      if (!document || !artboard) return;
      if (duplicate) copySelected();
      const copied = clipboard.current;
      if (!copied?.objects.length) return;
      finishPen();
      const next = copy(document);
      const mapping = new Map(
        copied.objects.map((object) => [object.id, crypto.randomUUID()]),
      );
      const ids: string[] = [];
      const referenced = new Set(
        copied.objects.flatMap((object) =>
          [object.clipPathId, object.maskId].filter((id): id is string => !!id),
        ),
      );
      for (const original of copied.objects) {
        const object = copy(original);
        object.id = mapping.get(original.id)!;
        object.name = `${original.name.slice(0, 145)} 사본`;
        object.artboardId = artboard.id;
        object.locked = false;
        object.parentId =
          original.parentId && mapping.has(original.parentId)
            ? mapping.get(original.parentId)!
            : null;
        if (!object.parentId) {
          object.transform = multiplyMatrices(
            translationMatrix(20, 20),
            original.transform,
          );
          if (!referenced.has(original.id)) ids.push(object.id);
        }
        if (object.clipPathId)
          object.clipPathId = mapping.get(object.clipPathId);
        if (object.maskId) object.maskId = mapping.get(object.maskId);
        next.objects.push(object);
      }
      for (const asset of copied.assets)
        if (!next.assets.includes(asset.id)) next.assets.push(asset.id);
      commit(next, copied.assets);
      setSelection(ids);
    }
    function groupSelection() {
      if (!document || !artboard) return;
      const members = roots(document, selection);
      if (members.length < 2) return;
      finishPen();
      const next = copy(document);
      const group = createVectorObject("group", artboard.id, { name: "그룹" });
      next.objects.push(group);
      for (const object of members) {
        const child = next.objects.find((item) => item.id === object.id)!;
        child.transform = worldMatrix(document, object);
        child.parentId = group.id;
      }
      commit(next);
      setSelection([group.id]);
    }
    function ungroupSelection() {
      if (!document) return;
      const next = copy(document),
        ids: string[] = [];
      for (const object of selected.filter(
        (item) => item.type === "group" && unlocked(document, item),
      )) {
        for (const child of next.objects.filter(
          (item) => item.parentId === object.id,
        )) {
          child.transform = multiplyMatrices(object.transform, child.transform);
          child.parentId = object.parentId;
          ids.push(child.id);
        }
        next.objects = next.objects.filter((item) => item.id !== object.id);
      }
      commit(next);
      setSelection(ids);
    }
    function reorder(direction: "front" | "back" | "up" | "down") {
      if (!document) return;
      const next = copy(document);
      for (const id of direction === "up"
        ? [...selection].reverse()
        : selection) {
        const index = next.objects.findIndex((item) => item.id === id);
        const object = next.objects[index];
        if (!object || !unlocked(document, object)) continue;
        const siblings = next.objects
          .map((item, i) =>
            item.parentId === object.parentId &&
            item.artboardId === object.artboardId
              ? i
              : -1,
          )
          .filter((i) => i >= 0);
        const position = siblings.indexOf(index);
        const target =
          direction === "front"
            ? siblings.at(-1)!
            : direction === "back"
              ? siblings[0]!
              : siblings[
                  clamp(
                    position + (direction === "up" ? 1 : -1),
                    0,
                    siblings.length - 1,
                  )
                ]!;
        next.objects.splice(index, 1);
        next.objects.splice(target, 0, object);
      }
      commit(next);
    }
    function boolean(
      operation: "union" | "difference" | "intersection" | "xor" | "divide",
    ) {
      if (!document || !artboard) return;
      const objects = roots(document, selection).filter(
        (object) => object.geometry && unlocked(document, object),
      );
      if (objects.length < 2) {
        onNotice("닫힌 패스 개체를 두 개 이상 선택하세요.");
        return;
      }
      try {
        const paths = objects.map((object) =>
          transformPath(object.geometry!, worldMatrix(document, object)),
        );
        const output = booleanOperation(operation, paths, 0.25);
        const next = copy(document);
        const ids = new Set(objects.map((object) => object.id));
        next.objects = next.objects.filter((object) => !ids.has(object.id));
        const generated = output.map((geometry, index) =>
          createVectorObject("path", artboard.id, {
            name: `${{ union: "합치기", difference: "앞면 빼기", intersection: "교차 영역", xor: "겹침 제외", divide: "분할" }[operation]} ${index + 1}`,
            geometry,
            fill: copy(objects[0]!.fill),
            stroke: copy(objects[0]!.stroke),
          }),
        );
        next.objects.push(...generated);
        commit(next);
        setSelection(generated.map((object) => object.id));
        setAnchorSelection([]);
      } catch (error) {
        onError(
          error instanceof Error
            ? error.message
            : "도형 연산을 수행하지 못했습니다.",
        );
      }
    }
    function compound(release = false) {
      if (!document || !artboard) return;
      const objects = roots(document, selection).filter(
        (object) => object.geometry && unlocked(document, object),
      );
      if (!objects.length || (!release && objects.length < 2)) return;
      const next = copy(document);
      const ids = new Set(objects.map((object) => object.id));
      next.objects = next.objects.filter((object) => !ids.has(object.id));
      const paths = release
        ? objects.flatMap((object) =>
            releaseCompoundPath(
              transformPath(object.geometry!, worldMatrix(document, object)),
            ),
          )
        : [
            createCompoundPath(
              objects.map((object) =>
                transformPath(object.geometry!, worldMatrix(document, object)),
              ),
              "evenodd",
            ),
          ];
      const generated = paths.map((geometry, index) =>
        createVectorObject("path", artboard.id, {
          name: release ? `분리 경로 ${index + 1}` : "복합 패스",
          geometry,
          fill: copy(objects[0]!.fill),
          stroke: copy(objects[0]!.stroke),
        }),
      );
      next.objects.push(...generated);
      commit(next);
      setSelection(generated.map((object) => object.id));
    }
    function clip(release = false) {
      if (!document || !artboard) return;
      if (release) {
        updateObjects((object) => {
          delete object.clipPathId;
        });
        return;
      }
      const objects = roots(document, selection);
      const mask = objects.at(-1);
      if (objects.length < 2 || !mask?.geometry) {
        onNotice("맨 위에 마스크로 사용할 패스를 놓고 개체를 함께 선택하세요.");
        return;
      }
      const next = copy(document),
        group = createVectorObject("group", artboard.id, {
          name: "클리핑 그룹",
          clipPathId: mask.id,
        });
      next.objects.push(group);
      for (const source of objects) {
        const object = next.objects.find((item) => item.id === source.id)!;
        object.transform = worldMatrix(document, source);
        object.parentId = group.id;
      }
      commit(next);
      setSelection([group.id]);
    }
    function align(
      axis: "left" | "center" | "right" | "top" | "middle" | "bottom",
    ) {
      if (!document || !artboard) return;
      const next = copy(document);
      const area = selected.length > 1 ? selectedBounds! : artboard;
      for (const object of roots(document, selection)) {
        const box = bounds(document, object);
        const dx =
          axis === "left"
            ? area.x - box.x
            : axis === "center"
              ? area.x + area.width / 2 - box.x - box.width / 2
              : axis === "right"
                ? area.x + area.width - box.x - box.width
                : 0;
        const dy =
          axis === "top"
            ? area.y - box.y
            : axis === "middle"
              ? area.y + area.height / 2 - box.y - box.height / 2
              : axis === "bottom"
                ? area.y + area.height - box.y - box.height
                : 0;
        const parent = document.objects.find(
          (item) => item.id === object.parentId,
        );
        const parentMatrix = parent
          ? worldMatrix(document, parent)
          : identityMatrix();
        next.objects.find((item) => item.id === object.id)!.transform =
          multiplyMatrices(
            invertMatrix(parentMatrix),
            multiplyMatrices(
              translationMatrix(dx, dy),
              worldMatrix(document, object),
            ),
          );
      }
      commit(next);
    }
    function editPath(
      action: "close" | "reverse" | "add" | "remove" | "corner" | "smooth",
    ) {
      if (!document) return;
      const next = copy(document);
      for (const object of next.objects.filter(
        (item) => selection.includes(item.id) && item.geometry && unlocked(document, item),
      )) {
        if (action === "close")
          object.geometry = setPathClosed(
            object.geometry!,
            !object.geometry!.contours[0]?.closed,
          );
        else if (action === "reverse")
          object.geometry = reversePath(object.geometry!);
        else {
          const targets = anchorSelection.filter(
            (anchor) => anchor.objectId === object.id &&
              !!object.geometry?.contours[anchor.contour]?.anchors[anchor.anchor],
          );
          if (!targets.length) {
            onNotice("먼저 직접 선택 도구로 앵커를 선택하세요.");
            continue;
          }
          if (action === "add") {
            const target = targets[0]!;
            const contour = object.geometry!.contours[target.contour]!;
            if (!contour.closed && target.anchor === contour.anchors.length - 1) {
              onNotice("열린 패스의 마지막 점에는 다음 선분이 없습니다. 이전 앵커를 선택하세요.");
              continue;
            }
            object.geometry = addAnchor(
              object.geometry!,
              target.contour,
              target.anchor,
            );
          } else if (action === "remove") {
            for (const target of [...targets].sort(
              (a, b) => b.contour - a.contour || b.anchor - a.anchor,
            ))
              object.geometry = removeAnchor(
                object.geometry!,
                target.contour,
                target.anchor,
              );
          } else
            for (const target of targets) {
              const contour = object.geometry!.contours[target.contour]!,
                anchor = contour.anchors[target.anchor];
              if (!anchor) continue;
              if (action === "corner") {
                delete anchor.in;
                delete anchor.out;
                anchor.kind = "corner";
              } else {
                const previous =
                    contour.anchors[
                      (target.anchor - 1 + contour.anchors.length) %
                        contour.anchors.length
                    ]!,
                  following =
                    contour.anchors[
                      (target.anchor + 1) % contour.anchors.length
                    ]!;
                const dx = (following.x - previous.x) / 6,
                  dy = (following.y - previous.y) / 6;
                anchor.in = { x: anchor.x - dx, y: anchor.y - dy };
                anchor.out = { x: anchor.x + dx, y: anchor.y + dy };
                anchor.kind = "symmetric";
              }
            }
        }
      }
      commit(next);
      if (action === "remove" || action === "add") setAnchorSelection([]);
    }
    function joinSelectedPaths() {
      if (!document || !artboard) return;
      const objects = roots(document, selection).filter(
        (object) => object.geometry,
      );
      if (objects.length !== 2) return;
      try {
        const geometry = joinPaths(
          transformPath(
            objects[0]!.geometry!,
            worldMatrix(document, objects[0]!),
          ),
          transformPath(
            objects[1]!.geometry!,
            worldMatrix(document, objects[1]!),
          ),
        );
        const next = copy(document),
          ids = new Set(objects.map((object) => object.id));
        next.objects = next.objects.filter((object) => !ids.has(object.id));
        const result = createVectorObject("path", artboard.id, {
          geometry,
          name: "연결한 패스",
          fill: copy(objects[0]!.fill),
          stroke: copy(objects[0]!.stroke),
        });
        next.objects.push(result);
        if (commit(next)) {
          setSelection([result.id]);
          setAnchorSelection([]);
        }
      } catch (error) {
        onError(
          error instanceof Error
            ? error.message
            : "패스를 연결하지 못했습니다.",
        );
      }
    }
    function splitSelectedPath() {
      if (!document || !artboard || anchorSelection.length !== 1) return;
      const anchor = anchorSelection[0]!,
        object = document.objects.find((item) => item.id === anchor.objectId);
      if (!object?.geometry || !unlocked(document, object)) return;
      try {
        const output = splitPath(
          object.geometry,
          anchor.contour,
          anchor.anchor,
        );
        const next = copy(document);
        next.objects = next.objects.filter((item) => item.id !== object.id);
        const generated = output.map((geometry) =>
          createVectorObject("path", artboard.id, {
            geometry,
            name: `${object.name.slice(0, 154)} 분할`,
            parentId: object.parentId,
            transform: copy(object.transform),
            fill: copy(object.fill),
            stroke: copy(object.stroke),
          }),
        );
        next.objects.push(...generated);
        if (commit(next)) {
          setSelection(generated.map((item) => item.id));
          setAnchorSelection([]);
        }
      } catch (error) {
        onError(
          error instanceof Error ? error.message : "패스를 나누지 못했습니다.",
        );
      }
    }
    async function exportDocument(kind: "svg" | "png") {
      if (!document || !artboard || exporting) return;
      finishPen();
      setExporting(true);
      try {
        const source = exportSVG(document, artboard.id, project.assets);
        let bytes = new TextEncoder().encode(source);
        if (kind === "png") {
          const ratio = Math.min(
            1,
            4096 / Math.max(artboard.width, artboard.height),
          );
          const canvas = await renderVectorDocument(
            document,
            artboard.id,
            project.assets,
            Math.max(1, Math.round(artboard.width * ratio)),
            Math.max(1, Math.round(artboard.height * ratio)),
            true,
          );
          const png = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (value) =>
                value
                  ? resolve(value)
                  : reject(new Error("PNG를 생성하지 못했습니다.")),
              "image/png",
            ),
          );
          bytes = new Uint8Array(await png.arrayBuffer());
        }
        if (onExport) {
          const saved = await onExport(kind, bytes, document.name);
          if (saved === false) return;
        } else {
          const url = URL.createObjectURL(
            new Blob([bytes], {
              type: kind === "svg" ? "image/svg+xml" : "image/png",
            }),
          );
          const anchor = window.document.createElement("a");
          anchor.href = url;
          anchor.download = `${document.name}.${kind}`;
          anchor.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        onNotice(`${kind.toUpperCase()} 내보내기를 완료했습니다.`);
      } catch (error) {
        onError(
          error instanceof Error
            ? error.message
            : "내보내기를 완료하지 못했습니다.",
        );
      } finally {
        setExporting(false);
      }
    }
    async function importFile(file?: File) {
      if (!file) return;
      try {
        if (file.size > 12 * 1024 * 1024)
          throw new Error("SVG는 12 MiB 이하의 파일을 사용하세요.");
        importSource(await file.text(), file.name);
      } catch (error) {
        onError(
          error instanceof Error ? error.message : "SVG를 열지 못했습니다.",
        );
      }
    }
    async function importImage(file?: File) {
      if (!file || !document || !artboard) return;
      const projectId = project.id,
        vectorId = document.id,
        boardId = artboard.id;
      try {
        const asset = await importPNG(file),
          image = new Image();
        image.src = asset.data;
        await image.decode();
        const state = useStudio.getState();
        if (state.project.id !== projectId) return;
        const next = copy(
            state.project.vectorDocuments?.[vectorId] ?? document,
          ),
          board = next.artboards.find((item) => item.id === boardId);
        if (!board) return;
        const ratio = Math.min(
          (board.width * 0.7) / image.naturalWidth,
          (board.height * 0.7) / image.naturalHeight,
          1,
        );
        const object = createVectorObject("image", boardId, {
          name: file.name.slice(0, 160),
          transform: multiplyMatrices(
            translationMatrix(
              board.x + (board.width - image.naturalWidth * ratio) / 2,
              board.y + (board.height - image.naturalHeight * ratio) / 2,
            ),
            scaleMatrix(ratio),
          ),
          image: {
            assetId: asset.id,
            width: image.naturalWidth,
            height: image.naturalHeight,
          },
        });
        next.assets.push(asset.id);
        next.objects.push(object);
        finishPen();
        if (commit(next, [asset])) {
          setSelection([object.id]);
          setTool("select");
          onNotice("원본 PNG를 벡터 아트보드에 배치했습니다.");
        }
      } catch (error) {
        onError(
          error instanceof Error ? error.message : "PNG를 배치하지 못했습니다.",
        );
      }
    }
    function bindArtboard() {
      if (!document || !artboard) return;
      finishPen();
      if (!project.vectorDocuments?.[document.id] && !commit(document)) return;
      execute({
        id: "vector.garment.bind",
        documentId: document.id,
        artboardId: artboard.id,
        regionId: bindingRegion,
      });
      onNotice(
        `${regionLabels[bindingRegion] ?? bindingRegion}에 벡터 디자인을 연결했습니다. 수정한 디자인은 즉시 반영됩니다.`,
      );
    }
    const command = (id: string) => {
      const name = id
        .replace(/^vector\./, "")
        .replace(/^edit\./, "")
        .replace(/^artwork\./, "")
        .replace(/^layer\./, "");
      setMenu(null);
      setContext(null);
      if (name === "copy") copySelected();
      else if (name === "cut") {
        copySelected();
        removeSelected();
      } else if (name === "paste") pasteSelected();
      else if (name === "duplicate") pasteSelected(true);
      else if (
        name === "delete" ||
        name === "remove" ||
        name === "object.remove"
      )
        removeSelected();
      else if (name === "selectAll" || name === "select.all")
        setSelection(
          activeObjects
            .filter((object) => !object.parentId && unlocked(document!, object))
            .map((object) => object.id),
        );
      else if (name === "group" || name === "object.group") groupSelection();
      else if (name === "ungroup" || name === "object.ungroup")
        ungroupSelection();
      else if (name.startsWith("boolean.")) boolean(name.slice(8) as "union");
      else if (name === "compound.create") compound();
      else if (name === "compound.release") compound(true);
      else if (name === "path.close") editPath("close");
      else if (name === "path.join") joinSelectedPaths();
      else if (name === "path.split") splitSelectedPath();
      else if (name === "clip.create") clip();
      else if (name === "clip.release") clip(true);
      else if (name === "text.outline") void outlineText();
      else if (name === "import.image") pngInput.current?.click();
      else if (name === "text.create") {
        finishPen();
        setTool("text");
        viewport.current?.focus();
        onNotice("아트보드의 문자 시작 위치를 클릭하세요.");
      } else if (name === "garment.bind") bindArtboard();
      else if (name === "rename") {
        const input = workspace.current?.querySelector<HTMLInputElement>(
          'input[aria-label="벡터 개체 이름"]',
        );
        input?.focus();
        input?.select();
      } else if (name.startsWith("align.")) align(name.slice(6) as "left");
      else if (name === "moveUp") reorder("up");
      else if (name === "moveDown") reorder("down");
      else if (name === "import.svg") importInput.current?.click();
      else if (name === "export.svg") void exportDocument("svg");
      else if (name === "export.png") void exportDocument("png");
      else if (name === "fit" || name === "view.fit") {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      } else if (name === "deselect" || name === "select.none") {
        finishPen();
        setSelection([]);
        setAnchorSelection([]);
      } else if (name === "undo") useStudio.getState().undo();
      else if (name === "redo") useStudio.getState().redo();
    };
    function importSource(source: string, name?: string) {
      try {
        finishPen();
        const result = importSVG(source);
        if (name)
          result.document.name = name.replace(/\.svg$/i, "").slice(0, 160);
        commit(result.document, result.assets);
        setDocumentId(result.document.id);
        setArtboardId(result.document.artboards[0]!.id);
        setSelection([]);
        setAnchorSelection([]);
        setZoom(1);
        setPan({ x: 0, y: 0 });
        onNotice(
          result.warnings.length
            ? `SVG를 가져왔습니다. ${result.warnings.join(" · ")}`
            : "편집 가능한 벡터 SVG를 가져왔습니다.",
        );
      } catch (error) {
        onError(
          error instanceof Error ? error.message : "SVG를 열지 못했습니다.",
        );
      }
    }
    useImperativeHandle(ref, () => ({ command, importSVG: importSource }));
    async function outlineText() {
      const targets = selected.filter(
        (object) => object.type === "text" && object.text && unlocked(document!, object),
      );
      if (!document || !targets.length) return;
      try {
        const converted = await Promise.all(
          targets.map(async (object) => ({
            id: object.id,
            geometry: await textToPath(object.text!),
          })),
        );
        const current =
          useStudio.getState().project.vectorDocuments?.[document.id];
        if (!current) return;
        const next = copy(current);
        for (const result of converted) {
          const object = next.objects.find((item) => item.id === result.id);
          const source = targets.find((item) => item.id === result.id);
          if (
            !object?.text ||
            JSON.stringify(object.text) !== JSON.stringify(source?.text)
          )
            continue;
          object.type = "path";
          object.geometry = result.geometry;
          object.name = `${object.name.slice(0, 154)} 윤곽선`;
          delete object.text;
        }
        commit(next);
      } catch (error) {
        onError(
          error instanceof Error
            ? error.message
            : "문자를 윤곽선으로 변환하지 못했습니다.",
        );
      }
    }

    function coordinate(event: {
      clientX: number;
      clientY: number;
    }): VectorPoint {
      const matrix = world.current?.getScreenCTM();
      if (!matrix) return { x: 0, y: 0 };
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
        matrix.inverse(),
      );
      return { x: point.x, y: point.y };
    }
    function shapeGeometry(
      kind: Tool,
      first: VectorPoint,
      last: VectorPoint,
      shift = false,
    ): VectorPath {
      let end = { ...last };
      if (shift && kind !== "line") {
        const distance = Math.max(
          Math.abs(last.x - first.x),
          Math.abs(last.y - first.y),
        );
        end = {
          x: first.x + Math.sign(last.x - first.x || 1) * distance,
          y: first.y + Math.sign(last.y - first.y || 1) * distance,
        };
      }
      if (shift && kind === "line") {
        const angle =
            (Math.round(
              Math.atan2(last.y - first.y, last.x - first.x) / (Math.PI / 4),
            ) *
              Math.PI) /
            4,
          distance = Math.hypot(last.x - first.x, last.y - first.y);
        end = {
          x: first.x + Math.cos(angle) * distance,
          y: first.y + Math.sin(angle) * distance,
        };
      }
      const rect = rectBetween(first, end);
      if (kind === "ellipse")
        return ellipsePath(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
          rect.width / 2,
          rect.height / 2,
        );
      if (kind === "polygon")
        return polygonPath(
          rect.x,
          rect.y,
          rect.width,
          rect.height,
          polygonSides,
        );
      if (kind === "star")
        return starPath(
          rect.x,
          rect.y,
          rect.width,
          rect.height,
          polygonSides === 6 ? 5 : polygonSides,
        );
      if (kind === "line") return linePath(first.x, first.y, end.x, end.y);
      if (kind === "roundrect")
        return roundedRectanglePath(
          rect.x,
          rect.y,
          rect.width,
          rect.height,
          Math.min(cornerRadius, rect.width / 2, rect.height / 2),
        );
      return rectanglePath(rect.x, rect.y, rect.width, rect.height);
    }
    function down(event: React.PointerEvent<HTMLDivElement>) {
      if (!document || !artboard || (event.button !== 0 && event.button !== 1))
        return;
      if ((event.target as Element).closest(".vector-context-menu")) return;
      event.preventDefault();
      setMenu(null);
      setContext(null);
      viewport.current?.focus({ preventScroll: true });
      const point = coordinate(event);
      const target = event.target as Element;
      event.currentTarget.setPointerCapture(event.pointerId);
      if (event.button === 1 || spaceHeld || tool === "hand") {
        drag.current = {
          kind: "pan",
          start: { x: event.clientX, y: event.clientY },
          pan: { ...pan },
        };
        return;
      }
      if (tool === "zoom") {
        zoomAt(zoom * (event.altKey ? 0.8 : 1.25), {
          x: event.clientX,
          y: event.clientY,
        });
        return;
      }
      if (tool === "pen") {
        let next = copy(document),
          object = next.objects.find((item) => item.id === penId.current);
        if (object && !unlocked(next, object)) {
          finishPen();
          return;
        }
        if (!object) {
          finishPen();
          beginGroup();
          object = createVectorObject("path", artboard.id, {
            name: "펜 패스",
            geometry: {
              contours: [{ anchors: [], closed: false }],
              fillRule: "nonzero",
            },
            fill: solid(defaultFill),
            stroke: {
              paint: solid(defaultStroke),
              width: Math.max(2, defaultStrokeWidth),
              lineCap: "round",
              lineJoin: "round",
              miterLimit: 4,
              dash: [],
              dashOffset: 0,
            },
          });
          penId.current = object.id;
          next.objects.push(object);
        }
        const contour = object.geometry!.contours[0]!;
        const first = contour.anchors[0];
        const objectWorld = worldMatrix(next, object);
        const localPoint = applyMatrix(invertMatrix(objectWorld), point);
        const firstWorld = first ? applyMatrix(objectWorld, first) : undefined;
        if (
          first &&
          contour.anchors.length > 2 &&
          Math.hypot(firstWorld!.x - point.x, firstWorld!.y - point.y) * scale < 10
        ) {
          contour.closed = true;
          commit(next);
          finishPen();
          setSelection([object.id]);
          return;
        }
        const anchor: VectorAnchor = {
          id: crypto.randomUUID(),
          x: localPoint.x,
          y: localPoint.y,
          kind: "corner",
        };
        contour.anchors.push(anchor);
        commit(next);
        setSelection([object.id]);
        setAnchorSelection([
          {
            objectId: object.id,
            contour: 0,
            anchor: contour.anchors.length - 1,
          },
        ]);
        drag.current = {
          kind: "pen",
          objectId: object.id,
          contour: 0,
          anchor: contour.anchors.length - 1,
          start: point,
        };
        return;
      }
      if (
        ["rect", "roundrect", "ellipse", "line", "polygon", "star"].includes(
          tool,
        )
      ) {
        finishPen();
        beginGroup();
        const object = createVectorObject("path", artboard.id, {
          name: (
            {
              rect: "사각형",
              roundrect: "둥근 사각형",
              ellipse: "타원",
              line: "직선",
              polygon: "다각형",
              star: "별",
            } as Record<string, string>
          )[tool],
          geometry: shapeGeometry(tool, point, {
            x: point.x + 0.1,
            y: point.y + 0.1,
          }),
          fill: tool === "line" ? { type: "none" } : solid(defaultFill),
          stroke: {
            paint: solid(defaultStroke),
            width:
              tool === "line"
                ? Math.max(2, defaultStrokeWidth)
                : defaultStrokeWidth,
            lineCap: "round",
            lineJoin: "round",
            miterLimit: 4,
            dash: [],
            dashOffset: 0,
          },
        });
        const next = copy(document);
        next.objects.push(object);
        commit(next);
        setSelection([object.id]);
        setAnchorSelection([]);
        drag.current = {
          kind: "shape",
          objectId: object.id,
          original: next,
          start: point,
          tool,
        };
        return;
      }
      if (tool === "text") {
        finishPen();
        const object = createVectorObject("text", artboard.id, {
          name: "텍스트",
          transform: translationMatrix(point.x, point.y),
          fill: solid(defaultFill),
          text: {
            content: "STULOOMA",
            fontFamily: VECTOR_FONT_FAMILY,
            fontSize: 96,
            fontWeight: 400,
            letterSpacing: 0,
            lineHeight: 1.2,
            alignment: "start",
          },
        });
        const next = copy(document);
        next.objects.push(object);
        commit(next);
        setSelection([object.id]);
        setTool("select");
        return;
      }
      const anchorElement = target.closest("[data-anchor-object]");
      if (anchorElement) {
        const objectId = anchorElement.getAttribute("data-anchor-object")!,
          contour = Number(anchorElement.getAttribute("data-contour")),
          anchor = Number(anchorElement.getAttribute("data-anchor"));
        const object = document.objects.find((item) => item.id === objectId);
        if (!object || !unlocked(document, object)) return;
        const item = { objectId, contour, anchor };
        const handle = anchorElement.getAttribute("data-handle") as
          | "in"
          | "out"
          | null;
        const already = anchorSelection.some(
          (current) =>
            current.objectId === objectId &&
            current.contour === contour &&
            current.anchor === anchor,
        );
        const points =
          event.shiftKey && !handle
            ? already
              ? anchorSelection.filter(
                  (current) =>
                    !(
                      current.objectId === objectId &&
                      current.contour === contour &&
                      current.anchor === anchor
                    ),
                )
              : [...anchorSelection, item]
            : already && !handle
              ? anchorSelection
              : [item];
        setAnchorSelection(points);
        beginGroup();
        drag.current = {
          kind: "anchor",
          start: point,
          original: copy(document),
          points: handle ? [item] : points,
          handle: handle ?? undefined,
        };
        return;
      }
      const transformHandle = target.closest("[data-vector-transform]");
      if (transformHandle && selectedBounds) {
        const mode = transformHandle.getAttribute("data-vector-transform") as
          | "scale"
          | "rotate";
        const corner = transformHandle.getAttribute("data-corner") ?? "br";
        const pivot =
          mode === "rotate"
            ? {
                x: selectedBounds.x + selectedBounds.width / 2,
                y: selectedBounds.y + selectedBounds.height / 2,
              }
            : {
                x: corner.includes("r")
                  ? selectedBounds.x
                  : selectedBounds.x + selectedBounds.width,
                y: corner.includes("b")
                  ? selectedBounds.y
                  : selectedBounds.y + selectedBounds.height,
              };
        beginGroup();
        drag.current = {
          kind: "transform",
          mode,
          start: point,
          original: copy(document),
          ids: selection,
          bounds: selectedBounds,
          pivot,
        };
        return;
      }
      let object = document.objects.find(
        (item) =>
          item.id ===
          target
            .closest("[data-vector-object]")
            ?.getAttribute("data-vector-object"),
      );
      if (object && !unlocked(document, object)) object = undefined;
      if (object && tool === "select" && !event.altKey)
        while (object.parentId) {
          const parent = document.objects.find(
            (item) => item.id === object!.parentId,
          );
          if (!parent) break;
          object = parent;
        }
      if (object) {
        const ids = event.shiftKey
          ? selection.includes(object.id)
            ? selection.filter((id) => id !== object.id)
            : [...selection, object.id]
          : selection.includes(object.id)
            ? selection
            : [object.id];
        setSelection(ids);
        setAnchorSelection([]);
        if (ids.includes(object.id) && tool === "select") {
          beginGroup();
          drag.current = {
            kind: "transform",
            mode: "move",
            start: point,
            original: copy(document),
            ids,
            bounds: unionBounds(
              roots(document, ids).map((item) => bounds(document, item)),
            ),
            pivot: point,
          };
        }
      } else {
        if (!event.shiftKey) {
          setSelection([]);
          setAnchorSelection([]);
        }
        drag.current = {
          kind: "marquee",
          start: point,
          current: point,
          additive: event.shiftKey,
        };
        setMarquee({ x: point.x, y: point.y, width: 0, height: 0 });
      }
    }
    function move(event: React.PointerEvent<HTMLDivElement>) {
      const current = drag.current;
      if (!current || !document || !artboard) return;
      const point = coordinate(event);
      if (current.kind === "pan") {
        setPan({
          x: current.pan.x + event.clientX - current.start.x,
          y: current.pan.y + event.clientY - current.start.y,
        });
        return;
      }
      if (current.kind === "marquee") {
        current.current = point;
        setMarquee(rectBetween(current.start, point));
        return;
      }
      if (current.kind === "shape") {
        const next = copy(current.original);
        next.objects.find((item) => item.id === current.objectId)!.geometry =
          shapeGeometry(current.tool, current.start, point, event.shiftKey);
        commit(next);
        return;
      }
      if (current.kind === "pen") {
        const next = copy(document);
        const object = next.objects.find((item) => item.id === current.objectId);
        const anchor = object?.geometry?.contours[current.contour]?.anchors[current.anchor];
        if (!object || !anchor || !unlocked(next, object)) return;
        if (
          Math.hypot(point.x - current.start.x, point.y - current.start.y) *
            scale >
          3
        ) {
          const localPoint = applyMatrix(invertMatrix(worldMatrix(next, object)), point);
          anchor.out = localPoint;
          anchor.in = { x: anchor.x * 2 - localPoint.x, y: anchor.y * 2 - localPoint.y };
          anchor.kind = "symmetric";
          commit(next);
        }
        return;
      }
      if (current.kind === "anchor") {
        const next = copy(current.original);
        for (const target of current.points) {
          const originalObject = current.original.objects.find(
              (item) => item.id === target.objectId,
            )!,
            object = next.objects.find((item) => item.id === target.objectId)!;
          if (!originalObject || !unlocked(current.original, originalObject)) continue;
          const anchor =
            object.geometry!.contours[target.contour]!.anchors[target.anchor]!;
          const inverse = invertMatrix(
              worldMatrix(current.original, originalObject),
            ),
            start = applyMatrix(inverse, current.start),
            end = applyMatrix(inverse, point),
            dx = end.x - start.x,
            dy = end.y - start.y;
          if (current.handle) {
            const handle = anchor[current.handle];
            if (!handle) continue;
            handle.x += dx;
            handle.y += dy;
            const opposite = current.handle === "in" ? "out" : "in";
            if (event.altKey) anchor.kind = "corner";
            else if (anchor.kind !== "corner" && anchor[opposite]) {
              const oldLength = Math.hypot(
                anchor[opposite]!.x - anchor.x,
                anchor[opposite]!.y - anchor.y,
              );
              const length =
                anchor.kind === "symmetric"
                  ? Math.hypot(handle.x - anchor.x, handle.y - anchor.y)
                  : oldLength;
              const angle =
                Math.atan2(handle.y - anchor.y, handle.x - anchor.x) + Math.PI;
              anchor[opposite] = {
                x: anchor.x + Math.cos(angle) * length,
                y: anchor.y + Math.sin(angle) * length,
              };
            }
          } else {
            anchor.x += dx;
            anchor.y += dy;
            if (anchor.in) {
              anchor.in.x += dx;
              anchor.in.y += dy;
            }
            if (anchor.out) {
              anchor.out.x += dx;
              anchor.out.y += dy;
            }
          }
        }
        commit(next);
        return;
      }
      if (current.mode === "move") {
        let dx = point.x - current.start.x,
          dy = point.y - current.start.y;
        if (event.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const guides: { x?: number; y?: number } = {};
        if (snapping && !event.altKey) {
          const otherBoxes = activeObjects
            .filter(
              (object) =>
                !current.ids.includes(object.id) &&
                object.visible &&
                !object.parentId,
            )
            .map((object) => bounds(document, object));
          const targets = [artboard, ...otherBoxes];
          for (const axis of ["x", "y"] as const) {
            const dimension = axis === "x" ? "width" : "height";
            let best = 6 / scale,
              adjustment = 0;
            for (const target of targets)
              for (const targetValue of [
                target[axis],
                target[axis] + target[dimension] / 2,
                target[axis] + target[dimension],
              ])
                for (const sourceValue of [
                  current.bounds[axis],
                  current.bounds[axis] + current.bounds[dimension] / 2,
                  current.bounds[axis] + current.bounds[dimension],
                ]) {
                  const delta =
                    targetValue - sourceValue - (axis === "x" ? dx : dy);
                  if (Math.abs(delta) < best) {
                    best = Math.abs(delta);
                    adjustment = delta;
                    guides[axis] = targetValue;
                  }
                }
            if (axis === "x") dx += adjustment;
            else dy += adjustment;
          }
        }
        setSnapGuides(guides);
        transformSelection(
          translationMatrix(dx, dy),
          current.original,
          current.ids,
        );
      } else if (current.mode === "rotate") {
        let angle =
          ((Math.atan2(point.y - current.pivot.y, point.x - current.pivot.x) -
            Math.atan2(
              current.start.y - current.pivot.y,
              current.start.x - current.pivot.x,
            )) *
            180) /
          Math.PI;
        if (event.shiftKey) angle = Math.round(angle / 15) * 15;
        transformSelection(
          rotationMatrix(angle, current.pivot.x, current.pivot.y),
          current.original,
          current.ids,
        );
      } else {
        let sx =
            (point.x - current.pivot.x) /
            (current.start.x - current.pivot.x || 1),
          sy =
            (point.y - current.pivot.y) /
            (current.start.y - current.pivot.y || 1);
        if (event.shiftKey) sx = sy = Math.abs(sx) > Math.abs(sy) ? sx : sy;
        if (Math.abs(sx) < 0.01) sx = 0.01;
        if (Math.abs(sy) < 0.01) sy = 0.01;
        transformSelection(
          multiplyMatrices(
            translationMatrix(current.pivot.x, current.pivot.y),
            multiplyMatrices(
              scaleMatrix(sx, sy),
              translationMatrix(-current.pivot.x, -current.pivot.y),
            ),
          ),
          current.original,
          current.ids,
        );
      }
    }
    function up() {
      const current = drag.current;
      if (current?.kind === "marquee" && document && artboard) {
        const box = rectBetween(current.start, current.current);
        const hits = activeObjects
          .filter(
            (object) =>
              !object.parentId &&
              unlocked(document, object) &&
              intersect(box, bounds(document, object)),
          )
          .map((object) => object.id);
        setSelection(
          current.additive ? [...new Set([...selection, ...hits])] : hits,
        );
      }
      finishDrag();
    }
    function keyDown(event: React.KeyboardEvent<HTMLDivElement>) {
      if (
        event.nativeEvent.isComposing ||
        event.keyCode === 229 ||
        inputTarget(event.target)
      )
        return;
      const modifier = event.ctrlKey || event.metaKey,
        key = event.key.toLowerCase();
      let handled = true;
      if (
        modifier &&
        ["n", "o", "s", "k"].includes(key) &&
        !(key === "o" && event.shiftKey)
      )
        return;
      if (modifier && key === "z") command(event.shiftKey ? "redo" : "undo");
      else if (modifier && key === "y") command("redo");
      else if (modifier && key === "c") command("copy");
      else if (modifier && key === "v") command("paste");
      else if (modifier && key === "x") command("cut");
      else if (modifier && key === "d") command("duplicate");
      else if (modifier && key === "a") command("selectAll");
      else if (modifier && key === "g")
        command(event.shiftKey ? "ungroup" : "group");
      else if (modifier && key === "7")
        command(event.altKey ? "clip.release" : "clip.create");
      else if (modifier && event.shiftKey && key === "o")
        command("text.outline");
      else if (modifier && key === "0") command("fit");
      else if (event.key === "Escape") {
        finishPen();
        finishDrag();
        setSelection([]);
        setAnchorSelection([]);
        setMenu(null);
        setContext(null);
        setTool("select");
      } else if (event.key === "Enter" && penId.current) finishPen();
      else if (event.key === "Backspace" && penId.current && document) {
        const next = copy(document),
          object = next.objects.find((item) => item.id === penId.current);
        object?.geometry?.contours[0]?.anchors.pop();
        commit(next);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        if (tool === "direct" && anchorSelection.length) editPath("remove");
        else removeSelected();
      } else if (event.code === "Space") setSpaceHeld(true);
      else if (!modifier && event.key.startsWith("Arrow") && selection.length) {
        if (!keyGroup.current) {
          keyGroup.current = true;
          beginGroup();
        }
        const amount = event.shiftKey ? 10 : 1;
        transformSelection(
          translationMatrix(
            event.key === "ArrowLeft"
              ? -amount
              : event.key === "ArrowRight"
                ? amount
                : 0,
            event.key === "ArrowUp"
              ? -amount
              : event.key === "ArrowDown"
                ? amount
                : 0,
          ),
        );
      } else if (!modifier && (key === "+" || key === "=")) zoomAt(zoom * 1.25);
      else if (!modifier && key === "-") zoomAt(zoom / 1.25);
      else if (!modifier) {
        const match = toolInfo.find((item) => item.key.toLowerCase() === key);
        if (match) {
          finishPen();
          setTool(match.id);
        } else handled = false;
      } else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    if (!document || !artboard)
      return (
        <section className="vector-studio" role="status">
          벡터 문서를 준비하고 있습니다…
        </section>
      );
    const regionLabels: Record<string, string> = {
      FRONT: "앞판",
      BACK: "뒷판",
      LEFT_SLEEVE: "왼쪽 소매",
      RIGHT_SLEEVE: "오른쪽 소매",
      COLLAR: "목둘레",
      LEFT_SIDE: "왼쪽 옆판",
      RIGHT_SIDE: "오른쪽 옆판",
    };
    const bindings = project.layers.filter(
      (layer) =>
        layer.type === "vector" &&
        layer.vectorDocumentId === document.id &&
        layer.vectorArtboardId === artboard.id,
    );
    function changeArtboard(patch: Partial<typeof artboard>) {
      if (!artboard) return;
      const next = copy(document!);
      Object.assign(
        next.artboards.find((item) => item.id === artboard.id)!,
        patch,
      );
      commit(next);
    }
    function addArtboard(duplicate = false) {
      const next = copy(document!);
      const board = {
        ...copy(artboard!),
        id: crypto.randomUUID(),
        name: duplicate
          ? `${artboard!.name.slice(0, 156)} 사본`
          : `아트보드 ${next.artboards.length + 1}`,
        x: artboard!.x + artboard!.width + 80,
      };
      next.artboards.push(board);
      if (duplicate) {
        const copied = activeObjects.map((object) => ({
          ...copy(object),
          id: crypto.randomUUID(),
        }));
        const map = new Map(
          activeObjects.map((object, i) => [object.id, copied[i]!.id]),
        );
        for (const object of copied) {
          object.artboardId = board.id;
          object.parentId = object.parentId ? map.get(object.parentId)! : null;
          if (!object.parentId)
            object.transform = multiplyMatrices(
              translationMatrix(board.x - artboard!.x, board.y - artboard!.y),
              object.transform,
            );
          if (object.clipPathId) object.clipPathId = map.get(object.clipPathId);
          if (object.maskId) object.maskId = map.get(object.maskId);
        }
        next.objects.push(...copied);
      }
      commit(next);
      setArtboardId(board.id);
      setSelection([]);
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
    const menuItems: Record<
      string,
      { label: string; action: () => void; disabled?: boolean }[]
    > = {
      개체: [
        {
          label: "그룹 만들기  Ctrl+G",
          action: groupSelection,
          disabled: selected.length < 2,
        },
        {
          label: "그룹 해제  Ctrl+Shift+G",
          action: ungroupSelection,
          disabled: !selected.some((object) => object.type === "group"),
        },
        {
          label: "맨 앞으로",
          action: () => reorder("front"),
          disabled: !selected.length,
        },
        {
          label: "맨 뒤로",
          action: () => reorder("back"),
          disabled: !selected.length,
        },
        {
          label: "클리핑 마스크 만들기  Ctrl+7",
          action: () => clip(),
          disabled: selected.length < 2,
        },
        {
          label: "클리핑 마스크 해제",
          action: () => clip(true),
          disabled: !selected.some((object) => object.clipPathId),
        },
      ],
      경로: [
        {
          label: "열린 패스 두 개 연결",
          action: joinSelectedPaths,
          disabled: selected.filter((object) => object.geometry).length !== 2,
        },
        {
          label: "선택 앵커에서 패스 분할",
          action: splitSelectedPath,
          disabled: anchorSelection.length !== 1,
        },
        {
          label: "패스 열기 / 닫기",
          action: () => editPath("close"),
          disabled: !single?.geometry,
        },
        {
          label: "열린 패스 이어 그리기",
          action: () => {
            if (!single?.geometry) return;
            finishPen();
            beginGroup();
            penId.current = single.id;
            setTool("pen");
            viewport.current?.focus();
          },
          disabled:
            !single?.geometry ||
            !unlocked(document!, single) ||
            single.geometry.contours.length !== 1 ||
            single.geometry.contours[0].closed,
        },
        {
          label: "경로 방향 반전",
          action: () => editPath("reverse"),
          disabled: !single?.geometry,
        },
        {
          label: "선택 앵커 다음 구간에 점 추가",
          action: () => editPath("add"),
          disabled: !anchorSelection.length,
        },
        {
          label: "선택 앵커 제거",
          action: () => editPath("remove"),
          disabled: !anchorSelection.length,
        },
        {
          label: "복합 패스 만들기",
          action: () => compound(),
          disabled: selected.length < 2,
        },
        {
          label: "복합 패스 해제",
          action: () => compound(true),
          disabled: !single?.geometry || single.geometry.contours.length < 2,
        },
      ],
      문자: [
        {
          label: "문자 윤곽선 만들기  Ctrl+Shift+O",
          action: () => void outlineText(),
          disabled: !selected.some((object) => object.text),
        },
      ],
      선택: [
        { label: "전체 선택  Ctrl+A", action: () => command("selectAll") },
        { label: "선택 해제  Esc", action: () => command("deselect") },
        {
          label: "선택 반전",
          action: () =>
            setSelection(
              activeObjects
                .filter(
                  (object) =>
                    !object.parentId &&
                    unlocked(document!, object) &&
                    !selection.includes(object.id),
                )
                .map((object) => object.id),
            ),
        },
      ],
      보기: [
        { label: "화면에 맞춤  Ctrl+0", action: () => command("fit") },
        {
          label: grid ? "그리드 숨기기" : "그리드 표시",
          action: () => setGrid((value) => !value),
        },
        {
          label: snapping ? "스마트 가이드 끄기" : "스마트 가이드 켜기",
          action: () => setSnapping((value) => !value),
        },
      ],
    };
    function renderLayer(object: VectorObject, depth = 0): React.ReactNode {
      return (
        <div key={object.id}>
          <div
            className={`vector-layer-row ${selection.includes(object.id) ? "selected" : ""}`}
            style={{ paddingLeft: 5 + depth * 13 }}
            data-testid={`vector-layer.${object.id}`}
          >
            <button
              className="vector-layer-name"
              type="button"
              onClick={(event) => {
                setSelection(
                  event.shiftKey
                    ? selection.includes(object.id)
                      ? selection.filter((id) => id !== object.id)
                      : [...selection, object.id]
                    : [object.id],
                );
                setAnchorSelection([]);
              }}
              title={object.name}
            >
              <span>
                {object.type === "group"
                  ? "▾"
                  : object.type === "text"
                    ? "T"
                    : "◇"}
              </span>
              {object.name}
            </button>
            <button
              type="button"
              aria-label={`${object.name} ${object.visible ? "숨기기" : "표시"}`}
              onClick={() => {
                const next = copy(document!);
                next.objects.find((item) => item.id === object.id)!.visible =
                  !object.visible;
                commit(next);
              }}
            >
              {object.visible ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
            <button
              type="button"
              aria-label={`${object.name} ${object.locked ? "잠금 해제" : "잠금"}`}
              onClick={() => {
                const next = copy(document!);
                next.objects.find((item) => item.id === object.id)!.locked =
                  !object.locked;
                commit(next);
              }}
            >
              {object.locked ? (
                <LockKeyhole size={12} />
              ) : (
                <UnlockKeyhole size={12} />
              )}
            </button>
          </div>
          {activeObjects
            .filter((child) => child.parentId === object.id)
            .slice()
            .reverse()
            .map((child) => renderLayer(child, depth + 1))}
        </div>
      );
    }
    return (
      <section
        ref={workspace}
        className="vector-studio"
        data-testid="vector-studio"
        onKeyDown={keyDown}
      >
        <input
          ref={importInput}
          type="file"
          accept=".svg,image/svg+xml"
          aria-label="벡터 SVG 가져오기"
          className="vector-file-input"
          onChange={(event) => {
            void importFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <input
          ref={pngInput}
          type="file"
          accept=".png,image/png"
          aria-label="벡터 PNG 배치"
          className="vector-file-input"
          onChange={(event) => {
            void importImage(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <div className="vector-menu-bar">
          <strong>
            VECTOR <span>STUDIO</span>
          </strong>
          {Object.keys(menuItems).map((label) => (
            <div className="vector-menu-anchor" key={label}>
              <button
                aria-expanded={menu === label}
                type="button"
                onClick={() => setMenu(menu === label ? null : label)}
              >
                {label}
              </button>
              {menu === label && (
                <div className="vector-dropdown" role="menu">
                  {menuItems[label]!.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      role="menuitem"
                      disabled={item.disabled}
                      onClick={() => {
                        setMenu(null);
                        item.action();
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="vector-file-actions">
            <button
              type="button"
              onClick={() => command("import.svg")}
              title="SVG 가져오기"
              aria-label="SVG 가져오기"
            >
              <Upload size={13} />
              <span>SVG</span>
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={() => command("export.svg")}
              title="SVG 내보내기"
              aria-label="SVG 내보내기"
            >
              <Download size={13} />
              <span>SVG</span>
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={() => command("export.png")}
            >
              PNG
            </button>
          </div>
        </div>
        <div className="vector-context-bar">
          <label>
            문서
            <select
              aria-label="벡터 문서"
              value={document.id}
              onChange={(event) => {
                finishPen();
                setDocumentId(event.target.value);
                setSelection([]);
                setAnchorSelection([]);
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
            >
              {documents.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            title="새 벡터 문서"
            aria-label="새 벡터 문서"
            onClick={() => {
              finishPen();
              const next = createVectorDocument(
                `벡터 디자인 ${documents.length + 1}`,
              );
              commit(next);
              setDocumentId(next.id);
              setSelection([]);
            }}
          >
            <Plus size={13} />
          </button>
          <span className="vector-context-separator" />
          <label>
            칠
            <input
              type="color"
              aria-label="벡터 칠 색상"
              value={single ? paintColor(single.fill) : defaultFill}
              onChange={(event) => {
                setDefaultFill(event.target.value);
                updateObjects((object) => {
                  object.fill = solid(event.target.value);
                });
              }}
            />
          </label>
          <button
            type="button"
            className="vector-no-paint"
            title="칠 없음"
            aria-label="칠 없음"
            onClick={() =>
              updateObjects((object) => {
                object.fill = { type: "none" };
              })
            }
          >
            ∅
          </button>
          <label>
            선
            <input
              type="color"
              aria-label="벡터 선 색상"
              value={single ? paintColor(single.stroke.paint) : defaultStroke}
              onChange={(event) => {
                setDefaultStroke(event.target.value);
                updateObjects((object) => {
                  object.stroke.paint = solid(event.target.value);
                  if (!object.stroke.width) object.stroke.width = 2;
                });
              }}
            />
          </label>
          <label className="vector-stroke-width">
            <input
              type="number"
              min="0"
              max="1000"
              step="1"
              aria-label="벡터 선 두께"
              value={single?.stroke.width ?? defaultStrokeWidth}
              onChange={(event) => {
                const value = clamp(Number(event.target.value), 0, 1000);
                setDefaultStrokeWidth(value);
                updateObjects((object) => {
                  object.stroke.width = value;
                });
              }}
            />
            <span>px</span>
          </label>
          <span className="vector-context-separator" />
          <span className="vector-active-tool">
            {toolInfo.find((item) => item.id === tool)?.label}
          </span>
          {(tool === "polygon" || tool === "star") && (
            <label>
              꼭짓점
              <input
                type="number"
                min="3"
                max="32"
                aria-label="도형 꼭짓점 수"
                value={polygonSides}
                onChange={(event) =>
                  setPolygonSides(clamp(Number(event.target.value), 3, 32))
                }
              />
            </label>
          )}
          {tool === "roundrect" && (
            <label>
              반경
              <input
                type="number"
                min="0"
                max="4000"
                aria-label="둥근 사각형 반경"
                value={cornerRadius}
                onChange={(event) =>
                  setCornerRadius(clamp(Number(event.target.value), 0, 4000))
                }
              />
            </label>
          )}
        </div>
        <div className="vector-work-area">
          <nav className="vector-tool-rail" aria-label="벡터 도구">
            {toolInfo.map((item) => (
              <button
                key={item.id}
                type="button"
                className={tool === item.id ? "active" : ""}
                aria-label={`${item.label} 도구`}
                aria-pressed={tool === item.id}
                title={`${item.label}${item.key ? ` (${item.key})` : ""}`}
                onClick={() => {
                  finishPen();
                  setTool(item.id);
                  viewport.current?.focus({ preventScroll: true });
                }}
              >
                <item.icon
                  size={18}
                  fill={item.id === "direct" ? "currentColor" : "none"}
                />
                {item.key && <small>{item.key}</small>}
              </button>
            ))}
            <div className="vector-rail-swatches">
              <i style={{ background: defaultFill }} />
              <i style={{ background: defaultStroke }} />
            </div>
          </nav>
          <div className="vector-canvas-column">
            <div className="vector-artboard-tabs">
              <select
                aria-label="활성 아트보드"
                value={artboard.id}
                onChange={(event) => {
                  finishPen();
                  setArtboardId(event.target.value);
                  setSelection([]);
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
              >
                {document.artboards.map((board) => (
                  <option value={board.id} key={board.id}>
                    {board.name}
                  </option>
                ))}
              </select>
              <span>
                {artboard.width} × {artboard.height} px
              </span>
              <button
                type="button"
                title="아트보드 추가"
                aria-label="아트보드 추가"
                onClick={() => addArtboard()}
              >
                <Plus size={13} />
              </button>
            </div>
            <div
              ref={viewport}
              className={`vector-canvas-viewport tool-${spaceHeld ? "hand" : tool}`}
              tabIndex={0}
              aria-label="벡터 캔버스"
              data-testid="vector-canvas"
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={finishDrag}
              onLostPointerCapture={finishDrag}
              onDoubleClick={() => {
                if (tool === "select" && selection.length === 1)
                  setTool("direct");
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                finishPen();
                setContext({ x: event.clientX, y: event.clientY });
              }}
            >
              <svg
                ref={svg}
                width="100%"
                height="100%"
                xmlns="http://www.w3.org/2000/svg"
                aria-label="편집 가능한 벡터 아트보드"
              >
                <defs>
                  <pattern
                    id={`vector-grid-${document.id}`}
                    width="64"
                    height="64"
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M 64 0 L 0 0 0 64"
                      fill="none"
                      stroke="#668580"
                      strokeWidth={0.5 / scale}
                    />
                  </pattern>
                </defs>
                <g
                  ref={world}
                  transform={`translate(${offset.x} ${offset.y}) scale(${scale})`}
                >
                  <text
                    className="vector-artboard-label"
                    x={artboard.x}
                    y={artboard.y - 13 / scale}
                    fontSize={10 / scale}
                  >
                    {artboard.name}
                  </text>
                  <rect
                    x={artboard.x}
                    y={artboard.y}
                    width={artboard.width}
                    height={artboard.height}
                    fill={artboard.background ?? "#ffffff"}
                    className="vector-artboard-paper"
                  />
                  {grid && (
                    <rect
                      x={artboard.x}
                      y={artboard.y}
                      width={artboard.width}
                      height={artboard.height}
                      fill={`url(#vector-grid-${document.id})`}
                      pointerEvents="none"
                    />
                  )}
                  <VectorScene
                    document={document}
                    assets={project.assets}
                    artboardId={artboard.id}
                  />
                  {snapGuides.x !== undefined && (
                    <line
                      x1={snapGuides.x}
                      y1={artboard.y - 100}
                      x2={snapGuides.x}
                      y2={artboard.y + artboard.height + 100}
                      stroke="#db69cf"
                      strokeWidth={1 / scale}
                      pointerEvents="none"
                    />
                  )}
                  {snapGuides.y !== undefined && (
                    <line
                      x1={artboard.x - 100}
                      y1={snapGuides.y}
                      x2={artboard.x + artboard.width + 100}
                      y2={snapGuides.y}
                      stroke="#db69cf"
                      strokeWidth={1 / scale}
                      pointerEvents="none"
                    />
                  )}
                  {selectedBounds && selected.some((object) => unlocked(document, object)) && tool === "select" && (
                    <g className="vector-selection">
                      <rect
                        x={selectedBounds.x}
                        y={selectedBounds.y}
                        width={Math.max(0.1, selectedBounds.width)}
                        height={Math.max(0.1, selectedBounds.height)}
                        fill="none"
                        stroke="#087c68"
                        strokeWidth={1.2 / scale}
                        pointerEvents="none"
                      />
                      {[
                        ["tl", selectedBounds.x, selectedBounds.y],
                        [
                          "tr",
                          selectedBounds.x + selectedBounds.width,
                          selectedBounds.y,
                        ],
                        [
                          "bl",
                          selectedBounds.x,
                          selectedBounds.y + selectedBounds.height,
                        ],
                        [
                          "br",
                          selectedBounds.x + selectedBounds.width,
                          selectedBounds.y + selectedBounds.height,
                        ],
                      ].map(([corner, x, y]) => (
                        <rect
                          key={corner}
                          data-vector-transform="scale"
                          data-corner={corner}
                          x={Number(x) - 4 / scale}
                          y={Number(y) - 4 / scale}
                          width={8 / scale}
                          height={8 / scale}
                          fill="#e7fff8"
                          stroke="#087c68"
                          strokeWidth={1 / scale}
                          style={{ cursor: "nwse-resize" }}
                        />
                      ))}
                      <line
                        x1={selectedBounds.x + selectedBounds.width / 2}
                        x2={selectedBounds.x + selectedBounds.width / 2}
                        y1={selectedBounds.y}
                        y2={selectedBounds.y - 25 / scale}
                        stroke="#087c68"
                        strokeWidth={1 / scale}
                        pointerEvents="none"
                      />
                      <circle
                        data-vector-transform="rotate"
                        cx={selectedBounds.x + selectedBounds.width / 2}
                        cy={selectedBounds.y - 25 / scale}
                        r={4 / scale}
                        fill="#e7fff8"
                        stroke="#087c68"
                        strokeWidth={1 / scale}
                        style={{ cursor: "grab" }}
                      />
                    </g>
                  )}
                  {(tool === "direct" || tool === "pen") &&
                    selected
                      .filter((object) => object.geometry && unlocked(document, object))
                      .map((object) => (
                        <g key={object.id}>
                          {object.geometry!.contours.map((contour, ci) =>
                            contour.anchors.map((anchor, ai) => {
                              const matrix = worldMatrix(document, object),
                                p = applyMatrix(matrix, anchor),
                                active = anchorSelection.some(
                                  (item) =>
                                    item.objectId === object.id &&
                                    item.contour === ci &&
                                    item.anchor === ai,
                                );
                              return (
                                <g key={anchor.id}>
                                  {(["in", "out"] as const).map((handle) => {
                                    const control = anchor[handle];
                                    if (!control) return null;
                                    const q = applyMatrix(matrix, control);
                                    return (
                                      <g key={handle}>
                                        <line
                                          x1={p.x}
                                          y1={p.y}
                                          x2={q.x}
                                          y2={q.y}
                                          stroke="#1269c7"
                                          strokeWidth={1 / scale}
                                          pointerEvents="none"
                                        />
                                        <circle
                                          data-anchor-object={object.id}
                                          data-contour={ci}
                                          data-anchor={ai}
                                          data-handle={handle}
                                          cx={q.x}
                                          cy={q.y}
                                          r={3.8 / scale}
                                          fill="#fff"
                                          stroke="#1269c7"
                                          strokeWidth={1.2 / scale}
                                        />
                                      </g>
                                    );
                                  })}
                                  <rect
                                    data-anchor-object={object.id}
                                    data-contour={ci}
                                    data-anchor={ai}
                                    x={p.x - 4 / scale}
                                    y={p.y - 4 / scale}
                                    width={8 / scale}
                                    height={8 / scale}
                                    fill={active ? "#1269c7" : "#fff"}
                                    stroke="#1269c7"
                                    strokeWidth={1.2 / scale}
                                  />
                                </g>
                              );
                            }),
                          )}
                        </g>
                      ))}
                  {marquee && (
                    <rect
                      {...marquee}
                      fill="#31a78c25"
                      stroke="#087c68"
                      strokeWidth={1 / scale}
                      strokeDasharray={`${4 / scale} ${3 / scale}`}
                      pointerEvents="none"
                    />
                  )}
                </g>
              </svg>
              {context && (
                <div
                  className="vector-context-menu"
                  role="menu"
                  style={{
                    left: Math.max(
                      0,
                      Math.min(
                        viewportSize.width - 170,
                        context.x -
                          (viewport.current?.getBoundingClientRect().left ?? 0),
                      ),
                    ),
                    top: Math.max(
                      0,
                      Math.min(
                        viewportSize.height - 240,
                        context.y -
                          (viewport.current?.getBoundingClientRect().top ?? 0),
                      ),
                    ),
                  }}
                >
                  {[
                    { label: "복사", id: "copy" },
                    { label: "붙여넣기", id: "paste" },
                    { label: "복제", id: "duplicate" },
                    { label: "그룹 만들기", id: "group" },
                    { label: "그룹 해제", id: "ungroup" },
                    { label: "복합 패스 만들기", id: "compound.create" },
                    { label: "삭제", id: "delete" },
                  ].map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      role="menuitem"
                      onClick={() => command(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="vector-canvas-footer">
              <button
                type="button"
                aria-label="벡터 축소"
                onClick={() => zoomAt(zoom / 1.25)}
              >
                <Minus size={12} />
              </button>
              <output aria-label="벡터 확대 비율">
                {Math.round(scale * 100)}%
              </output>
              <button
                type="button"
                aria-label="벡터 확대"
                onClick={() => zoomAt(zoom * 1.25)}
              >
                <Plus size={12} />
              </button>
              <button
                type="button"
                aria-label="벡터 화면에 맞춤"
                title="화면에 맞춤 (Ctrl+0)"
                onClick={() => command("fit")}
              >
                <Maximize2 size={12} />
              </button>
              <button
                type="button"
                aria-pressed={snapping}
                aria-label="벡터 스마트 가이드"
                onClick={() => setSnapping((value) => !value)}
              >
                <Magnet size={12} />
              </button>
              <span className="vector-footer-hint">
                {penId.current
                  ? "드래그로 곡선 · 첫 점 클릭 닫기 · Enter 종료"
                  : tool === "direct"
                    ? "앵커·핸들 드래그 · Alt 핸들 분리"
                    : "Space 이동 · Ctrl+휠 확대 · Shift 비율 고정"}
              </span>
              <span>{selected.length}개 선택 · px</span>
            </div>
          </div>
          <aside className="vector-inspector" aria-label="벡터 속성 및 레이어">
            <div className="vector-inspector-title">
              <span>속성</span>
              <span>
                {single
                  ? single.type === "text"
                    ? "문자"
                    : single.type === "group"
                      ? "그룹"
                      : "패스"
                  : selected.length > 1
                    ? `${selected.length}개 개체`
                    : "아트보드"}
              </span>
            </div>
            <div className="vector-inspector-scroll">
              <section className="vector-panel">
                <h3>{selected.length ? "개체 변형" : "아트보드 설정"}</h3>
                <label className="vector-full-field">
                  <span>이름</span>
                  <input
                    aria-label={
                      selected.length ? "벡터 개체 이름" : "아트보드 이름"
                    }
                    value={
                      single?.name ??
                      (!selected.length
                        ? artboard.name
                        : `${selected.length}개 선택`)
                    }
                    disabled={selected.length > 1}
                    onChange={(event) =>
                      single
                        ? updateObjects((object) => {
                            object.name = event.target.value.slice(0, 160);
                          })
                        : changeArtboard({
                            name: event.target.value.slice(0, 160),
                          })
                    }
                  />
                </label>
                <div className="vector-number-grid">
                  {(["x", "y", "width", "height"] as const).map((key) => {
                    const value = (selectedBounds ?? artboard)[key];
                    return (
                      <CoordinateField
                        key={key}
                        caption={{ x: "X", y: "Y", width: "W", height: "H" }[key]}
                        label={`벡터 ${key}`}
                        value={value}
                        onCommit={(next) => {
                            if (!selectedBounds) {
                              changeArtboard({
                                [key]:
                                  key === "width" || key === "height"
                                    ? clamp(next, 1, 16384)
                                    : clamp(next, -1e6, 1e6),
                              });
                              return;
                            }
                            if (key === "x" || key === "y")
                              transformSelection(
                                translationMatrix(
                                  key === "x" ? next - value : 0,
                                  key === "y" ? next - value : 0,
                                ),
                              );
                            else {
                              const factor =
                                Math.max(0.001, next) / Math.max(0.001, value);
                              transformSelection(
                                multiplyMatrices(
                                  translationMatrix(
                                    selectedBounds.x,
                                    selectedBounds.y,
                                  ),
                                  multiplyMatrices(
                                    scaleMatrix(
                                      key === "width" ? factor : 1,
                                      key === "height" ? factor : 1,
                                    ),
                                    translationMatrix(
                                      -selectedBounds.x,
                                      -selectedBounds.y,
                                    ),
                                  ),
                                ),
                              );
                            }
                        }}
                      />
                    );
                  })}
                </div>
                {selected.length > 0 ? (
                  <>
                    <label className="vector-full-field">
                      <span>회전 Δ</span>
                      <input
                        type="number"
                        aria-label="벡터 회전 각도"
                        defaultValue="0"
                        key={selection.join(",") + project.updatedAt}
                        onBlur={(event) => {
                          const angle = Number(event.target.value);
                          if (angle && selectedBounds)
                            transformSelection(
                              rotationMatrix(
                                angle,
                                selectedBounds.x + selectedBounds.width / 2,
                                selectedBounds.y + selectedBounds.height / 2,
                              ),
                            );
                        }}
                      />
                      <span>°</span>
                    </label>
                    <label className="vector-full-field">
                      <span>불투명도</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        aria-label="벡터 불투명도"
                        value={Math.round((single?.opacity ?? 1) * 100)}
                        onChange={(event) =>
                          updateObjects((object) => {
                            object.opacity = clamp(
                              Number(event.target.value) / 100,
                              0,
                              1,
                            );
                          })
                        }
                      />
                      <span>%</span>
                    </label>
                  </>
                ) : (
                  <>
                    <label className="vector-full-field">
                      <span>단위</span>
                      <select
                        aria-label="아트보드 단위"
                        value={artboard.unit}
                        onChange={(event) =>
                          changeArtboard({ unit: event.target.value as "px" })
                        }
                      >
                        {["px", "mm", "cm", "pt"].map((unit) => (
                          <option key={unit}>{unit}</option>
                        ))}
                      </select>
                    </label>
                    <small className="vector-unit-note">
                      좌표는 CSS px · 96 px = 1 inch
                      <br />
                      {fieldValue((artboard.width / 96) * 25.4)} ×{" "}
                      {fieldValue((artboard.height / 96) * 25.4)} mm
                    </small>
                    <div className="vector-button-row">
                      <button type="button" onClick={() => addArtboard(true)}>
                        <Copy size={12} />
                        복제
                      </button>
                      <button
                        type="button"
                        title="가로 세로 전환"
                        onClick={() =>
                          changeArtboard({
                            width: artboard.height,
                            height: artboard.width,
                          })
                        }
                      >
                        <RotateCcw size={12} />
                        회전
                      </button>
                    </div>
                    {document.artboards.length > 1 && (
                      <button
                        type="button"
                        className="vector-wide-button"
                        onClick={() => {
                          const next = copy(document);
                          next.artboards = next.artboards.filter(
                            (item) => item.id !== artboard.id,
                          );
                          next.objects = next.objects.filter(
                            (object) => object.artboardId !== artboard.id,
                          );
                          commit(next);
                          setArtboardId(next.artboards[0]!.id);
                          setSelection([]);
                        }}
                      >
                        현재 아트보드 삭제
                      </button>
                    )}
                  </>
                )}
              </section>
              {single?.text && (
                <section className="vector-panel">
                  <h3>문자</h3>
                  <TextField
                    key={single.id}
                    label="벡터 문자 내용"
                    value={single.text.content}
                    disabled={single.locked}
                    onCommit={(content) =>
                      updateObjects((object) => {
                        if (object.text)
                          object.text.content = content.slice(0, 2000);
                      })
                    }
                  />
                  <div className="vector-number-grid">
                    <label>
                      <span>크기</span>
                      <input
                        type="number"
                        aria-label="벡터 문자 크기"
                        min="1"
                        max="2000"
                        value={single.text.fontSize}
                        onChange={(event) =>
                          updateObjects((object) => {
                            if (object.text)
                              object.text.fontSize = clamp(
                                Number(event.target.value),
                                1,
                                2000,
                              );
                          })
                        }
                      />
                    </label>
                    <CoordinateField
                        caption="자간"
                        label="벡터 문자 자간"
                        value={single.text.letterSpacing}
                        onCommit={(value) =>
                          updateObjects((object) => {
                            if (object.text)
                              object.text.letterSpacing = clamp(
                                value,
                                -100,
                                1000,
                              );
                          })
                        }
                    />
                  </div>
                  <label className="vector-full-field">
                    <span>두께</span>
                    <select
                      aria-label="벡터 문자 두께"
                      value={single.text.fontWeight}
                      onChange={(event) =>
                        updateObjects((object) => {
                          if (object.text)
                            object.text.fontWeight = Number(event.target.value);
                        })
                      }
                    >
                      <option value="400">Regular</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="vector-wide-button"
                    onClick={() => void outlineText()}
                  >
                    문자 윤곽선 만들기
                  </button>
                  <small className="vector-unit-note">
                    로컬 Noto Sans KR Regular · 실제 글리프 패스
                  </small>
                </section>
              )}
              {selected.length > 0 && (
                <section className="vector-panel">
                  <h3>모양</h3>
                  <label className="vector-full-field">
                    <span>칠 방식</span>
                    <select
                      aria-label="벡터 칠 방식"
                      value={single?.fill.type ?? "solid"}
                      onChange={(event) =>
                        updateObjects((object) => {
                          object.fill =
                            event.target.value === "none"
                              ? { type: "none" }
                              : event.target.value === "solid"
                                ? solid(defaultFill)
                                : event.target.value === "linear"
                                  ? {
                                      type: "linear",
                                      x1: 0,
                                      y1: 0,
                                      x2: 1,
                                      y2: 1,
                                      units: "objectBoundingBox",
                                      transform: identityMatrix(),
                                      stops: [
                                        {
                                          offset: 0,
                                          color: defaultFill,
                                          opacity: 1,
                                        },
                                        {
                                          offset: 1,
                                          color: "#176986",
                                          opacity: 1,
                                        },
                                      ],
                                    }
                                  : {
                                      type: "radial",
                                      cx: 0.5,
                                      cy: 0.5,
                                      fx: 0.5,
                                      fy: 0.5,
                                      r: 0.5,
                                      units: "objectBoundingBox",
                                      transform: identityMatrix(),
                                      stops: [
                                        {
                                          offset: 0,
                                          color: defaultFill,
                                          opacity: 1,
                                        },
                                        {
                                          offset: 1,
                                          color: "#176986",
                                          opacity: 1,
                                        },
                                      ],
                                    };
                        })
                      }
                    >
                      <option value="solid">단색</option>
                      <option value="none">없음</option>
                      <option value="linear">선형 그라디언트</option>
                      <option value="radial">방사형 그라디언트</option>
                    </select>
                  </label>
                  {(single?.fill.type === "linear" ||
                    single?.fill.type === "radial") && (
                    <div className="vector-gradient-stops">
                      {single.fill.stops.map((stop, index) => (
                        <label key={index}>
                          <span>{Math.round(stop.offset * 100)}%</span>
                          <input
                            type="color"
                            aria-label={`그라디언트 색상 ${index + 1}`}
                            value={stop.color}
                            onChange={(event) =>
                              updateObjects((object) => {
                                if (
                                  object.fill.type === "linear" ||
                                  object.fill.type === "radial"
                                )
                                  object.fill.stops[index]!.color =
                                    event.target.value;
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                  )}
                  {single?.geometry && (
                    <label className="vector-full-field">
                      <span>채움 규칙</span>
                      <select
                        aria-label="채움 규칙"
                        value={single.geometry.fillRule}
                        onChange={(event) =>
                          updateObjects((object) => {
                            if (object.geometry)
                              object.geometry.fillRule = event.target
                                .value as "evenodd";
                          })
                        }
                      >
                        <option value="nonzero">Non-Zero</option>
                        <option value="evenodd">Even-Odd · 구멍</option>
                      </select>
                    </label>
                  )}
                  <label className="vector-full-field">
                    <span>선 끝</span>
                    <select
                      aria-label="벡터 선 끝"
                      value={single?.stroke.lineCap ?? "round"}
                      onChange={(event) =>
                        updateObjects((object) => {
                          object.stroke.lineCap = event.target.value as "round";
                        })
                      }
                    >
                      <option value="butt">평면</option>
                      <option value="round">둥글게</option>
                      <option value="square">사각</option>
                    </select>
                  </label>
                  <label className="vector-full-field">
                    <span>선 연결</span>
                    <select
                      aria-label="벡터 선 연결"
                      value={single?.stroke.lineJoin ?? "round"}
                      onChange={(event) =>
                        updateObjects((object) => {
                          object.stroke.lineJoin = event.target
                            .value as "round";
                        })
                      }
                    >
                      <option value="miter">각지게</option>
                      <option value="round">둥글게</option>
                      <option value="bevel">베벨</option>
                    </select>
                  </label>
                </section>
              )}
              {tool === "direct" && single?.geometry && (
                <section className="vector-panel">
                  <h3>앵커 · {anchorSelection.length}개 선택</h3>
                  <div className="vector-button-grid">
                    {[
                      { label: "점 추가", action: "add" },
                      { label: "점 제거", action: "remove" },
                      { label: "코너", action: "corner" },
                      { label: "곡선", action: "smooth" },
                    ].map((item) => (
                      <button
                        type="button"
                        key={item.action}
                        disabled={!anchorSelection.length}
                        onClick={() => editPath(item.action as "add")}
                      >
                        {item.label}
                      </button>
                    ))}
                    <button type="button" onClick={() => editPath("close")}>
                      {single.geometry.contours[0]?.closed
                        ? "패스 열기"
                        : "패스 닫기"}
                    </button>
                    <button type="button" onClick={() => editPath("reverse")}>
                      방향 반전
                    </button>
                  </div>
                </section>
              )}
              <section className="vector-panel">
                <h3>
                  정렬{" "}
                  <small>
                    {selected.length > 1 ? "선택 영역 기준" : "아트보드 기준"}
                  </small>
                </h3>
                <div className="vector-align-grid">
                  {(
                    [
                      "left",
                      "center",
                      "right",
                      "top",
                      "middle",
                      "bottom",
                    ] as const
                  ).map((axis, index) => (
                    <button
                      type="button"
                      key={axis}
                      disabled={!selected.length}
                      aria-label={`벡터 ${["왼쪽", "가로 중앙", "오른쪽", "위쪽", "세로 중앙", "아래쪽"][index]} 정렬`}
                      title={
                        [
                          "왼쪽",
                          "가로 중앙",
                          "오른쪽",
                          "위쪽",
                          "세로 중앙",
                          "아래쪽",
                        ][index]
                      }
                      onClick={() => align(axis)}
                    >
                      {["⇤", "↔", "⇥", "⤒", "↕", "⤓"][index]}
                    </button>
                  ))}
                </div>
              </section>
              <section className="vector-panel">
                <h3>도형 연산</h3>
                <div className="vector-button-grid">
                  {(
                    [
                      { id: "union", label: "합치기" },
                      { id: "difference", label: "앞면 빼기" },
                      { id: "intersection", label: "교차 영역" },
                      { id: "xor", label: "겹침 제외" },
                      { id: "divide", label: "분할" },
                    ] as const
                  ).map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      disabled={
                        selected.filter((object) => object.geometry).length < 2
                      }
                      onClick={() => boolean(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={selected.length < 2}
                    onClick={() => compound()}
                  >
                    복합 패스
                  </button>
                </div>
                <small className="vector-unit-note">
                  앞면 빼기: 맨 아래 개체에서 위 개체를 뺍니다.
                </small>
              </section>
              <section className="vector-panel vector-binding-panel">
                <h3>
                  3D 의류에 적용{" "}
                  <i>{bindings.length ? "실시간 연결" : "준비됨"}</i>
                </h3>
                <label className="vector-full-field">
                  <span>부위</span>
                  <select
                    aria-label="벡터 적용 부위"
                    value={bindingRegion}
                    onChange={(event) => setBindingRegion(event.target.value)}
                  >
                    {Object.keys(project.regions).map((region) => (
                      <option value={region} key={region}>
                        {regionLabels[region] ?? region}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="vector-apply-button"
                  onClick={bindArtboard}
                >
                  현재 아트보드 적용
                </button>
                {bindings.map((layer) => (
                  <div className="vector-binding-row" key={layer.id}>
                    <span>
                      {regionLabels[layer.regionId] ?? layer.regionId}
                    </span>
                    <span>
                      {Math.round(layer.width * 100)}% ×{" "}
                      {Math.round(layer.height * 100)}%
                    </span>
                    <button
                      type="button"
                      aria-label={`${regionLabels[layer.regionId] ?? layer.regionId} 벡터 연결 해제`}
                      onClick={() =>
                        execute({
                          id: "vector.garment.unbind",
                          layerId: layer.id,
                        })
                      }
                    >
                      해제
                    </button>
                  </div>
                ))}
                {bindings[0] && (
                  <div className="vector-number-grid">
                    {(["x", "y", "width", "height"] as const).map((key) => (
                      <label key={key}>
                        <span>
                          {
                            { x: "X %", y: "Y %", width: "W %", height: "H %" }[
                              key
                            ]
                          }
                        </span>
                        <input
                          type="number"
                          aria-label={`의류 벡터 ${key}`}
                          value={fieldValue(bindings[0]![key] * 100)}
                          onChange={(event) =>
                            execute({
                              id: "artwork.update",
                              layerId: bindings[0]!.id,
                              patch: {
                                [key]: Number(event.target.value) / 100,
                              },
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                )}
              </section>
            </div>
            <section className="vector-panel vector-layers-panel">
              <h3>
                <Layers size={13} />
                레이어 <small>{activeObjects.length}</small>
              </h3>
              <div className="vector-layer-actions">
                <button
                  type="button"
                  title="그룹 만들기"
                  aria-label="벡터 그룹 만들기"
                  disabled={selection.length < 2}
                  onClick={groupSelection}
                >
                  <Layers size={13} />
                </button>
                <button
                  type="button"
                  title="그룹 해제"
                  aria-label="벡터 그룹 해제"
                  disabled={!selected.some((object) => object.type === "group")}
                  onClick={ungroupSelection}
                >
                  <Ungroup size={13} />
                </button>
                <button
                  type="button"
                  title="한 단계 앞으로"
                  aria-label="벡터 앞으로"
                  disabled={!selection.length}
                  onClick={() => reorder("up")}
                >
                  ↑
                </button>
                <button
                  type="button"
                  title="한 단계 뒤로"
                  aria-label="벡터 뒤로"
                  disabled={!selection.length}
                  onClick={() => reorder("down")}
                >
                  ↓
                </button>
                <button
                  type="button"
                  title="복제"
                  aria-label="벡터 복제"
                  disabled={!selection.length}
                  onClick={() => pasteSelected(true)}
                >
                  <Copy size={13} />
                </button>
                <button
                  type="button"
                  title="삭제"
                  aria-label="벡터 삭제"
                  disabled={!selection.length}
                  onClick={removeSelected}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="vector-layers-list">
                {activeObjects
                  .filter((object) => !object.parentId)
                  .slice()
                  .reverse()
                  .map((object) => renderLayer(object))}
                {!activeObjects.length && (
                  <p className="vector-empty-layers">
                    도구를 선택하고 아트보드에 드래그하세요.
                    <br />
                    SVG 파일도 편집할 수 있습니다.
                  </p>
                )}
              </div>
            </section>
          </aside>
        </div>
      </section>
    );
  },
);
