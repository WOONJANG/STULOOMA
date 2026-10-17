import { Component, forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { buildGarment } from '../../core/garments';
import { importGLB } from '../../core/import/glb';
import { exportGLB } from '../../core/export/glb';
import { composeRegion } from '../../core/textures/composer';
import type { ProjectDocument, Vec3 } from '../../types/project';
import './Viewer.css';

export interface ViewerProps {
  project: ProjectDocument;
  onSelectRegion(id: string): void;
  onCameraChange(camera: ProjectDocument['camera']): void;
  onError(message: string): void;
  onReady?(): void;
}
export interface ViewerHandle {
  setView(view: 'front' | 'back' | 'left' | 'right' | 'perspective'): void;
  zoom(factor: number): void;
  capture(options: { width: number; height: number; transparent: boolean; mime: 'image/png' | 'image/jpeg' }): Promise<Uint8Array>;
  exportGLB(): Promise<Uint8Array>;
  getCamera(): ProjectDocument['camera'];
}

interface Runtime {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControlsImpl;
  group: THREE.Group;
  invalidate(): void;
}

// Project all eight garment bounds corners onto the chosen camera basis. This
// fits wide sleeves on a narrow viewport without overfitting the empty depth.
function fitDistance(group: THREE.Group, camera: THREE.PerspectiveCamera, target: THREE.Vector3, direction: THREE.Vector3, aspect = camera.aspect): number {
  group.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(group);
  const outward = direction.clone().normalize();
  const right = new THREE.Vector3().crossVectors(camera.up, outward).normalize();
  const up = new THREE.Vector3().crossVectors(outward, right).normalize();
  const tanVertical = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const tanHorizontal = tanVertical * Math.max(0.05, aspect);
  const occupancy = 0.72;
  let distance = 1.2;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const corner = new THREE.Vector3(x, y, z).sub(target);
    const depth = corner.dot(outward);
    distance = Math.max(distance, Math.abs(corner.dot(right)) / (tanHorizontal * occupancy) + depth, Math.abs(corner.dot(up)) / (tanVertical * occupancy) + depth);
  }
  return distance;
}

function pristineCamera(camera: ProjectDocument['camera']): boolean {
  return camera.position.every((value, index) => Math.abs(value - [0, 0, 3.8][index]) < 1e-8)
    && camera.target.every(value => Math.abs(value) < 1e-8);
}

function releaseGroup(group: THREE.Group) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}

function cameraState(runtime: Runtime): ProjectDocument['camera'] {
  return {
    position: runtime.camera.position.toArray() as Vec3,
    target: runtime.controls.target.toArray() as Vec3,
  };
}

function assetBytes(data: string): Uint8Array {
  const comma = data.indexOf(',');
  const binary = atob(data.slice(comma + 1));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

class CanvasBoundary extends Component<{ children: ReactNode; onError(message: string): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, _info: ErrorInfo) { this.props.onError(error.message); }
  render() {
    return this.state.failed
      ? <div className="viewer-error">3D 화면을 초기화할 수 없습니다. 그래픽 가속 설정을 확인해 주세요.</div>
      : this.props.children;
  }
}

