import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Box,
  Check,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyEnd,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyEnd,
  ChevronDown,
  Copy,
  Download,
  Eye,
  EyeOff,
  FilePlus2,
  FolderOpen,
  ImagePlus,
  Layers,
  Lock,
  Maximize2,
  Minus,
  MousePointer2,
  PanelLeft,
  PanelRight,
  Search,
  History,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Shirt,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Upload,
  X,
} from "lucide-react";
import type {
  ArtworkLayer,
  AssetRecord,
  GarmentSelection,
  ProjectDocument,
} from "../types/project";
import { createProject, loadProject, saveProject } from "../core/project";
import { importGLB } from "../core/import/glb";
import { bytesToDataURL, importPNG } from "../core/import/png";
import { portableFilename } from "../core/export/filename";
import { readLocal, writeLocal } from "../core/storage/local";
import { useStudio } from "../state/studio";
import { useWorkspace } from "../state/workspace";
import { PanelResize } from "../components/PanelResize";
import { NumberField, TextField } from "../components/NumberField";
import {
  MenuBar,
  CommandPalette,
  CommandContextMenu,
  type StudioCommand,
} from "../components/commands";
import { DesignCanvas } from "../features/design-editor/DesignCanvas";
import { Viewer, type ViewerHandle } from "../features/viewport/Viewer";

