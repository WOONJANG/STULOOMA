import type { ReactNode } from "react";
import type { AssetRecord } from "../../types/project";
import type {
  VectorBounds,
  VectorDocument,
  VectorMatrix,
  VectorObject,
  VectorPaint,
} from "../../types/vector";
import {
  applyMatrix,
  geometryToPathData,
  getPathBounds,
  invertMatrix,
  multiplyMatrices,
} from "../../core/vector/geometry";

export const copy = <T,>(value: T): T => structuredClone(value);
export function worldMatrix(
  document: VectorDocument,
  object: VectorObject,
): VectorMatrix {
  const parent = document.objects.find((item) => item.id === object.parentId);
  return parent
    ? multiplyMatrices(worldMatrix(document, parent), object.transform)
    : object.transform;
}
export function descendants(document: VectorDocument, ids: string[]): string[] {
  const found = new Set(ids);
  for (let i = 0; i < document.objects.length; i++)
    for (const object of document.objects)
      if (object.parentId && found.has(object.parentId)) found.add(object.id);
  return [...found];
}
export function roots(document: VectorDocument, ids: string[], includeLocked = false): VectorObject[] {
  const all = new Set(ids);
  return document.objects.filter((object) => {
    if (!all.has(object.id) || (!includeLocked && !unlocked(document, object))) return false;
    let parent = object.parentId;
    while (parent) {
      if (all.has(parent)) return false;
      parent =
        document.objects.find((item) => item.id === parent)?.parentId ?? null;
    }
    return true;
  });
}
export function bounds(
  document: VectorDocument,
  object: VectorObject,
): VectorBounds {
  if (object.type === "group")
    return unionBounds(
      document.objects
        .filter((item) => item.parentId === object.id)
        .map((item) => bounds(document, item)),
    );
  const matrix = worldMatrix(document, object);
  if (object.geometry) return getPathBounds(object.geometry, matrix);
  let width = object.image?.width ?? 1,
    height = object.image?.height ?? 1,
    x = 0,
    y = 0;
  if (object.text) {
    const text = object.text,
      lines = text.content.split("\n");
    const context = window.document.createElement("canvas").getContext("2d")!;
    context.font = `${text.fontWeight} ${text.fontSize}px "${text.fontFamily}"`;
    width = Math.max(
      1,
      ...lines.map(
        (line) =>
          context.measureText(line).width +
          Math.max(0, [...line].length - 1) * text.letterSpacing,
      ),
    );
    const metrics = context.measureText(text.content || "M");
    y = -(metrics.actualBoundingBoxAscent || text.fontSize * 0.85);
    height =
      (metrics.actualBoundingBoxAscent || text.fontSize * 0.85) +
      (metrics.actualBoundingBoxDescent || text.fontSize * 0.15) +
      (lines.length - 1) * text.fontSize * text.lineHeight;
    x =
      text.alignment === "middle"
        ? -width / 2
        : text.alignment === "end"
          ? -width
          : 0;
  }
  const points = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ].map((point) => applyMatrix(matrix, point));
  return {
    x: Math.min(...points.map((point) => point.x)),
    y: Math.min(...points.map((point) => point.y)),
    width:
      Math.max(...points.map((point) => point.x)) -
      Math.min(...points.map((point) => point.x)),
    height:
      Math.max(...points.map((point) => point.y)) -
      Math.min(...points.map((point) => point.y)),
  };
}
export function unionBounds(items: VectorBounds[]): VectorBounds {
  if (!items.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...items.map((item) => item.x)),
    y = Math.min(...items.map((item) => item.y));
  return {
    x,
    y,
    width: Math.max(...items.map((item) => item.x + item.width)) - x,
    height: Math.max(...items.map((item) => item.y + item.height)) - y,
  };
}
export function unlocked(
  document: VectorDocument,
  object: VectorObject,
): boolean {
  if (object.locked || !object.visible) return false;
  const parent = document.objects.find((item) => item.id === object.parentId);
  return !parent || unlocked(document, parent);
}
const matrixString = (matrix: VectorMatrix) => `matrix(${matrix.join(" ")})`;
const paintValue = (paint: VectorPaint, id: string) =>
  paint.type === "none"
    ? "none"
    : paint.type === "solid"
      ? paint.color
      : `url(#${id})`;