function GarmentSurface({ group, project, onSelectRegion, onError, onReady, onUpdating }: {
  group: THREE.Group;
  project: ProjectDocument;
  onSelectRegion(id: string): void;
  onError(message: string): void;
  onReady(): void;
  onUpdating(): void;
}) {
  const invalidate = useThree(state => state.invalidate);
  const materials = useRef(new Map<string, THREE.MeshStandardMaterial>());
  const textures = useRef(new Map<string, THREE.CanvasTexture>());
  const snapshots = useRef(new Map<string, { key: string; images: string[] }>());
  const readyRef = useRef(onReady);
  const errorRef = useRef(onError);
  readyRef.current = onReady;
  errorRef.current = onError;

  useEffect(() => {
    const owned = materials.current;
    const superseded = new Set<THREE.Material>();
    const supersededTextures = new Set<THREE.Texture>();
    const firstRegion = Object.keys(project.regions)[0] ?? 'FRONT';
    const assignments = new Map<string, string>();
    Object.entries(project.garment.regionMeshes ?? {}).forEach(([region, ids]) => ids.forEach(id => assignments.set(id, region)));
    group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const original of Array.isArray(object.material) ? object.material : [object.material]) {
        if (![...owned.values()].includes(original as THREE.MeshStandardMaterial)) superseded.add(original);
      }
      const meshId = String(object.userData.meshId ?? object.name);
      const regionId = assignments.get(meshId) ?? (project.regions[object.userData.regionId] ? object.userData.regionId : firstRegion);
      object.userData.regionId = regionId;
      let material = owned.get(regionId);
      if (!material) {
        material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.72, metalness: 0, side: THREE.DoubleSide });
        material.name = `STULOOMA_${regionId}`;
        owned.set(regionId, material);
      }
      object.material = material;
      object.castShadow = true;
      object.receiveShadow = false;
    });
    superseded.forEach(material => {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) supersededTextures.add(value);
      material.dispose();
    });
    supersededTextures.forEach(texture => texture.dispose());
    invalidate();
  }, [group, project.garment.regionMeshes, invalidate]); // Materials stay alive when artwork changes.

  useEffect(() => {
    let current = true;
    const regionIds = [...materials.current.keys()];
    const changed = regionIds.flatMap(id => {
      const layers = project.layers.filter(layer => layer.regionId === id && layer.visible);
      const snapshot = {
        key: JSON.stringify([project.regions[id]?.color, project.settings.textureSize, layers]),
        images: layers.filter(layer => layer.type === 'image').map(layer => project.assets[layer.assetId ?? '']?.data ?? ''),
      };
      const previous = snapshots.current.get(id);
      return previous?.key === snapshot.key && previous.images.length === snapshot.images.length && previous.images.every((data, index) => data === snapshot.images[index])
        ? [] : [{ id, snapshot }];
    });
    if (changed.length > 0) onUpdating();
    void Promise.all(changed.map(async ({ id, snapshot }) => ({ id, snapshot, canvas: await composeRegion(project, id, project.settings.textureSize) })))
      .then(results => {
        if (!current) return;
        for (const { id, snapshot, canvas } of results) {
          const material = materials.current.get(id);
          if (!material) continue;
          const map = new THREE.CanvasTexture(canvas);
          map.colorSpace = THREE.SRGBColorSpace;
          map.anisotropy = 4;
          const previous = textures.current.get(id);
          textures.current.set(id, map);
          snapshots.current.set(id, snapshot);
          material.map = map;
          material.needsUpdate = true;
          previous?.dispose();
        }
        invalidate();
        readyRef.current();
      })
      .catch(error => { if (current) errorRef.current(error instanceof Error ? error.message : '텍스처를 생성할 수 없습니다.'); });
    return () => { current = false; };
  }, [group, project.layers, project.assets, project.regions, project.settings.textureSize, project.garment.regionMeshes, invalidate, onUpdating]);

  useEffect(() => {
    materials.current.forEach((material, id) => {
      material.roughness = project.regions[id]?.roughness ?? 0.72;
      material.metalness = project.regions[id]?.metalness ?? 0;
      material.emissive.set(id === project.activeRegion ? '#3f655b' : '#000000');
      material.emissiveIntensity = id === project.activeRegion ? 0.12 : 0;
    });
    invalidate();
  }, [project.activeRegion, project.regions, group, invalidate]);

  useEffect(() => {
    const ownedMaterials = materials.current;
    const ownedTextures = textures.current;
    const ownedSnapshots = snapshots.current;
    return () => {
      ownedTextures.forEach(texture => texture.dispose());
      ownedTextures.clear();
      ownedMaterials.forEach(material => material.dispose());
      ownedMaterials.clear();
      ownedSnapshots.clear();
    };
  }, [group]);

  return <primitive object={group} onClick={(event: { delta: number; stopPropagation(): void; object: THREE.Object3D }) => {
    if (event.delta > 5) return;
    event.stopPropagation();
    const id = event.object.userData.regionId;
    if (typeof id === 'string') onSelectRegion(id);
  }} />;
}