type SaveKind = "project" | "png" | "jpg" | "glb";
declare global {
  interface Window {
    stulooma?: {
      openProject(): Promise<{
        name: string;
        data: Uint8Array;
        documentToken: string;
      } | null>;
      saveProject(options: {
        name: string;
        data: Uint8Array;
        documentToken?: string;
        saveAs?: boolean;
      }): Promise<{ name: string; documentToken: string } | null>;
      saveFile(options: {
        name: string;
        data: Uint8Array;
        kind: SaveKind;
      }): Promise<boolean>;
    };
  }
}
interface UserModel {
  id: string;
  name: string;
  garment: GarmentSelection;
  asset: AssetRecord;
  regions: ProjectDocument["regions"];
}
const LABELS: Record<string, string> = {
  FRONT: "앞판",
  BACK: "뒷판",
  LEFT_SLEEVE: "왼쪽 소매",
  RIGHT_SLEEVE: "오른쪽 소매",
  COLLAR: "넥라인",
  LEFT_SIDE: "왼쪽 측면",
  RIGHT_SIDE: "오른쪽 측면",
};
const label = (id: string) => LABELS[id] ?? id;
const palette = [
  "#e7e2d9",
  "#161b1b",
  "#ffffff",
  "#273d36",
  "#6f9188",
  "#d38a6f",
  "#345881",
  "#a8b8d2",
  "#e9bc57",
  "#ab4250",
];
function Tool({
  children,
  title,
  onClick,
  disabled,
  accent = false,
}: {
  children: ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`tool ${accent ? "accent" : ""}`}
    >
      {children}
    </button>
  );
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const first = box.current?.querySelector<HTMLElement>('input,textarea,select')
      ?? box.current?.querySelector<HTMLElement>('button');
    if (!box.current?.contains(document.activeElement)) first?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      if (e.key === "Tab") {
        const controls = Array.from(
          box.current?.querySelectorAll<HTMLElement>(
            'button,input,select,textarea,[tabindex="0"]',
          ) ?? [],
        ).filter((el) => !el.hasAttribute("disabled"));
        const first = controls[0],
          last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal"
      >
        <header>
          <h2>{title}</h2>
          <button onClick={close} aria-label="닫기">
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
function GarmentIcon({ kind }: { kind: "tshirt" | "basketball" }) {
  return (
    <svg
      viewBox="0 0 140 140"
      aria-hidden="true"
      className={`garment-icon ${kind}`}
    >
      <defs>
        <linearGradient id={`garment-${kind}`} x1="0" x2="1">
          <stop stopColor="#bbb9ac" />
          <stop offset=".45" stopColor="#f2eee2" />
          <stop offset="1" stopColor="#aaa99d" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#garment-${kind})`}
        stroke="#96998e"
        strokeWidth="1"
        d={
          kind === "tshirt"
            ? "M50 24 34 30 13 57 32 70 42 58 38 118 Q70 124 102 118 L98 58 108 70 127 57 106 30 90 24 Q87 42 70 42 Q53 42 50 24Z"
            : "M48 22 39 27 Q48 56 30 64 L36 118 Q70 126 104 118 L110 64 Q92 56 101 27 L92 22 Q86 45 70 45 Q54 45 48 22Z"
        }
      />
      <path
        d={kind === "tshirt" ? "M50 24 Q70 49 90 24" : "M48 22 Q70 58 92 22"}
        fill="none"
        stroke="#8b9685"
        strokeWidth="3"
      />
      <path d="M45 110Q70 115 96 110" fill="none" stroke="#bbbbae" />
    </svg>
  );
}
export default function App() {
  const s = useStudio();
  const { project, execute } = s;
  const viewer = useRef<ViewerHandle>(null),
    pngInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    modelInput = useRef<HTMLInputElement>(null);
  const workspace = useWorkspace();
  const { view, splitRatio } = workspace;
  const setView = (view: "split" | "3d" | "2d") => workspace.update({ view });
  const setSplitRatio = (update: number | ((value: number) => number)) =>
    workspace.update({
      splitRatio: typeof update === "function" ? update(splitRatio) : update,
    });
  const documentBinding = useRef<{ projectId: string; token: string } | null>(
    null,
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [inspectorTab, setInspectorTab] = useState<"properties" | "history">(
    "properties",
  );
  const [renameLayerId, setRenameLayerId] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const dragDepth = useRef(0);
  const busyRef = useRef(false);
  const [libraryTab, setLibraryTab] = useState<"builtin" | "custom">("builtin");
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [exportOpen, setExportOpen] = useState(false),
    [helpOpen, setHelpOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"png" | "jpg" | "glb">(
    "png",
  );
  const [exportSize, setExportSize] = useState(2048);
  const [recovery, setRecovery] = useState<Uint8Array | null>(null);
  const [autoStatus, setAutoStatus] = useState("자동 복구 준비");
  const [userModels, setUserModels] = useState<UserModel[]>([]);
  const [pendingModel, setPendingModel] = useState<{
    asset: AssetRecord;
    meshes: { id: string; name: string; triangles: number }[];
    map: Record<string, string>;
    name: string;
  } | null>(null);
  const selected = project.layers.find((l) => l.id === s.selectedLayer);
  const region = project.regions[project.activeRegion];
  const [activeCamera, setActiveCamera] = useState("perspective");
  const announce = (message: string) => {
    setToast(message);
  };
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    readLocal<Uint8Array>("recovery")
      .then((data) => {
        if (data) setRecovery(data);
      })
      .catch(() => setAutoStatus("자동 복구 사용 불가"));
    readLocal<UserModel[]>("models")
      .then((models) => {
        if (models) setUserModels(models);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!s.dirty) return;
    let alive = true;
    const id = setTimeout(async () => {
      try {
        const data = await saveProject(project);
        if (!alive) return;
        await writeLocal("recovery", data);
        if (alive) setAutoStatus("자동 복구 저장됨");
      } catch {
        if (alive) setAutoStatus("자동 복구 실패 · 직접 저장하세요");
      }
    }, 900);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [project, s.dirty]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (useStudio.getState().dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  const confirmReplace = () =>
    !useStudio.getState().dirty ||
    window.confirm(
      "저장하지 않은 변경 사항이 있습니다. 현재 프로젝트를 바꿀까요?",
    );
  async function task(name: string, work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(name);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "작업을 완료하지 못했습니다.");
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }
  async function writeFile(name: string, data: Uint8Array, kind: SaveKind) {
    name = portableFilename(name);
    if (window.stulooma) return window.stulooma.saveFile({ name, data, kind });
    const blob = new Blob([data.slice().buffer], {
      type:
        kind === "project"
          ? "application/zip"
          : kind === "glb"
            ? "model/gltf-binary"
            : `image/${kind === "jpg" ? "jpeg" : "png"}`,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  }
  async function save(saveAs = false) {
    // Commit inspector drafts before capturing a revision, including calls
    // from menus or an external command instead of a mouse click.
    const focused = document.activeElement;
    if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) focused.blur();
    await task("프로젝트 저장 중", async () => {
      const p = useStudio.getState().project;
      const data = await saveProject(p);
      let saved = false;
      if (window.stulooma) {
        const binding = documentBinding.current;
        const result = await window.stulooma.saveProject({
          name: portableFilename(`${p.name || "STULOOMA"}.stulooma`),
          data,
          saveAs,
          documentToken:
            binding?.projectId === p.id ? binding.token : undefined,
        });
        saved = !!result;
        if (result && useStudio.getState().project.id === p.id)
          documentBinding.current = {
            projectId: p.id,
            token: result.documentToken,
          };
      } else
        saved = await writeFile(
          `${p.name || "STULOOMA"}.stulooma`,
          data,
          "project",
        );
      if (saved) {
        s.markSaved(p.id, p.updatedAt);
        announce(
          window.stulooma
            ? "프로젝트를 저장했습니다."
            : "프로젝트 파일 다운로드를 시작했습니다.",
        );
      }
    });
  }
  async function openBytes(bytes: Uint8Array, token?: string) {
    const opened = await loadProject(bytes);
    if (confirmReplace()) {
      s.replace(opened);
      documentBinding.current = token ? { projectId: opened.id, token } : null;
      setInspectorTab("properties");
      setRecovery(null);
      announce("편집 가능한 프로젝트를 열었습니다.");
    }
  }
  async function open() {
    if (window.stulooma) {
      await task("프로젝트 열기", async () => {
        const file = await window.stulooma!.openProject();
        if (file)
          await openBytes(new Uint8Array(file.data), file.documentToken);
      });
    } else projectInput.current?.click();
  }
  function addText() {
    const id = crypto.randomUUID();
    execute({
      id: "artwork.add",
      layer: {
        id,
        type: "text",
        name: "텍스트",
        text: "STULOOMA",
        color: "#1e3530",
        fontSize: 100,
        regionId: project.activeRegion,
        x: 0.5,
        y: 0.42,
        width: 0.7,
        height: 0.16,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
      },
    });
  }
  function selectGarment(kind: "tshirt" | "basketball") {
    if (project.garment.kind === kind) return;
    if (confirmReplace()) {
      s.newProject(kind);
      setActiveCamera("perspective");
      viewer.current?.setView("perspective");
    }
  }
  async function addPNG(file: File) {
    await task("PNG 이미지 확인 중", async () => {
      const asset = await importPNG(file);
      const image = new Image();
      image.src = asset.data;
      await image.decode();
      const width = 0.48,
        height = Math.min(
          0.8,
          (0.48 * image.naturalHeight) / image.naturalWidth,
        );
      const layer: ArtworkLayer = {
        id: crypto.randomUUID(),
        name: file.name,
        type: "image",
        assetId: asset.id,
        regionId: useStudio.getState().project.activeRegion,
        x: 0.5,
        y: 0.45,
        width,
        height,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
      };
      execute({ id: "artwork.add", layer, asset });
      announce("이미지를 추가했습니다. 캔버스에서 위치를 조절하세요.");
    });
  }
  async function importModel(file: File) {
    await task("GLB 구조·UV 검사 중", async () => {
      if (file.size > 32 * 1024 * 1024)
        throw new Error("GLB는 32 MB 이하로 선택하세요.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await importGLB(bytes);
      result.group.traverse((object: any) => {
        if (object.isMesh) {
          object.geometry.dispose();
          const ms = Array.isArray(object.material)
            ? object.material
            : [object.material];
          ms.forEach((m: any) => m.dispose());
        }
      });
      const map: Record<string, string> = {};
      result.meshes.forEach((mesh, i) => {
        map[mesh.id] = i === 0 ? "FRONT" : i === 1 ? "BACK" : `CUSTOM_${i + 1}`;
      });
      setPendingModel({
        asset: {
          id: crypto.randomUUID(),
          name: file.name,
          mime: "model/gltf-binary",
          data: bytesToDataURL(bytes, "model/gltf-binary"),
        },
        meshes: result.meshes,
        map,
        name: file.name.replace(/\.glb$/i, ""),
      });
    });
  }
  async function registerModel() {
    if (!pendingModel) return;
    const model = pendingModel;
    if (!confirmReplace()) return;
    await task("사용자 모델 등록 중", async () => {
      const regionMeshes: Record<string, string[]> = {};
      for (const [mesh, area] of Object.entries(model.map))
        (regionMeshes[area] ??= []).push(mesh);
      const regions = Object.fromEntries(
        Object.keys(regionMeshes).map((id) => [
          id,
          { color: "#e7e2d9", roughness: 0.8, metalness: 0 },
        ]),
      );
      const entry: UserModel = {
        id: crypto.randomUUID(),
        name: model.name || "사용자 의류",
        garment: {
          kind: "custom",
          name: model.name || "사용자 의류",
          assetId: model.asset.id,
          regionMeshes,
        },
        asset: model.asset,
        regions,
      };
      const models = [...userModels, entry];
      await writeLocal("models", models);
      setUserModels(models);
      activateUserModel(entry, false);
      setPendingModel(null);
      setLibraryTab("custom");
      announce("UV를 확인한 사용자 모델을 등록했습니다.");
    });
  }
  function activateUserModel(model: UserModel, confirm = true) {
    if (confirm && !confirmReplace()) return;
    const p = createProject();
    p.garment = structuredClone(model.garment);
    p.regions = structuredClone(model.regions);
    p.assets[model.asset.id] = model.asset;
    p.activeRegion = Object.keys(p.regions)[0];
    s.replace(p, true);
  }
  async function doExport() {
    await task("출력 파일 생성 중", async () => {
      if (!viewer.current) throw new Error("3D 뷰어를 준비하고 있습니다.");
      const data =
        exportFormat === "glb"
          ? await viewer.current.exportGLB()
          : await viewer.current.capture({
              width: exportSize,
              height: exportSize,
              transparent:
                project.settings.transparent && exportFormat === "png",
              mime: exportFormat === "jpg" ? "image/jpeg" : "image/png",
            });
      const result = await writeFile(
        `${project.name || "STULOOMA"}-${activeCamera}.${exportFormat}`,
        data,
        exportFormat,
      );
      if (result) {
        setExportOpen(false);
        announce("출력 파일을 생성했습니다.");
      }
    });
  }
  const commands: StudioCommand[] = [
    {
      id: "project.new",
      label: "새 프로젝트",
      group: "파일",
      shortcut: "Ctrl+N",
      keywords: "new",
    },
    {
      id: "project.open",
      label: "프로젝트 열기",
      group: "파일",
      shortcut: "Ctrl+O",
      keywords: "open",
    },
    {
      id: "project.save",
      label: "저장",
      group: "파일",
      shortcut: "Ctrl+S",
      keywords: "save",
    },
    {
      id: "project.saveAs",
      label: "다른 이름으로 저장",
      group: "파일",
      shortcut: "Ctrl+Shift+S",
      keywords: "save as",
    },
    {
      id: "export.png",
      label: "목업 내보내기",
      group: "파일",
      shortcut: "Ctrl+Shift+E",
      keywords: "export PNG JPG GLB",
    },
    {
      id: "edit.undo",
      label: "실행 취소",
      group: "편집",
      shortcut: "Ctrl+Z",
      disabled: !s.past.length,
    },
    {
      id: "edit.redo",
      label: "다시 실행",
      group: "편집",
      shortcut: "Ctrl+Shift+Z",
      disabled: !s.future.length,
    },
    {
      id: "edit.copy",
      label: "복사",
      group: "편집",
      shortcut: "Ctrl+C",
      disabled: !selected,
      keywords: "copy",
    },
    {
      id: "edit.paste",
      label: "붙여넣기",
      group: "편집",
      shortcut: "Ctrl+V",
      disabled: !s.canPaste,
      keywords: "paste",
    },
    {
      id: "edit.duplicate",
      label: "복제",
      group: "편집",
      shortcut: "Ctrl+D",
      disabled: !selected,
    },
    {
      id: "edit.rename",
      label: "레이어 이름 바꾸기",
      group: "편집",
      shortcut: "F2",
      disabled: !selected,
    },
    {
      id: "edit.delete",
      label: "삭제",
      group: "편집",
      shortcut: "Delete",
      disabled: !selected || selected.locked,
    },
    {
      id: "artwork.import",
      label: "PNG 이미지 추가",
      group: "디자인",
      keywords: "image import",
    },
    {
      id: "artwork.addText",
      label: "텍스트 추가",
      group: "디자인",
      keywords: "text type",
    },
    {
      id: "model.import",
      label: "GLB 모델 가져오기",
      group: "디자인",
      keywords: "model import",
    },
    ...(
      [
        ["left", "왼쪽 정렬"],
        ["center", "가로 가운데 정렬"],
        ["right", "오른쪽 정렬"],
        ["top", "위쪽 정렬"],
        ["middle", "세로 가운데 정렬"],
        ["bottom", "아래쪽 정렬"],
      ] as const
    ).map(([alignment, name]) => ({
      id: `align.${alignment}`,
      label: name,
      group: "디자인",
      disabled: !selected || selected.locked,
      keywords: "align 정렬",
    })),
    {
      id: "workspace.split",
      label: "분할 보기",
      group: "보기",
      checked: view === "split",
    },
    {
      id: "workspace.3d",
      label: "3D 목업",
      group: "보기",
      checked: view === "3d",
    },
    {
      id: "workspace.2d",
      label: "2D 디자인",
      group: "보기",
      checked: view === "2d",
    },
    {
      id: "workspace.library",
      label: "라이브러리 표시",
      group: "보기",
      checked: workspace.libraryVisible,
    },
    {
      id: "workspace.inspector",
      label: "속성 패널 표시",
      group: "보기",
      checked: workspace.inspectorVisible,
    },
    {
      id: "workspace.panels",
      label: "패널 표시 전환",
      group: "보기",
      shortcut: "Ctrl+\\",
    },
    {
      id: "workspace.history",
      label: "편집 기록",
      group: "보기",
      keywords: "history undo",
    },
    {
      id: "workspace.reset",
      label: "작업 공간 초기화",
      group: "보기",
      keywords: "reset layout",
    },
    {
      id: "view.perspective",
      label: "모델 전체 보기",
      group: "보기",
      shortcut: "F",
    },
    { id: "view.front", label: "정면 보기", group: "보기" },
    { id: "view.back", label: "후면 보기", group: "보기" },
    {
      id: "help.guide",
      label: "사용 가이드 및 단축키",
      group: "도움말",
      shortcut: "F1",
    },
    {
      id: "help.commands",
      label: "명령 검색",
      group: "도움말",
      shortcut: "Ctrl+K",
      keywords: "command search",
    },
  ];
  const command = (id: string) => {
    if (busyRef.current || commands.find((item) => item.id === id)?.disabled)
      return;
    setContextMenu(null);
    switch (id) {
      case "project.new":
        if (confirmReplace()) {
          s.newProject();
          documentBinding.current = null;
          setInspectorTab("properties");
        }
        break;
      case "project.open":
        void open();
        break;
      case "project.save":
        void save();
        break;
      case "project.saveAs":
        void save(true);
        break;
      case "edit.undo":
        s.undo();
        break;
      case "edit.redo":
        s.redo();
        break;
      case "edit.copy":
        if (s.copyLayer())
          announce(
            "선택한 레이어를 복사했습니다. 다른 부위에도 붙여넣을 수 있습니다.",
          );
        break;
      case "edit.paste":
        if (s.pasteLayer()) {
          setInspectorTab("properties");
          announce("현재 부위에 레이어를 붙여넣었습니다.");
        }
        break;
      case "artwork.import":
        pngInput.current?.click();
        break;
      case "artwork.addText":
        addText();
        setInspectorTab("properties");
        break;
      case "model.import":
        modelInput.current?.click();
        break;
      case "edit.delete":
        if (selected) execute({ id: "artwork.delete", layerId: selected.id });
        break;
      case "edit.duplicate":
        if (selected)
          execute({ id: "artwork.duplicate", layerId: selected.id });
        break;
      case "edit.rename":
        if (selected) setRenameLayerId(selected.id);
        break;
      case "view.zoomIn":
        viewer.current?.zoom(0.85);
        break;
      case "view.zoomOut":
        viewer.current?.zoom(1.15);
        break;
      case "export.png":
        setExportFormat("png");
        setExportOpen(true);
        break;
      case "workspace.split":
      case "workspace.3d":
      case "workspace.2d":
        setView(id.slice(10) as "split" | "3d" | "2d");
        break;
      case "workspace.library":
        workspace.update({ libraryVisible: !workspace.libraryVisible });
        break;
      case "workspace.inspector":
        workspace.update({ inspectorVisible: !workspace.inspectorVisible });
        break;
      case "workspace.panels": {
        const visible = !(
          workspace.libraryVisible || workspace.inspectorVisible
        );
        workspace.update({
          libraryVisible: visible,
          inspectorVisible: visible,
        });
        break;
      }
      case "workspace.history":
        workspace.update({ inspectorVisible: true });
        setInspectorTab("history");
        break;
      case "workspace.reset":
        workspace.reset();
        setInspectorTab("properties");
        announce("기본 작업 공간으로 되돌렸습니다.");
        break;
      case "help.guide":
        setHelpOpen(true);
        break;
      case "help.commands":
        setPaletteOpen(true);
        break;
      default:
        if (id.startsWith("align.") && selected)
          execute({
            id: "artwork.align",
            layerId: selected.id,
            alignment: id.slice(6) as
              | "left"
              | "center"
              | "right"
              | "top"
              | "middle"
              | "bottom",
          });
        else if (id.startsWith("view.")) {
          const name = id.slice(5) as
            | "front"
            | "back"
            | "left"
            | "right"
            | "perspective";
          viewer.current?.setView(name);
          setActiveCamera(name);
        }
    }
  };
  const commandRef = useRef(command);
  commandRef.current = command;
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229)
        return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const target = event.target as HTMLElement;
      const input = target.matches(
        'input,textarea,select,[contenteditable="true"]',
      );
      const modifier = event.ctrlKey || event.metaKey,
        key = event.key.toLowerCase();
      if (input && !(modifier && (key === "s" || key === "k"))) return;
      let id = "";
      if (modifier) {
        const shortcuts: Record<string, string> = {
          s: event.shiftKey ? "project.saveAs" : "project.save",
          o: "project.open",
          n: "project.new",
          z: event.shiftKey ? "edit.redo" : "edit.undo",
          y: "edit.redo",
          d: "edit.duplicate",
          c: "edit.copy",
          v: "edit.paste",
          k: "help.commands",
          "\\": "workspace.panels",
        };
        id =
          key === "e" && event.shiftKey ? "export.png" : (shortcuts[key] ?? "");
      } else if (event.key === "Delete" || event.key === "Backspace")
        id = "edit.delete";
      else if (event.key === "F2") id = "edit.rename";
      else if (event.key === "F1") id = "help.guide";
      else if (event.key === "Escape") useStudio.getState().selectLayer(null);
      else if (key === "f") id = "view.perspective";
      else if (
        event.key.startsWith("Arrow") &&
        !target.closest('[role="separator"], [role="tablist"]')
      ) {
        const state = useStudio.getState(),
          amount = event.shiftKey ? 0.01 : 0.001;
        if (state.selectedLayer) {
          event.preventDefault();
          state.execute({
            id: "artwork.nudge",
            layerId: state.selectedLayer,
            dx:
              event.key === "ArrowRight"
                ? amount
                : event.key === "ArrowLeft"
                  ? -amount
                  : 0,
            dy:
              event.key === "ArrowDown"
                ? amount
                : event.key === "ArrowUp"
                  ? -amount
                  : 0,
          });
        }
      }
      if (id) {
        event.preventDefault();
        if (input && id !== 'help.commands') target.blur();
        commandRef.current(id);
      }
    };
    const external = () => commandRef.current("project.open");
    window.addEventListener("keydown", keyboard);
    window.addEventListener("stulooma:open-project", external);
    window.dispatchEvent(new CustomEvent("stulooma:ready"));
    return () => {
      window.removeEventListener("keydown", keyboard);
      window.removeEventListener("stulooma:open-project", external);
    };
  }, []);
  const patchLayer = (patch: Partial<ArtworkLayer>) => {
    if (selected && !selected.locked)
      execute({ id: "artwork.update", layerId: selected.id, patch });
  };
  const regionLayers = project.layers.filter(
    (l) => l.regionId === project.activeRegion,
  );
  return (
    <div
      className="studio"
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          dragDepth.current++;
          setDropActive(true);
        }
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDragLeave={(event) => {
        if (
          event.dataTransfer.types.includes("Files") &&
          --dragDepth.current <= 0
        ) {
          dragDepth.current = 0;
          setDropActive(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDropActive(false);
        if (busyRef.current) return;
        const files = [...event.dataTransfer.files];
        if (files.length !== 1) {
          setError(
            "파일을 한 개씩 놓아 주세요. PNG 이미지, GLB 모델, STULOOMA 프로젝트를 지원합니다.",
          );
          return;
        }
        const file = files[0];
        if (/\.png$/i.test(file.name)) void addPNG(file);
        else if (/\.glb$/i.test(file.name)) void importModel(file);
        else if (/\.stulooma$/i.test(file.name))
          void task("프로젝트 확인 중", async () => {
            if (file.size > 64 * 1024 * 1024)
              throw new Error("프로젝트는 64 MB 이하로 선택하세요.");
            await openBytes(new Uint8Array(await file.arrayBuffer()));
          });
        else
          setError(
            "PNG 이미지, GLB 모델 또는 .stulooma 프로젝트를 놓아 주세요.",
          );
      }}
    >
      <header className="titlebar">
        <div className="wordmark">
          <svg width="23" height="27" viewBox="0 0 23 27" aria-hidden="true">
            <path d="M3 3h17v7H9v7h11v7H3v-7h11v-7H3Z" fill="currentColor" />
          </svg>
          <span>STULOOMA</span>
          <small>STUDIO</small>
        </div>
        <MenuBar commands={commands} onCommand={command} />
        <span className="title-divider" />
        <input
          aria-label="프로젝트 이름"
          className="project-name"
          value={project.name}
          onFocus={s.beginGroup}
          onBlur={s.endGroup}
          onChange={(e) =>
            execute({ id: "project.rename", name: e.target.value })
          }
        />
        <span
          className={`save-dot ${s.dirty ? "dirty" : ""}`}
          title={s.dirty ? "저장하지 않은 변경" : "저장 상태"}
        />
        <div className="title-end">
          <button
            className="command-search-trigger"
            aria-label="명령 검색 (Ctrl+K)"
            onClick={() => command("help.commands")}
          >
            <Search size={14} />
            <span>명령 검색</span>
            <kbd>Ctrl K</kbd>
          </button>
          <span className="local-badge">
            <span />
            로컬 작업 공간
          </span>
          <button onClick={() => setHelpOpen(true)}>
            사용 가이드 <span>↗</span>
          </button>
          <span className="version">v0.2</span>
        </div>
      </header>
      <nav className="toolbar" aria-label="주요 명령">
        <div className="tool-group">
          <Tool
            title="새 프로젝트 (Ctrl+N)"
            onClick={() => command("project.new")}
          >
            <FilePlus2 size={16} />
            <span>새 프로젝트</span>
          </Tool>
          <Tool
            title="프로젝트 열기 (Ctrl+O)"
            onClick={() => command("project.open")}
          >
            <FolderOpen size={16} />
          </Tool>
          <Tool
            title="프로젝트 저장 (Ctrl+S)"
            onClick={() => command("project.save")}
          >
            <Save size={16} />
            <span>저장</span>
          </Tool>
        </div>
        <div className="tool-group">
          <Tool
            title="실행 취소 (Ctrl+Z)"
            onClick={() => command("edit.undo")}
            disabled={!s.past.length}
          >
            <Undo2 size={17} />
          </Tool>
          <Tool
            title="다시 실행 (Ctrl+Shift+Z)"
            onClick={() => command("edit.redo")}
            disabled={!s.future.length}
          >
            <Redo2 size={17} />
          </Tool>
        </div>
        <div className="tool-group">
          <Tool
            title="PNG 이미지 추가"
            onClick={() => command("artwork.import")}
          >
            <ImagePlus size={17} />
            <span>이미지 추가</span>
          </Tool>
          <Tool title="텍스트 추가" onClick={() => command("artwork.addText")}>
            <Type size={17} />
            <span>텍스트</span>
          </Tool>
        </div>
        <div className="toolbar-end">
          <button
            className="panel-toggle"
            aria-label="라이브러리 패널 전환"
            title="라이브러리 표시"
            aria-pressed={workspace.libraryVisible}
            onClick={() => command("workspace.library")}
          >
            <PanelLeft size={17} />
          </button>
          <button
            className="panel-toggle"
            aria-label="속성 패널 전환"
            title="속성 패널 표시"
            aria-pressed={workspace.inspectorVisible}
            onClick={() => command("workspace.inspector")}
          >
            <PanelRight size={17} />
          </button>
          <div className="mode-toggle" aria-label="작업 모드">
            {(["simple", "expert"] as const).map((mode) => (
              <button
                key={mode}
                className={project.settings.mode === mode ? "active" : ""}
                aria-pressed={project.settings.mode === mode}
                onClick={() =>
                  execute({ id: "settings.update", patch: { mode } })
                }
              >
                {mode === "simple" ? "간편" : "전문가"}
              </button>
            ))}
          </div>
          <Tool title="내보내기" onClick={() => command("export.png")} accent>
            <Download size={16} />
            <span>내보내기</span>
            <ChevronDown size={13} />
          </Tool>
        </div>
      </nav>
      <main
        className="workspace"
        style={
          {
            "--library-width": workspace.libraryVisible
              ? `${workspace.libraryWidth}px`
              : "0px",
            "--inspector-width": workspace.inspectorVisible
              ? `${workspace.inspectorWidth}px`
              : "0px",
            "--library-grip": workspace.libraryVisible ? "6px" : "0px",
            "--inspector-grip": workspace.inspectorVisible ? "6px" : "0px",
          } as React.CSSProperties
        }
      >
        <aside
          className="library panel"
          aria-label="라이브러리"
          hidden={!workspace.libraryVisible}
        >
          <div className="panel-heading">
            <span>라이브러리</span>
            <span className="muted">LIBRARY</span>
          </div>
          <div className="library-tabs">
            <button
              className={libraryTab === "builtin" ? "active" : ""}
              onClick={() => setLibraryTab("builtin")}
            >
              <Shirt size={15} />
              기본 의류
            </button>
            <button
              className={libraryTab === "custom" ? "active" : ""}
              onClick={() => setLibraryTab("custom")}
            >
              <Box size={15} />내 모델
            </button>
          </div>
          <div className="library-scroll">
            {libraryTab === "builtin" ? (
              <>
                <div className="section-eyebrow">
                  ESSENTIAL COLLECTION <span>02</span>
                </div>
                {(["tshirt", "basketball"] as const).map((kind) => (
                  <button
                    key={kind}
                    className={`garment-card ${project.garment.kind === kind ? "selected" : ""}`}
                    aria-label={
                      kind === "tshirt" ? "기본 반팔 선택" : "농구 유니폼 선택"
                    }
                    aria-pressed={project.garment.kind === kind}
                    onClick={() => selectGarment(kind)}
                  >
                    <div className="garment-thumbnail">
                      <GarmentIcon kind={kind} />
                      <span className="asset-chip">3D · UV</span>
                      {project.garment.kind === kind && (
                        <span className="selected-check">
                          <Check size={12} />
                        </span>
                      )}
                    </div>
                    <div className="garment-caption">
                      <strong>
                        {kind === "tshirt" ? "에센셜 반팔" : "농구 유니폼"}
                      </strong>
                      <span>
                        {kind === "tshirt"
                          ? "레귤러 핏 · 7개 부위"
                          : "슬리브리스 · 5개 부위"}
                      </span>
                    </div>
                  </button>
                ))}
                <div className="library-note">
                  <span className="tiny-rule" />
                  직접 제작한 3D 의류
                  <br />
                  앞·뒷판과 부위를 개별 편집하세요.
                </div>
              </>
            ) : (
              <>
                <div className="section-eyebrow">
                  YOUR COLLECTION{" "}
                  <span>{String(userModels.length).padStart(2, "0")}</span>
                </div>
                {userModels.map((model) => (
                  <button
                    key={model.id}
                    className="user-model"
                    onClick={() => activateUserModel(model)}
                  >
                    <Box size={26} />
                    <span>
                      <strong>{model.name}</strong>
                      <small>
                        {Object.keys(model.regions).length}개 편집 부위 · UV
                        검증
                      </small>
                    </span>
                  </button>
                ))}
                {!userModels.length && (
                  <p className="empty-copy">
                    직접 만든 GLB 모델을 가져와
                    <br />
                    나만의 라이브러리를 만드세요.
                  </p>
                )}
              </>
            )}
          </div>
          <button
            className="import-model"
            onClick={() => command("model.import")}
          >
            <Upload size={16} />
            <span>GLB 모델 가져오기</span>
            <Plus size={14} />
          </button>
          <div className="library-footer">
            <span>독립 제작 에셋</span>
            <span>로컬 저장</span>
          </div>
        </aside>
        <PanelResize
          label="라이브러리 너비"
          value={workspace.libraryWidth}
          min={176}
          max={320}
          reset={216}
          hidden={!workspace.libraryVisible}
          onChange={(libraryWidth) => workspace.update({ libraryWidth })}
        />
        <section className="center-workspace">
          <div className="workspace-top">
            <div>
              <span className="eyebrow">
                작업 문서 <span className="document-slash">/</span>{" "}
                {label(project.activeRegion)}
              </span>
              <h1>{project.garment.name}</h1>
            </div>
            <div className="view-switch" aria-label="보기 모드">
              {(["3d", "split", "2d"] as const).map((mode) => (
                <button
                  key={mode}
                  className={view === mode ? "active" : ""}
                  onClick={() => command(`workspace.${mode}`)}
                  aria-pressed={view === mode}
                >
                  {mode === "split"
                    ? "분할 보기"
                    : mode === "3d"
                      ? "3D 목업"
                      : "2D 디자인"}
                </button>
              ))}
            </div>
          </div>
          <div
            className={`artboards ${view}`}
            style={{ "--split-ratio": `${splitRatio}%` } as React.CSSProperties}
          >
            <section
              className="stage-panel"
              aria-label="3D 목업 작업 영역"
              style={view === "2d" ? { display: "none" } : undefined}
            >
              <div className="artboard-label">
                <span className="live-dot" />
                3D 목업<span className="subtle">실시간 미리보기</span>
              </div>
              <Viewer
                ref={viewer}
                project={project}
                onSelectRegion={s.selectRegion}
                onCameraChange={s.setCamera}
                onError={setError}
              />

              <div className="camera-bar">
                {[
                  ["front", "정면"],
                  ["back", "후면"],
                  ["left", "좌측"],
                  ["right", "우측"],
                ].map(([id, text]) => (
                  <button
                    key={id}
                    className={activeCamera === id ? "active" : ""}
                    onClick={() => command(`view.${id}`)}
                  >
                    {text}
                  </button>
                ))}
                <span className="separator" />
                <button
                  aria-label="카메라 초기화"
                  title="전체 보기 (F)"
                  onClick={() => command("view.perspective")}
                >
                  <RotateCcw size={14} />
                </button>
              </div>
              <div className="zoom-controls">
                <button
                  aria-label="확대"
                  onClick={() => command("view.zoomIn")}
                >
                  <Plus size={16} />
                </button>
                <button
                  aria-label="축소"
                  onClick={() => command("view.zoomOut")}
                >
                  <Minus size={16} />
                </button>
                <button
                  aria-label="전체 보기"
                  onClick={() => command("view.perspective")}
                >
                  <Maximize2 size={15} />
                </button>
              </div>
              <div className="orbit-hint">
                <MousePointer2 size={12} />
                드래그 회전<span>·</span>휠 확대
              </div>
            </section>
            {view === "split" && (
              <div
                role="separator"
                aria-label="작업 영역 크기"
                aria-orientation="vertical"
                tabIndex={0}
                className="splitter"
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft")
                    setSplitRatio((v) => Math.max(35, v - 3));
                  if (e.key === "ArrowRight")
                    setSplitRatio((v) => Math.min(75, v + 3));
                }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                    const r =
                      e.currentTarget.parentElement!.getBoundingClientRect();
                    setSplitRatio(
                      Math.min(
                        75,
                        Math.max(35, ((e.clientX - r.left) / r.width) * 100),
                      ),
                    );
                  }
                }}
              >
                <span />
              </div>
            )}
            <section
              className="editor-panel"
              onContextMenu={(event) => {
                if ((event.target as HTMLElement).closest('input,textarea,select')) return;
                event.preventDefault();
                setContextMenu({ x: event.clientX, y: event.clientY });
              }}
              style={view === "3d" ? { display: "none" } : undefined}
            >
              <div className="artboard-label">
                <Layers size={13} />
                2D 디자인
                <span className="subtle">{label(project.activeRegion)}</span>
              </div>
              <div className="region-select">
                <label htmlFor="region-canvas">편집 부위</label>
                <select
                  id="region-canvas"
                  aria-label="편집 부위"
                  value={project.activeRegion}
                  onChange={(e) => s.selectRegion(e.target.value)}
                >
                  {Object.keys(project.regions).map((id) => (
                    <option key={id} value={id}>
                      {label(id)}
                    </option>
                  ))}
                </select>
              </div>
              <DesignCanvas />
              <div className="editor-bottom">
                <span className="uv-indicator">
                  <Check size={12} />
                  UV 연결됨
                </span>
                <span>
                  {project.settings.textureSize} ×{" "}
                  {project.settings.textureSize}
                </span>
              </div>
              <button
                className="canvas-add"
                onClick={() => command("artwork.import")}
              >
                <ImagePlus size={16} />
                PNG 이미지 추가
              </button>
            </section>
          </div>
          <div className="work-context">
            <span>
              <span className="live-dot" />
              모델과 디자인이 실시간으로 연결됩니다.
            </span>
            <span>
              {Object.keys(project.regions).length}개 편집 부위 ·{" "}
              {project.layers.length}개 레이어
            </span>
          </div>
        </section>
        <PanelResize
          label="속성 패널 너비"
          value={workspace.inspectorWidth}
          min={264}
          max={400}
          reset={296}
          direction={-1}
          hidden={!workspace.inspectorVisible}
          onChange={(inspectorWidth) => workspace.update({ inspectorWidth })}
        />
        <aside
          className="properties panel"
          aria-label="속성 및 레이어"
          hidden={!workspace.inspectorVisible}
        >
          <div className="panel-heading">
            <span>속성</span>
            <span className="muted">PROPERTIES</span>
          </div>
          <div
            className="inspector-tabs"
            role="tablist"
            aria-label="속성 패널 탭"
          >
            <button
              role="tab"
              aria-selected={inspectorTab === "properties"}
              onClick={() => setInspectorTab("properties")}
            >
              속성 및 레이어
            </button>
            <button
              role="tab"
              aria-selected={inspectorTab === "history"}
              onClick={() => setInspectorTab("history")}
            >
              <History size={13} />
              편집 기록
            </button>
          </div>
          <div
            className="properties-scroll"
            hidden={inspectorTab !== "properties"}
          >
            <section className="property-section">
              <div className="selection-heading">
                <span className="selection-icon">
                  {selected ? <MousePointer2 size={18} /> : <Shirt size={18} />}
                </span>
                <div>
                  <small>
                    {selected ? "선택한 디자인" : "선택한 의류 부위"}
                  </small>
                  <strong>
                    {selected?.name ?? label(project.activeRegion)}
                  </strong>
                </div>
                {selected && (
                  <button
                    aria-label="선택 해제"
                    onClick={() => s.selectLayer(null)}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
              <div className="region-chips">
                {Object.keys(project.regions).map((id) => (
                  <button
                    key={id}
                    className={id === project.activeRegion ? "active" : ""}
                    onClick={() => s.selectRegion(id)}
                  >
                    {label(id)}
                  </button>
                ))}
              </div>
            </section>
            {selected && (
              <section className="property-section">
                <h2>
                  디자인 조절
                  <span>{selected.type === "text" ? "TEXT" : "IMAGE"}</span>
                </h2>
                {selected.type === "text" && (
                  <>
                    <label className="field-label">
                      텍스트
                      <TextField
                        disabled={selected.locked}
                        key={selected.id}
                        value={selected.text ?? ''}
                        onCommit={(text) => patchLayer({ text })}
                      />
                    </label>
                    <label className="inline-field">
                      글자 색상
                      <input
                        type="color"
                        disabled={selected.locked}
                        aria-label="글자 색상"
                        value={selected.color ?? "#ffffff"}
                        onChange={(e) => patchLayer({ color: e.target.value })}
                      />
                    </label>
                  </>
                )}
                <div
                  className="align-tools"
                  role="group"
                  aria-label="부위 기준 정렬"
                >
                  {(
                    [
                      ["left", "왼쪽 정렬", AlignHorizontalJustifyStart],
                      [
                        "center",
                        "가로 가운데 정렬",
                        AlignHorizontalJustifyCenter,
                      ],
                      ["right", "오른쪽 정렬", AlignHorizontalJustifyEnd],
                      ["top", "위쪽 정렬", AlignVerticalJustifyStart],
                      [
                        "middle",
                        "세로 가운데 정렬",
                        AlignVerticalJustifyCenter,
                      ],
                      ["bottom", "아래쪽 정렬", AlignVerticalJustifyEnd],
                    ] as const
                  ).map(([alignment, name, Icon]) => (
                    <button
                      key={alignment}
                      aria-label={name}
                      title={name}
                      disabled={selected.locked}
                      onClick={() => command(`align.${alignment}`)}
                    >
                      <Icon size={16} />
                    </button>
                  ))}
                </div>
                {selected.locked && (
                  <p className="locked-notice">
                    <Lock size={12} />
                    잠긴 레이어 · 잠금을 해제하면 편집할 수 있습니다.
                  </p>
                )}
                <div className="number-grid">
                  {(
                    [
                      ["x", "가로 위치", 100],
                      ["y", "세로 위치", 100],
                      ["width", "너비", 100],
                      ["height", "높이", 100],
                      ["rotation", "회전", 1],
                      ["opacity", "불투명도", 100],
                    ] as const
                  ).map(([key, title, factor]) => (
                    <NumberField
                      key={`${selected.id}:${key}`}
                      label={title}
                      value={selected[key] * factor}
                      unit={key === "rotation" ? "°" : "%"}
                      disabled={selected.locked}
                      step={key === "rotation" ? 1 : 0.5}
                      onCommit={(value) =>
                        patchLayer({ [key]: value / factor })
                      }
                    />
                  ))}
                  {selected.type === "text" && (
                    <NumberField
                      label="글자 크기"
                      value={selected.fontSize ?? 100}
                      unit="px"
                      disabled={selected.locked}
                      step={1}
                      onCommit={(value) =>
                        patchLayer({
                          fontSize: Math.max(8, Math.min(1024, value)),
                        })
                      }
                    />
                  )}
                </div>
                <div className="inline-actions">
                  <button onClick={() => command("edit.duplicate")}>
                    <Copy size={13} />
                    복제
                  </button>
                  <button
                    disabled={selected.locked}
                    onClick={() => command("edit.delete")}
                  >
                    <Trash2 size={13} />
                    삭제
                  </button>
                </div>
              </section>
            )}
            <section className="property-section">
              <h2>
                부위 색상<span>BASE COLOR</span>
              </h2>
              <label className="color-field">
                <input
                  type="color"
                  aria-label="의류 부위 색상"
                  value={region?.color ?? "#ffffff"}
                  onFocus={s.beginGroup}
                  onBlur={s.endGroup}
                  onChange={(e) =>
                    execute({
                      id: "material.update",
                      regionId: project.activeRegion,
                      patch: { color: e.target.value },
                    })
                  }
                />
                <span>{region?.color.toUpperCase()}</span>
                <small>HEX</small>
              </label>
              <div className="palette">
                {palette.map((color) => (
                  <button
                    key={color}
                    aria-label={`색상 ${color}`}
                    className={region?.color === color ? "active" : ""}
                    style={{ background: color }}
                    onClick={() =>
                      execute({
                        id: "material.update",
                        regionId: project.activeRegion,
                        patch: { color },
                      })
                    }
                  />
                ))}
              </div>
            </section>
            <section className="property-section">
              <h2>
                재질<span>MATERIAL</span>
              </h2>
              <div className="fabric-option">
                <span className="fabric-texture" />
                <div>
                  <strong>
                    {(region?.roughness ?? 0.8) > 0.7
                      ? "매트 코튼"
                      : "스포츠 새틴"}
                  </strong>
                  <small>표면 질감 프리셋</small>
                </div>
                <select
                  aria-label="원단 프리셋"
                  value={(region?.roughness ?? 0.8) > 0.7 ? "cotton" : "sport"}
                  onChange={(e) =>
                    execute({
                      id: "material.update",
                      regionId: project.activeRegion,
                      patch: {
                        roughness: e.target.value === "cotton" ? 0.88 : 0.42,
                        metalness: 0,
                      },
                    })
                  }
                >
                  <option value="cotton">면</option>
                  <option value="sport">스포츠</option>
                </select>
              </div>
              <label className="range-field">
                <span>
                  거칠기
                  <strong>{Math.round((region?.roughness ?? 0) * 100)}%</strong>
                </span>
                <input
                  type="range"
                  aria-label="재질 거칠기"
                  min="0"
                  max="1"
                  step=".01"
                  value={region?.roughness ?? 0.8}
                  onPointerDown={s.beginGroup}
                  onPointerUp={s.endGroup}
                  onPointerCancel={s.endGroup}
                  onBlur={s.endGroup}
                  onChange={(e) =>
                    execute({
                      id: "material.update",
                      regionId: project.activeRegion,
                      patch: { roughness: +e.target.value },
                    })
                  }
                />
              </label>
              {project.settings.mode === "expert" && (
                <>
                  <label className="range-field">
                    <span>
                      금속성
                      <strong>
                        {Math.round((region?.metalness ?? 0) * 100)}%
                      </strong>
                    </span>
                    <input
                      type="range"
                      aria-label="재질 금속성"
                      min="0"
                      max="1"
                      step=".01"
                      value={region?.metalness ?? 0}
                      onChange={(e) =>
                        execute({
                          id: "material.update",
                          regionId: project.activeRegion,
                          patch: { metalness: +e.target.value },
                        })
                      }
                    />
                  </label>
                  <label className="inline-field">
                    텍스처 해상도
                    <select
                      value={project.settings.textureSize}
                      onChange={(e) =>
                        execute({
                          id: "settings.update",
                          patch: {
                            textureSize: +e.target.value as 1024 | 2048,
                          },
                        })
                      }
                    >
                      <option value="1024">1024 px</option>
                      <option value="2048">2048 px</option>
                    </select>
                  </label>
                </>
              )}
            </section>
          </div>
          <div className="layers-dock" hidden={inspectorTab !== "properties"} aria-label="레이어 패널">
            <section className="property-section layers-section">
              <h2>
                레이어
                <span>{String(regionLayers.length).padStart(2, "0")}</span>
                <button
                  aria-label="레이어에 이미지 추가"
                  onClick={() => command("artwork.import")}
                >
                  <Plus size={14} />
                </button>
              </h2>
              {!regionLayers.length ? (
                <div className="empty-layers">
                  <Layers size={24} />
                  <p>디자인을 더해 보세요</p>
                  <span>
                    이미지 또는 텍스트를 추가하면
                    <br />
                    이곳에서 관리할 수 있습니다.
                  </span>
                </div>
              ) : (
                [...regionLayers].reverse().map((layer) => (
                  <div
                    key={layer.id}
                    className={`layer-row ${s.selectedLayer === layer.id ? "selected" : ""}`}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      s.selectLayer(layer.id);
                      setContextMenu({ x: event.clientX, y: event.clientY });
                    }}
                  >
                    <button
                      className="layer-name"
                      onClick={() => s.selectLayer(layer.id)}
                      onDoubleClick={() => setRenameLayerId(layer.id)}
                      title="선택 · 두 번 클릭하여 이름 바꾸기"
                    >
                      {layer.type === "text" ? (
                        <Type size={15} />
                      ) : (
                        <ImagePlus size={15} />
                      )}
                      <span>{layer.name}</span>
                    </button>
                    <button
                      title={layer.visible ? "숨기기" : "보이기"}
                      aria-label={`${layer.name} ${layer.visible ? "숨기기" : "보이기"}`}
                      onClick={() =>
                        execute({
                          id: "artwork.update",
                          layerId: layer.id,
                          patch: { visible: !layer.visible },
                        })
                      }
                    >
                      {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                    <button
                      aria-label={`${layer.name} ${layer.locked ? "잠금 해제" : "잠금"}`}
                      onClick={() =>
                        execute({
                          id: "artwork.update",
                          layerId: layer.id,
                          patch: { locked: !layer.locked },
                        })
                      }
                    >
                      {layer.locked ? <Lock size={12} /> : <Unlock size={12} />}
                    </button>
                  </div>
                ))
              )}
              {selected && (
                <div className="inline-actions">
                  <button
                    onClick={() =>
                      execute({
                        id: "layer.reorder",
                        layerId: selected.id,
                        direction: 1,
                      })
                    }
                  >
                    <ArrowUp size={12} />
                    앞으로
                  </button>
                  <button
                    onClick={() =>
                      execute({
                        id: "layer.reorder",
                        layerId: selected.id,
                        direction: -1,
                      })
                    }
                  >
                    <ArrowDown size={12} />
                    뒤로
                  </button>
                </div>
              )}
            </section>
          </div>
          {inspectorTab === "history" && (
            <div
              className="history-panel"
              role="tabpanel"
              aria-label="편집 기록"
            >
              <p className="history-intro">
                이전 문서 상태를 선택하면 그 지점까지 실행을 취소합니다. 최대
                100개 기록을 보관합니다.
              </p>
              <div className="history-actions">
                <button
                  disabled={!s.past.length}
                  onClick={() => command("edit.undo")}
                >
                  <Undo2 size={14} />
                  실행 취소
                </button>
                <button
                  disabled={!s.future.length}
                  onClick={() => command("edit.redo")}
                >
                  <Redo2 size={14} />
                  다시 실행
                </button>
              </div>
              <ol>
                {s.past.map((snapshot, index) => (
                  <li key={`${snapshot.updatedAt}:${index}`}>
                    <button
                      onClick={() => {
                        const count = useStudio.getState().past.length - index;
                        for (let n = 0; n < count; n++)
                          useStudio.getState().undo();
                      }}
                    >
                      <span className="history-node" />
                      <span>
                        <strong>
                          {index === 0 ? "시작 상태" : `이전 상태 ${index}`}
                        </strong>
                        <small>
                          {snapshot.layers.length}개 레이어 · {snapshot.name}
                        </small>
                      </span>
                      <span className="history-time">
                        {new Date(snapshot.updatedAt).toLocaleTimeString(
                          "ko-KR",
                          {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          },
                        )}
                      </span>
                    </button>
                  </li>
                ))}
                <li aria-current="step">
                  <span className="history-current">
                    <span className="history-node" />
                    <span>
                      <strong>현재 상태</strong>
                      <small>{s.lastCommand}</small>
                    </span>
                    <Check size={14} />
                  </span>
                </li>
              </ol>
              {s.future.length > 0 && (
                <p className="history-intro">
                  다시 실행할 수 있는 기록 {s.future.length}개
                </p>
              )}
            </div>
          )}
          <div className="property-footer">
            <span className="live-dot" />
            모든 디자인은 내 기기에 저장됩니다.
          </div>
        </aside>
      </main>
      <footer className="statusbar">
        <span>
          <span className={`save-dot ${s.dirty ? "dirty" : ""}`} />
          {s.dirty ? "저장하지 않은 변경 사항" : "프로젝트 준비됨"}
        </span>
        <span>{autoStatus}</span>
        <span className="status-command">{s.lastCommand}</span>
        <span>UV {project.settings.textureSize}px</span>
        <span>STULOOMA · 0.2.0</span>
      </footer>
      <input
        hidden
        ref={pngInput}
        type="file"
        accept=".png,image/png"
        aria-label="PNG 파일"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void addPNG(f);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={projectInput}
        type="file"
        accept=".stulooma"
        aria-label="프로젝트 파일"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f)
            void task("프로젝트 확인 중", async () => {
              if (f.size > 64 * 1024 * 1024)
                throw new Error("프로젝트는 64 MB 이하로 선택하세요.");
              await openBytes(new Uint8Array(await f.arrayBuffer()));
            });
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={modelInput}
        type="file"
        accept=".glb,model/gltf-binary"
        aria-label="GLB 파일"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importModel(f);
          e.target.value = "";
        }}
      />
      {toast && (
        <div role="status" className="toast">
          <Check size={16} />
          {toast}
        </div>
      )}
      {busy && (
        <div className="busy" role="status">
          <span className="spinner" />
          {busy}
        </div>
      )}
      {dropActive && (
        <div className="file-drop-overlay">
          <Upload size={36} />
          <strong>파일을 놓아 가져오기</strong>
          <span>PNG 이미지 · GLB 모델 · STULOOMA 프로젝트</span>
        </div>
      )}
      {paletteOpen && (
        <CommandPalette
          commands={commands.filter(item => item.id !== 'help.commands')}
          onCommand={command}
          close={() => setPaletteOpen(false)}
        />
      )}
      {contextMenu && (
        <CommandContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          commands={commands.filter(
            (item) =>
              item.group === "편집" ||
              item.id.startsWith("align.") ||
              item.id.startsWith("artwork."),
          )}
          onCommand={command}
          close={() => setContextMenu(null)}
        />
      )}
      {renameLayerId && (
        <Modal title="레이어 이름 바꾸기" close={() => setRenameLayerId(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const name = String(
                new FormData(event.currentTarget).get("layerName") ?? "",
              ).trim();
              if (!name) return;
              execute({
                id: "artwork.update",
                layerId: renameLayerId,
                patch: { name: name.slice(0, 120) },
              });
              setRenameLayerId(null);
            }}
          >
            <label className="field-label">
              레이어 이름
              <input
                name="layerName"
                aria-label="레이어 이름"
                defaultValue={
                  project.layers.find((layer) => layer.id === renameLayerId)
                    ?.name
                }
                maxLength={120}
                required
                autoFocus
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setRenameLayerId(null)}>
                취소
              </button>
              <button className="primary" type="submit">
                이름 변경
              </button>
            </div>
          </form>
        </Modal>
      )}
      {error && (
        <Modal title="작업을 완료하지 못했습니다" close={() => setError("")}>
          <p className="error-message" role="alert">
            {error}
          </p>
          <button className="primary full" onClick={() => setError("")}>
            확인
          </button>
        </Modal>
      )}
      {exportOpen && (
        <Modal title="목업 내보내기" close={() => setExportOpen(false)}>
          <p className="modal-intro">
            현재 카메라의 3D 모델과 디자인을 파일로 저장합니다.
          </p>
          <div className="export-options">
            {(["png", "jpg", "glb"] as const).map((format) => (
              <button
                className={exportFormat === format ? "active" : ""}
                key={format}
                onClick={() => setExportFormat(format)}
              >
                <strong>{format.toUpperCase()}</strong>
                <span>
                  {format === "png"
                    ? "투명 배경 지원"
                    : format === "jpg"
                      ? "배경 포함 이미지"
                      : "편집한 3D 모델"}
                </span>
              </button>
            ))}
          </div>
          {exportFormat !== "glb" && (
            <>
              <label className="inline-field">
                출력 해상도
                <select
                  aria-label="출력 해상도"
                  value={exportSize}
                  onChange={(e) => setExportSize(+e.target.value)}
                >
                  <option value={1024}>1024 × 1024</option>
                  <option value={2048}>2048 × 2048</option>
                  <option value={4096}>4096 × 4096</option>
                </select>
              </label>
              {exportFormat === "png" && (
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={project.settings.transparent}
                    onChange={(e) =>
                      execute({
                        id: "settings.update",
                        patch: { transparent: e.target.checked },
                      })
                    }
                  />
                  배경을 투명하게
                </label>
              )}
            </>
          )}
          <button
            disabled={!!busy}
            className="primary full"
            onClick={() => void doExport()}
          >
            <Download size={16} />
            파일 내보내기
          </button>
        </Modal>
      )}
      {pendingModel && (
        <Modal
          title="사용자 모델 등록 · UV 확인 완료"
          close={() => setPendingModel(null)}
        >
          <p className="modal-intro">
            각 메시를 디자인 부위로 연결하세요. 하나의 메시 안의 표면 분할은
            아직 지원하지 않습니다.
          </p>
          <label className="field-label">
            모델 이름
            <input
              aria-label="사용자 모델 이름"
              value={pendingModel.name}
              maxLength={120}
              onChange={(e) =>
                setPendingModel({ ...pendingModel, name: e.target.value })
              }
            />
          </label>
          <div className="mesh-list">
            {pendingModel.meshes.map((mesh, i) => (
              <label className="mesh-row" key={mesh.id}>
                <span>
                  {mesh.name}
                  <small>{mesh.triangles.toLocaleString()} triangles</small>
                </span>
                <select
                  aria-label={`${mesh.name} 편집 부위`}
                  value={pendingModel.map[mesh.id]}
                  onChange={(e) =>
                    setPendingModel({
                      ...pendingModel,
                      map: { ...pendingModel.map, [mesh.id]: e.target.value },
                    })
                  }
                >
                  {[
                    "FRONT",
                    "BACK",
                    "LEFT_SLEEVE",
                    "RIGHT_SLEEVE",
                    "COLLAR",
                    `CUSTOM_${i + 1}`,
                  ].map((id) => (
                    <option key={id} value={id}>
                      {label(id)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button
            className="primary full"
            disabled={!!busy}
            onClick={() => void registerModel()}
          >
            <Check size={16} />
            라이브러리에 등록하고 편집
          </button>
        </Modal>
      )}
      {recovery && (
        <Modal title="자동 복구 프로젝트" close={() => setRecovery(null)}>
          <p className="modal-intro">
            이 기기에 자동 저장된 프로젝트가 있습니다. 마지막 편집 상태를 복원할
            수 있습니다.
          </p>
          <div className="modal-actions">
            <button onClick={() => setRecovery(null)}>새로 시작</button>
            <button
              className="primary"
              onClick={() =>
                void task("프로젝트 복구 중", async () => {
                  const p = await loadProject(recovery);
                  s.replace(p, true);
                  documentBinding.current = null;
                  setRecovery(null);
                  announce("자동 저장된 프로젝트를 복구했습니다.");
                })
              }
            >
              복구하기
            </button>
          </div>
        </Modal>
      )}
      {helpOpen && (
        <Modal title="STULOOMA 사용 가이드" close={() => setHelpOpen(false)}>
          <ol className="help-steps">
            <li>반팔 또는 농구 유니폼을 선택하세요.</li>
            <li>앞·뒷판을 선택하고 PNG 이미지나 텍스트를 추가하세요.</li>
            <li>2D 캔버스에서 이동·확대·회전하세요. 3D에 바로 반영됩니다.</li>
            <li>3D 화면을 드래그하여 회전하고 휠로 확대하세요.</li>
            <li>
              프로젝트를 저장하면 이미지·부위·재질·카메라를 다시 편집할 수
              있습니다.
            </li>
            <li>내보내기에서 PNG·JPG 이미지 또는 GLB 모델을 출력하세요.</li>
          </ol>
          <p className="modal-intro">
            Ctrl/⌘+K 명령 검색 · Ctrl/⌘+S 저장 · Ctrl/⌘+Shift+S 다른 이름으로
            저장
            <br />
            Ctrl/⌘+Z 실행 취소 · Ctrl/⌘+D 복제 · Ctrl/⌘+C/V 레이어 복사/붙여넣기
            <br />
            방향키 미세 이동 · Shift+방향키 10배 이동 · F2 레이어 이름 바꾸기
            <br />
            정적인 의류 목업 도구입니다. 봉제·착의 물리 시뮬레이션은 제공하지
            않습니다.
          </p>
          <button className="primary full" onClick={() => setHelpOpen(false)}>
            디자인 시작
          </button>
        </Modal>
      )}
    </div>
  );
}
