import { useRef } from "react";

export function PanelResize({
  label,
  value,
  min,
  max,
  direction = 1,
  onChange,
  hidden,
  reset,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  direction?: 1 | -1;
  onChange: (value: number) => void;
  hidden?: boolean;
  reset: number;
}) {
  const start = useRef({ x: 0, value });
  const change = (next: number) => onChange(Math.max(min, Math.min(max, next)));
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      className="panel-resizer"
      hidden={hidden}
      title="드래그하여 너비 조절 · 두 번 클릭하여 초기화"
      onDoubleClick={() => change(reset)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          change(
            value +
              (event.key === "ArrowRight" ? 1 : -1) *
                direction *
                (event.shiftKey ? 32 : 8),
          );
        } else if (event.key === "Home") {
          event.preventDefault();
          change(min);
        } else if (event.key === "End") {
          event.preventDefault();
          change(max);
        }
      }}
      onPointerDown={(event) => {
        start.current = { x: event.clientX, value };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          change(
            start.current.value + (event.clientX - start.current.x) * direction,
          );
      }}
    >
      <span />
    </div>
  );
}