function Studio({ project, group, onSelectRegion, onCameraChange, onError, onReady, onUpdating, setRuntime }: ViewerProps & {
  group: THREE.Group;
  onReady(): void;
  onUpdating(): void;
  setRuntime(runtime: Runtime | null): void;
}) {
  const { scene, camera, gl, invalidate, size } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);
  const initialCamera = useRef(project.camera);
  const sourceCamera = useRef(JSON.stringify([project.id, project.camera]));
  const lastAspect = useRef<number | null>(null);
  const cameraChange = useRef(onCameraChange);
  cameraChange.current = onCameraChange;
  useEffect(() => {
    const orbit = controls.current;
    if (!orbit || !(camera instanceof THREE.PerspectiveCamera)) return;
    camera.position.fromArray(initialCamera.current.position);
    orbit.target.fromArray(initialCamera.current.target);
    if (pristineCamera(initialCamera.current)) {
      orbit.target.copy(new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3()));
      const direction = new THREE.Vector3(0, 0, 1);
      camera.position.copy(orbit.target).addScaledVector(direction, fitDistance(group, camera, orbit.target, direction));
    }
    lastAspect.current = camera.aspect;
    orbit.update();
    setRuntime({ scene, camera, renderer: gl, controls: orbit, group, invalidate });
    invalidate();
    return () => setRuntime(null);
  }, [camera, gl, scene, group, setRuntime, invalidate]);
  useEffect(() => {
    const orbit = controls.current;
    if (!orbit || !(camera instanceof THREE.PerspectiveCamera)) return;
    const key = JSON.stringify([project.id, project.camera]);
    if (sourceCamera.current === key) return;
    sourceCamera.current = key;
    const position = new THREE.Vector3().fromArray(project.camera.position);
    const target = new THREE.Vector3().fromArray(project.camera.target);
    if (pristineCamera(project.camera)) {
      target.copy(new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3()));
      position.copy(target).add(new THREE.Vector3(0, 0, fitDistance(group, camera, target, new THREE.Vector3(0, 0, 1))));
    }
    if (camera.position.distanceToSquared(position) > 1e-10 || orbit.target.distanceToSquared(target) > 1e-10) {
      camera.position.copy(position);
      orbit.target.copy(target);
      orbit.update();
      invalidate();
    }
  }, [project.id, project.camera, camera, group, invalidate]);
  useEffect(() => {
    const orbit = controls.current;
    if (!orbit || !(camera instanceof THREE.PerspectiveCamera) || size.width < 1 || size.height < 1) return;
    const aspect = size.width / size.height;
    const previousAspect = lastAspect.current;
    lastAspect.current = aspect;
    if (previousAspect === null || Math.abs(previousAspect - aspect) < 1e-5) return;
    const offset = camera.position.clone().sub(orbit.target);
    const previousFit = fitDistance(group, camera, orbit.target, offset, previousAspect);
    const nextFit = fitDistance(group, camera, orbit.target, offset, aspect);
    offset.multiplyScalar(nextFit / previousFit);
    camera.position.copy(orbit.target).add(offset);
    orbit.update();
    invalidate();
    cameraChange.current({ position: camera.position.toArray() as Vec3, target: orbit.target.toArray() as Vec3 });
  }, [size.width, size.height, camera, group, invalidate]);
  return <>
    <color attach="background" args={[project.settings.background || '#1a1e24']} />
    <ambientLight intensity={0.65} />
    <hemisphereLight args={['#f1f2ff', '#4e4240', 1.2]} />
    <directionalLight position={[3, 4, 5]} intensity={3.1} color="#fff3e5" />
    <directionalLight position={[-4, 2, 3]} intensity={1.2} color="#d9e6ff" />
    <directionalLight position={[0, 3, -4]} intensity={2.7} color="#f3eddf" />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.03, 0]} userData={{ excludeFromTransparentCapture: true }}>
      <circleGeometry args={[1.25, 80]} />
      <meshStandardMaterial color="#181d24" roughness={1} transparent opacity={0.45} />
    </mesh>
    <GarmentSurface group={group} project={project} onSelectRegion={onSelectRegion} onError={onError} onReady={onReady} onUpdating={onUpdating} />
    <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} minDistance={1.2} maxDistance={50}
      maxPolarAngle={Math.PI * 0.94} target={initialCamera.current.target}
      onEnd={() => {
        const orbit = controls.current;
        if (orbit) onCameraChange({ position: camera.position.toArray() as Vec3, target: orbit.target.toArray() as Vec3 });
      }} />
  </>;
}

