import { useEffect, useState } from "react";

export interface WorkspacePreferences {
  view: "split" | "3d" | "2d";
  splitRatio: number;
  libraryWidth: number;
  inspectorWidth: number;
  libraryVisible: boolean;
  inspectorVisible: boolean;
}
const defaults: WorkspacePreferences = {
  view: "split",
  splitRatio: 54,
  libraryWidth: 216,
  inspectorWidth: 296,
  libraryVisible: true,
  inspectorVisible: true,
};
const key = "stulooma.workspace.v1";
function readPreferences(): WorkspacePreferences {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "{}");
    const number = (
      name: keyof WorkspacePreferences,
      min: number,
      max: number,
    ) =>
      typeof value[name] === "number" && Number.isFinite(value[name])
        ? Math.max(min, Math.min(max, value[name]))
        : defaults[name];
    return {
      view: ["split", "3d", "2d"].includes(value.view)
        ? value.view
        : defaults.view,
      splitRatio: number("splitRatio", 35, 75) as number,
      libraryWidth: number("libraryWidth", 176, 320) as number,
      inspectorWidth: number("inspectorWidth", 264, 400) as number,
      libraryVisible:
        typeof value.libraryVisible === "boolean" ? value.libraryVisible : true,
      inspectorVisible:
        typeof value.inspectorVisible === "boolean"
          ? value.inspectorVisible
          : true,
    };
  } catch {
    return { ...defaults };
  }
}
export function useWorkspace() {
  const [preferences, setPreferences] = useState(readPreferences);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(preferences));
    } catch {
      /* workspace remains usable when storage is full */
    }
  }, [preferences]);
  const update = (patch: Partial<WorkspacePreferences>) =>
    setPreferences((current) => ({ ...current, ...patch }));
  return {
    ...preferences,
    update,
    reset: () => setPreferences({ ...defaults }),
  };
}