function paintDefinition(paint: VectorPaint, id: string): ReactNode {
  if (paint.type !== "linear" && paint.type !== "radial") return null;
  const stops = paint.stops.map((stop, index) => (
    <stop
      key={index}
      offset={stop.offset}
      stopColor={stop.color}
      stopOpacity={stop.opacity}
    />
  ));
  const common = {
    id,
    gradientUnits: paint.units,
    gradientTransform: matrixString(paint.transform),
  };
  return paint.type === "linear" ? (
    <linearGradient
      {...common}
      x1={paint.x1}
      y1={paint.y1}
      x2={paint.x2}
      y2={paint.y2}
    >
      {stops}
    </linearGradient>
  ) : (
    <radialGradient
      {...common}
      cx={paint.cx}
      cy={paint.cy}
      r={paint.r}
      fx={paint.fx}
      fy={paint.fy}
    >
      {stops}
    </radialGradient>
  );
}
export function VectorScene({
  document,
  assets,
  artboardId,
}: {
  document: VectorDocument;
  assets: Record<string, AssetRecord>;
  artboardId: string;
}) {
  const clipIds = new Set(
    document.objects.flatMap((object) =>
      object.clipPathId ? [object.clipPathId] : [],
    ),
  );
  function draw(object: VectorObject, definition = false): ReactNode {
    if (!definition && (!object.visible || clipIds.has(object.id))) return null;
    const fillId = `vf-${object.id}`,
      strokeId = `vs-${object.id}`;
    const attributes = {
      transform: matrixString(object.transform),
      opacity: object.opacity,
      fill: paintValue(object.fill, fillId),
      fillOpacity:
        object.fill.type === "solid" ? object.fill.opacity : undefined,
      stroke: paintValue(object.stroke.paint, strokeId),
      strokeOpacity:
        object.stroke.paint.type === "solid"
          ? object.stroke.paint.opacity
          : undefined,
      strokeWidth: object.stroke.width,
      strokeLinecap: object.stroke.lineCap,
      strokeLinejoin: object.stroke.lineJoin,
      strokeMiterlimit: object.stroke.miterLimit,
      strokeDasharray: object.stroke.dash.join(" "),
      strokeDashoffset: object.stroke.dashOffset,
      clipPath: object.clipPathId ? `url(#vc-${object.id})` : undefined,
      "data-vector-object": definition ? undefined : object.id,
      "data-testid": definition ? undefined : `vector-object.${object.id}`,
      style: {
        pointerEvents: definition
          ? ("none" as const)
          : object.locked
            ? ("none" as const)
            : ("visiblePainted" as const),
      },
    };
    if (object.type === "group")
      return (
        <g key={object.id} {...attributes}>
          {document.objects
            .filter((item) => item.parentId === object.id)
            .map((item) => draw(item, definition))}
        </g>
      );
    if (object.geometry)
      return (
        <path
          key={object.id}
          {...attributes}
          d={geometryToPathData(object.geometry)}
          fillRule={object.geometry.fillRule}
          clipRule={object.geometry.fillRule}
        />
      );
    if (object.type === "text" && object.text)
      return (
        <text
          key={object.id}
          {...attributes}
          style={{
            ...attributes.style,
            fontVariantLigatures: "none",
            fontKerning: "normal",
          }}
          fontFamily={object.text.fontFamily}
          fontSize={object.text.fontSize}
          fontWeight={object.text.fontWeight}
          letterSpacing={object.text.letterSpacing}
          textAnchor={object.text.alignment}
          xmlSpace="preserve"
        >
          {object.text.content.split("\n").map((line, index) => (
            <tspan
              key={index}
              x={0}
              dy={index ? object.text!.fontSize * object.text!.lineHeight : 0}
            >
              {line || " "}
            </tspan>
          ))}
        </text>
      );
    if (object.type === "image" && object.image)
      return (
        <image
          key={object.id}
          {...attributes}
          href={assets[object.image.assetId]?.data}
          width={object.image.width}
          height={object.image.height}
        />
      );
    return null;
  }
  return (
    <>
      <defs>
        {document.objects.map((object) => (
          <g key={object.id}>
            {paintDefinition(object.fill, `vf-${object.id}`)}
            {paintDefinition(object.stroke.paint, `vs-${object.id}`)}
            {object.clipPathId && (
              <clipPath id={`vc-${object.id}`} clipPathUnits="userSpaceOnUse">
                {document.objects
                  .filter((item) => item.id === object.clipPathId)
                  .map((item) =>
                    draw(
                      {
                        ...item,
                        transform: multiplyMatrices(
                          invertMatrix(worldMatrix(document, object)),
                          worldMatrix(document, item),
                        ),
                      },
                      true,
                    ),
                  )}
              </clipPath>
            )}
          </g>
        ))}
      </defs>
      {document.objects
        .filter(
          (object) => object.artboardId === artboardId && !object.parentId,
        )
        .map((object) => draw(object))}
    </>
  );
}