export const Viewer = forwardRef<ViewerHandle, ViewerProps>(function Viewer(props, ref) {
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [cameraOptions] = useState(() => ({ position: props.project.camera.position, fov: 40, near: 0.01, far: 100 }));
  const runtime = useRef<Runtime | null>(null);
  const projectRef = useRef(props.project);
  const errorRef = useRef(props.onError);
  const readyRef = useRef(props.onReady);
  const cameraChangeRef = useRef(props.onCameraChange);
  projectRef.current = props.project;
  errorRef.current = props.onError;
  readyRef.current = props.onReady;
  cameraChangeRef.current = props.onCameraChange;
  const setRuntime = useCallback((value: Runtime | null) => { runtime.current = value; }, []);
  const reportError = useCallback((message: string) => { setStatus('error'); errorRef.current(message); }, []);
  const reportReady = useCallback(() => { setStatus('ready'); readyRef.current?.(); }, []);
  const reportUpdating = useCallback(() => { setStatus('loading'); }, []);
  const asset = props.project.garment.assetId ? props.project.assets[props.project.garment.assetId] : undefined;

  useEffect(() => {
    let current = true;
    let created: THREE.Group | undefined;
    setStatus('loading');
    setGroup(null);
    void (async () => {
      const kind = projectRef.current.garment.kind;
      if (kind === 'custom') {
        if (!asset) throw new Error('불러온 GLB 에셋이 프로젝트에 없습니다.');
        created = (await importGLB(assetBytes(asset.data))).group;
      } else created = buildGarment(kind);
      if (current) setGroup(created);
      else releaseGroup(created);
    })().catch(error => { if (current) reportError(error instanceof Error ? error.message : '3D 모델을 불러올 수 없습니다.'); });
    return () => {
      current = false;
      if (created) releaseGroup(created);
    };
  }, [props.project.garment.kind, props.project.garment.assetId, asset?.data, reportError]);

  useImperativeHandle(ref, () => ({
    getCamera() { return runtime.current ? cameraState(runtime.current) : projectRef.current.camera; },
    setView(view) {
      const current = runtime.current;
      if (!current) return;
      const directions = { front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], perspective: [0.65, 0.25, 1] } as const;
      current.controls.target.copy(new THREE.Box3().setFromObject(current.group).getCenter(new THREE.Vector3()));
      const direction = new THREE.Vector3(...directions[view]).normalize();
      const distance = fitDistance(current.group, current.camera, current.controls.target, direction);
      current.camera.position.copy(direction.multiplyScalar(distance).add(current.controls.target));
      current.controls.update();
      current.invalidate();
      cameraChangeRef.current(cameraState(current));
    },
    zoom(factor) {
      const current = runtime.current;
      if (!current || !Number.isFinite(factor) || factor <= 0) return;
      const offset = current.camera.position.clone().sub(current.controls.target);
      offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, current.controls.minDistance, current.controls.maxDistance));
      current.camera.position.copy(current.controls.target).add(offset);
      current.controls.update();
      current.invalidate();
      cameraChangeRef.current(cameraState(current));
    },
    async capture({ width, height, transparent, mime }) {
      const current = runtime.current;
      if (!current || !group || status !== 'ready') throw new Error('3D 모델이 준비된 후 다시 내보내 주세요.');
      if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= 4096)) throw new Error('이미지 크기는 1~4096 픽셀이어야 합니다.');
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      const captureScene = current.scene.clone(true);
      const captureCamera = current.camera.clone();
      const ownedMaterials: THREE.Material[] = [];
      try {
        renderer.outputColorSpace = current.renderer.outputColorSpace;
        renderer.toneMapping = current.renderer.toneMapping;
        renderer.toneMappingExposure = current.renderer.toneMappingExposure;
        renderer.setPixelRatio(1);
        renderer.setSize(width, height, false);
        captureCamera.aspect = width / height;
        const offset = captureCamera.position.clone().sub(current.controls.target);
        const originalFit = fitDistance(group, current.camera, current.controls.target, offset, current.camera.aspect);
        const captureFit = fitDistance(group, captureCamera, current.controls.target, offset, width / height);
        captureCamera.position.copy(current.controls.target).add(offset.multiplyScalar(captureFit / originalFit));
        captureCamera.updateProjectionMatrix();
        const alpha = transparent && mime === 'image/png';
        if (alpha) { captureScene.background = null; renderer.setClearColor(0x000000, 0); }
        captureScene.traverse(object => {
          if (alpha && object.userData.excludeFromTransparentCapture) object.visible = false;
          if (object instanceof THREE.Mesh) {
            const cloneMaterial = (material: THREE.Material) => {
              const result = material.clone();
              if (result instanceof THREE.MeshStandardMaterial) result.emissiveIntensity = 0;
              ownedMaterials.push(result);
              return result;
            };
            object.material = Array.isArray(object.material) ? object.material.map(cloneMaterial) : cloneMaterial(object.material);
          }
        });
        renderer.render(captureScene, captureCamera);
        const blob = await new Promise<Blob>((resolve, reject) => renderer.domElement.toBlob(value => value ? resolve(value) : reject(new Error('3D 이미지를 생성할 수 없습니다.')), mime, 0.95));
        return new Uint8Array(await blob.arrayBuffer());
      } finally {
        ownedMaterials.forEach(material => material.dispose());
        renderer.dispose();
        renderer.forceContextLoss();
      }
    },
    async exportGLB() {
      if (!group || status !== 'ready') throw new Error('3D 모델이 준비된 후 다시 내보내 주세요.');
      const clone = group.clone(true);
      const materials: THREE.Material[] = [];
      clone.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const clean = (material: THREE.Material) => {
          const next = material.clone();
          if (next instanceof THREE.MeshStandardMaterial) next.emissiveIntensity = 0;
          materials.push(next);
          return next;
        };
        object.material = Array.isArray(object.material) ? object.material.map(clean) : clean(object.material);
      });
      try { return await exportGLB(clone); }
      finally { materials.forEach(material => material.dispose()); }
    },
  }), [group, status]);

  return <div className="three-viewport" data-testid="three-canvas">
    <CanvasBoundary onError={reportError}>
      <Canvas frameloop="demand" camera={cameraOptions}
        dpr={[1, 2]} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        fallback={<div className="viewer-error">이 환경에서 WebGL을 사용할 수 없습니다.</div>}>
        {group && <Studio {...props} group={group} onError={reportError} onReady={reportReady} onUpdating={reportUpdating} setRuntime={setRuntime} />}
      </Canvas>
    </CanvasBoundary>
    <span data-testid="viewer-state" data-state={status} className={`viewer-status ${status === 'ready' ? 'is-ready' : ''}`} role="status">
      {status === 'loading' ? '3D 모델 준비 중…' : status === 'ready' ? '3D 준비됨' : '3D 오류'}
    </span>
  </div>;
});
