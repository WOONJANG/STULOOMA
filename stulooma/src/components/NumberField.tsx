import { useEffect, useState } from "react";

export function TextField({ value, disabled, onCommit }: {
  value: string; disabled?: boolean; onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <textarea aria-label="텍스트 내용" disabled={disabled} value={draft}
    onChange={event => setDraft(event.target.value)} onBlur={() => onCommit(draft)}/>;
}

/** Keep incomplete numeric input local until committed, so typing a decimal or minus is possible. */
export function NumberField({
  label,
  value,
  unit,
  disabled,
  step = 0.5,
  onCommit,
}: {
  label: string;
  value: number;
  unit: string;
  disabled?: boolean;
  step?: number;
  onCommit: (value: number) => void;
}) {
  const rounded = Math.round(value * 100) / 100;
  const [draft, setDraft] = useState(String(rounded));
  useEffect(() => setDraft(String(rounded)), [rounded]);
  const commit = () => {
    const number = Number(draft);
    if (draft.trim() && Number.isFinite(number)) onCommit(number);
    else setDraft(String(rounded));
  };
  return (
    <label>
      <span>{label}</span>
      <div>
        <input
          type="number"
          aria-label={label}
          value={draft}
          step={step}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setDraft(String(rounded));
            }
          }}
        />
        <small>{unit}</small>
      </div>
    </label>
  );
}
