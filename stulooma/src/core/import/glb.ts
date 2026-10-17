import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SUPPORTED_GLB_REQUIRED_EXTENSIONS as SUPPORTED_REQUIRED_EXTENSIONS } from '../validation/glb-policy';

/** Deliberately conservative limits for editable, static garment models. */
export const GLB_LIMITS = Object.freeze({
  bytes: 64 * 1024 * 1024,
  vertices: 1_000_000,
  triangles: 2_000_000,
  drawCalls: 1_024,
  nodes: 4_096,
  depth: 128,
  texturePixels: 16_777_216,
  totalTexturePixels: 33_554_432,
});

type ObjectValue = Record<string, unknown>;
type AccessorInfo = { count: number; components: number; type: string; componentType: number; offset: number; stride: number; normalized: boolean };
const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMPONENT_COUNTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

function fail(message: string): never { throw new Error(`GLB import: ${message}`); }
function object(value: unknown, label: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as ObjectValue;
}
function objects(value: unknown, label: string): ObjectValue[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`${label} must be a list.`);
  return value.map((entry, index) => object(entry, `${label}[${index}]`));
}
function integer(value: unknown, label: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative integer.`);
  return value;
}
function reference(value: unknown, length: number, label: string): number {
  const result = integer(value, label);
  if (result >= length) fail(`${label} references missing data.`);
  return result;
}
function readComponent(view: DataView, offset: number, type: number): number {
  switch (type) {
    case 5120: return view.getInt8(offset);
    case 5121: return view.getUint8(offset);
    case 5122: return view.getInt16(offset, true);
    case 5123: return view.getUint16(offset, true);
    case 5125: return view.getUint32(offset, true);
    case 5126: return view.getFloat32(offset, true);
    default: return fail('Unsupported accessor component type.');
  }
}

function textureDimensions(bytes: Uint8Array, mime: string): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === 'image/png') {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 33 || !signature.every((value, index) => bytes[index] === value) || view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) fail('An embedded PNG texture has an invalid header.');
    return [view.getUint32(16), view.getUint32(20)];
  }
  if (mime === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail('An embedded JPEG texture has an invalid header.');
    let cursor = 2;
    const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (cursor + 3 < bytes.length) {
      if (bytes[cursor++] !== 0xff) fail('An embedded JPEG texture has invalid markers.');
      while (bytes[cursor] === 0xff) cursor++;
      const marker = bytes[cursor++];
      if (marker === 0xd9 || marker === 0xda || cursor + 2 > bytes.length) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      const length = view.getUint16(cursor);
      if (length < 2 || cursor + length > bytes.length) fail('An embedded JPEG texture is truncated.');
      if (frameMarkers.has(marker)) {
        if (length < 8) fail('An embedded JPEG texture has an invalid frame.');
        return [view.getUint16(cursor + 5), view.getUint16(cursor + 3)];
      }
      cursor += length;
    }
    return fail('The dimensions of an embedded JPEG texture could not be read.');
  }
  if (mime === 'image/webp') {
    if (bytes.length < 30 || view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57454250) fail('An embedded WebP texture has an invalid header.');
    const kind = view.getUint32(12);
    if (kind === 0x56503858) {
      if (bytes[20] & 2) fail('Animated WebP textures are unsupported.');
      return [1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)];
    }
    if (kind === 0x5650384c && bytes[20] === 0x2f) {
      const packed = view.getUint32(21, true);
      return [(packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1];
    }
    if (kind === 0x56503820 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return [view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff];
    return fail('The dimensions of an embedded WebP texture could not be read.');
  }
  return fail('Only embedded PNG, JPEG, or WebP textures are supported.');
}

/** Runs before GLTFLoader so a rejected document cannot start resource requests. */
function preflight(bytes: Uint8Array): { warnings: string[]; json: ObjectValue } {
  if (bytes.byteLength > GLB_LIMITS.bytes) fail('The file exceeds the 64 MB limit.');
  if (bytes.byteLength < 20) fail('The file is truncated. Choose a complete GLB 2.0 file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) fail('The file is not a binary glTF (GLB) file.');
  if (view.getUint32(4, true) !== 2) fail('Only GLB version 2 is supported.');
  if (view.getUint32(8, true) !== bytes.byteLength) fail('The GLB length does not match the file size.');
  let offset = 12;
  let jsonBytes: Uint8Array | undefined;
  let binary: Uint8Array = new Uint8Array();
  let binarySeen = false;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) fail('A GLB chunk header is truncated.');
    const length = view.getUint32(offset, true);
    const kind = view.getUint32(offset + 4, true);
    if (length % 4 || offset + 8 + length > bytes.byteLength) fail('A GLB chunk has an invalid length.');
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (offset === 12 && kind !== 0x4e4f534a) fail('The first GLB chunk must contain JSON.');
    if (kind === 0x4e4f534a) {
      if (jsonBytes || binarySeen) fail('The GLB contains duplicate or misplaced JSON chunks.');
      jsonBytes = chunk;
    } else if (kind === 0x004e4942) {
      if (binarySeen) fail('The GLB contains duplicate binary chunks.');
      binarySeen = true;
      binary = chunk;
    } else fail('The GLB contains an unsupported chunk type.');
    offset += 8 + length;
  }
  if (!jsonBytes) fail('The GLB JSON chunk is missing.');
  let json: ObjectValue;
  try { json = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes)), 'GLB document'); }
  catch { return fail('The GLB JSON is invalid.'); }
  if (object(json.asset, 'asset').version !== '2.0') fail('The glTF asset must declare version 2.0.');

  // URI fields, including extension URI fields, are intentionally rejected. All
  // textures and geometry must be embedded in the binary chunk of this GLB.
  let entries = 0;
  const inspect = (value: unknown, depth: number): void => {
    if (depth > GLB_LIMITS.depth || ++entries > 200_000) fail('The model metadata is too complex.');
    if (typeof value === 'number' && !Number.isFinite(value)) fail('The model metadata contains non-finite numbers.');
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const entry of value) inspect(entry, depth + 1); return; }
    for (const [key, entry] of Object.entries(value)) {
      if (/uri$/i.test(key) && entry !== undefined) fail('External or URI resources are not allowed. Embed buffers and images in the GLB binary chunk.');
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') fail('The model contains unsafe metadata keys.');
      inspect(entry, depth + 1);
    }
  };
  inspect(json, 0);
  if (json.extensionsRequired !== undefined && !Array.isArray(json.extensionsRequired)) fail('extensionsRequired must be a list.');
  for (const extension of (json.extensionsRequired ?? []) as unknown[]) {
    if (typeof extension !== 'string' || !SUPPORTED_REQUIRED_EXTENSIONS.has(extension)) fail(`A required extension is unsupported: ${String(extension).slice(0, 80)}.`);
  }
  const allExtensions = new Set<string>();
  const findExtensions = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(findExtensions); return; }
    const row = value as ObjectValue;
    if (row.extensions && typeof row.extensions === 'object') Object.keys(row.extensions).forEach(name => allExtensions.add(name));
    Object.values(row).forEach(findExtensions);
  };
  findExtensions(json);
  for (const extension of ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'EXT_mesh_gpu_instancing']) {
    if (allExtensions.has(extension)) fail(`${extension} is not supported. Export an uncompressed, non-instanced GLB.`);
  }
  const buffers = objects(json.buffers, 'buffers');
  if (buffers.length > 1) fail('Only one embedded binary buffer is supported.');
  const bufferLength = buffers.length ? integer(buffers[0].byteLength, 'buffer byteLength') : 0;
  if (bufferLength > binary.byteLength || binary.byteLength - bufferLength > 3) fail('The binary buffer length is invalid.');
  const bufferViews = objects(json.bufferViews, 'bufferViews');
  const slices = bufferViews.map((bufferView, index) => {
    reference(bufferView.buffer, buffers.length, `bufferView ${index} buffer`);
    const start = integer(bufferView.byteOffset, 'bufferView offset', 0);
    const length = integer(bufferView.byteLength, 'bufferView byteLength');
    const stride = integer(bufferView.byteStride, 'bufferView byteStride', 0);
    if (!length || start + length > bufferLength) fail('A buffer view exceeds the embedded binary buffer.');
    if (stride && (stride < 4 || stride > 252 || stride % 4)) fail('A buffer view has an invalid byte stride.');
    return { start, length, stride };
  });
  let scalarCount = 0;
  const accessors = objects(json.accessors, 'accessors').map((accessor, index): AccessorInfo => {
    if (accessor.sparse !== undefined) fail('Sparse accessors are unsupported. Export dense geometry.');
    const slice = slices[reference(accessor.bufferView, slices.length, `accessor ${index} bufferView`)];
    const count = integer(accessor.count, 'accessor count');
    const type = typeof accessor.type === 'string' ? accessor.type : '';
    const components = COMPONENT_COUNTS[type];
    const componentType = integer(accessor.componentType, 'accessor componentType');
    const componentBytes = COMPONENT_BYTES[componentType];
    if (!count || !components || !componentBytes) fail('An accessor has an unsupported shape or component type.');
    scalarCount += count * components;
    if (scalarCount > 32_000_000) fail('The model contains too much accessor data.');
    const accessorOffset = integer(accessor.byteOffset, 'accessor byteOffset', 0);
    const columns = type.startsWith('MAT') ? Number(type.slice(3)) : 1;
    const columnBytes = (components / columns) * componentBytes;
    const packedBytes = columns > 1 ? columns * Math.ceil(columnBytes / 4) * 4 : components * componentBytes;
    const stride = slice.stride || packedBytes;
    if (accessorOffset % componentBytes || (slice.start + accessorOffset) % componentBytes || stride < packedBytes || accessorOffset + (count - 1) * stride + packedBytes > slice.length) fail('An accessor exceeds its buffer view or has invalid alignment.');
    if (accessor.normalized !== undefined && typeof accessor.normalized !== 'boolean') fail('Invalid accessor normalization flag.');
    return { count, components, type, componentType, offset: slice.start + accessorOffset, stride, normalized: accessor.normalized === true };
  });
  const binaryView = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const accessorAt = (value: unknown, label: string): AccessorInfo => accessors[reference(value, accessors.length, label)];
  const finiteAttribute = (accessor: AccessorInfo): void => {
    if (accessor.componentType !== 5126) return;
    for (let i = 0; i < accessor.count; i++) {
      for (let c = 0; c < accessor.components; c++) {
        if (!Number.isFinite(binaryView.getFloat32(accessor.offset + i * accessor.stride + c * 4, true))) fail('Geometry contains non-finite coordinates.');
      }
    }
  };
  const meshes = objects(json.meshes, 'meshes');
  if (!meshes.length) fail('The file does not contain a mesh.');
  const meshBudgets = meshes.map((mesh, index) => {
    const primitives = objects(mesh.primitives, `mesh ${index} primitives`);
    if (!primitives.length) fail('A mesh has no geometry primitives.');
    let vertices = 0;
    let triangles = 0;
    for (const primitive of primitives) {
      if (integer(primitive.mode, 'primitive mode', 4) !== 4) fail('Only triangle meshes are supported.');
      const attributes = object(primitive.attributes, 'primitive attributes');
      if (attributes.POSITION === undefined || attributes.NORMAL === undefined || attributes.TEXCOORD_0 === undefined) fail('Every mesh must include positions, normals, and UV coordinates (TEXCOORD_0).');
      const position = accessorAt(attributes.POSITION, 'position accessor');
      const normal = accessorAt(attributes.NORMAL, 'normal accessor');
      const uv = accessorAt(attributes.TEXCOORD_0, 'UV accessor');
      if (position.type !== 'VEC3' || position.componentType !== 5126 || normal.type !== 'VEC3' || normal.componentType !== 5126 || uv.type !== 'VEC2' || ![5121, 5123, 5126].includes(uv.componentType) || (uv.componentType !== 5126 && !uv.normalized)) fail('Position, normal, or UV accessor format is unsupported.');
      for (const attribute of Object.values(attributes)) {
        const accessor = accessorAt(attribute, 'vertex attribute');
        if (accessor.count !== position.count) fail('Vertex attributes have different vertex counts.');
        finiteAttribute(accessor);
      }
      vertices += position.count;
      let indexCount = position.count;
      if (primitive.indices !== undefined) {
        const indices = accessorAt(primitive.indices, 'index accessor');
        if (indices.type !== 'SCALAR' || ![5121, 5123, 5125].includes(indices.componentType) || indices.normalized) fail('The mesh index format is invalid.');
        indexCount = indices.count;
        for (let i = 0; i < indices.count; i++) if (readComponent(binaryView, indices.offset + i * indices.stride, indices.componentType) >= position.count) fail('A mesh index references a missing vertex.');
      }
      if (indexCount % 3) fail('A triangle mesh has an incomplete triangle.');
      triangles += indexCount / 3;
      if (vertices > GLB_LIMITS.vertices || triangles > GLB_LIMITS.triangles) fail('The mesh exceeds the geometry safety limits.');
    }
    return { vertices, triangles, draws: primitives.length };
  });
  const nodes = objects(json.nodes, 'nodes');
  if (nodes.length > GLB_LIMITS.nodes) fail('The model contains too many scene nodes.');
  for (const node of nodes) {
    for (const [key, length] of [['matrix', 16], ['translation', 3], ['rotation', 4], ['scale', 3]] as const) {
      const values = node[key];
      if (values !== undefined && (!Array.isArray(values) || values.length !== length || !values.every(value => typeof value === 'number' && Number.isFinite(value)))) fail(`A scene node has an invalid ${key} transform.`);
    }
    if (node.matrix !== undefined && ['translation', 'rotation', 'scale'].some(key => node[key] !== undefined)) fail('A scene node combines matrix and component transforms.');
  }
  const parents = new Uint16Array(nodes.length);
  const children = nodes.map(node => {
    if (node.children === undefined) return [];
    if (!Array.isArray(node.children)) fail('Node children must be a list.');
    return node.children.map(value => {
      const index = reference(value, nodes.length, 'child node');
      if (++parents[index] > 1) fail('A scene node is attached to more than one parent.');
      return index;
    });
  });
  const states = new Uint8Array(nodes.length);
  const visit = (index: number, depth: number): void => {
    if (depth > GLB_LIMITS.depth) fail('The scene hierarchy is too deep.');
    if (states[index] === 1) fail('The scene hierarchy contains a cycle.');
    if (states[index] === 2) return;
    states[index] = 1;
    children[index].forEach(child => visit(child, depth + 1));
    states[index] = 2;
  };
  nodes.forEach((_, index) => visit(index, 0));
  const scenes = objects(json.scenes, 'scenes');
  if (!scenes.length) fail('The GLB has no scene.');
  if (json.scene !== undefined) reference(json.scene, scenes.length, 'default scene');
  for (const scene of scenes) {
    if (scene.nodes === undefined) continue;
    if (!Array.isArray(scene.nodes)) fail('Scene nodes must be a list.');
    const roots = new Set<number>();
    for (const value of scene.nodes) {
      const index = reference(value, nodes.length, 'scene root');
      if (parents[index] || roots.has(index)) fail('A scene has an invalid or duplicate root node.');
      roots.add(index);
    }
  }
  let totalVertices = 0;
  let totalTriangles = 0;
  let totalDraws = 0;
  for (const node of nodes) {
    if (node.mesh === undefined) continue;
    const budget = meshBudgets[reference(node.mesh, meshes.length, 'node mesh')];
    totalVertices += budget.vertices;
    totalTriangles += budget.triangles;
    totalDraws += budget.draws;
  }
  if (totalVertices > GLB_LIMITS.vertices || totalTriangles > GLB_LIMITS.triangles || totalDraws > GLB_LIMITS.drawCalls) fail('The scene exceeds the vertex, triangle, or draw-call safety limits.');
  let texturePixels = 0;
  for (const image of objects(json.images, 'images')) {
    const slice = slices[reference(image.bufferView, slices.length, 'image bufferView')];
    const [width, height] = textureDimensions(binary.subarray(slice.start, slice.start + slice.length), String(image.mimeType));
    const pixels = width * height;
    texturePixels += pixels;
    if (!width || !height || width > 8192 || height > 8192 || pixels > GLB_LIMITS.texturePixels || texturePixels > GLB_LIMITS.totalTexturePixels) fail('Embedded textures exceed the safe image-dimension limit. Use textures of 4096 × 4096 or smaller.');
  }
  const warnings: string[] = [];
  if (objects(json.animations, 'animations').length) warnings.push('Animation clips are not played in the garment editor.');
  if (objects(json.skins, 'skins').length) warnings.push('This editor uses the imported garment pose; it does not provide skeletal animation tools.');
  return { warnings, json };
}

export interface ImportedMesh { id: string; name: string; triangles: number }
export interface ImportedGLB { group: THREE.Group; meshes: ImportedMesh[]; warnings: string[] }

export async function importGLB(input: ArrayBuffer | Uint8Array): Promise<ImportedGLB> {
  const source = input instanceof Uint8Array ? input : new Uint8Array(input);
  const { warnings } = preflight(source);
  // Copy exactly the view range, so subarray callers cannot accidentally expose
  // preceding or trailing bytes to GLTFLoader.
  const data = new Uint8Array(source.byteLength);
  data.set(source);
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    if (url.startsWith('blob:')) return url;
    return fail('The model attempted to load a resource outside its embedded binary data.');
  });
  let group: THREE.Group;
  try { group = (await new GLTFLoader(manager).parseAsync(data.buffer, '')).scene; }
  catch (error) {
    if (error instanceof Error && error.message.startsWith('GLB import:')) throw error;
    return fail('The embedded model could not be decoded. Re-export it as a standard GLB 2.0 file.');
  }
  const meshes: ImportedMesh[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  group.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const baseName = child.name.trim() || `Mesh_${meshes.length + 1}`;
    let name = baseName;
    for (let suffix = 2; names.has(name); suffix++) name = `${baseName}_${suffix}`;
    names.add(name);
    child.name = name;
    const preservedId = typeof child.userData.meshId === 'string' && child.userData.meshId.length <= 128 ? child.userData.meshId : '';
    let id = preservedId || `mesh-${meshes.length + 1}`;
    for (let suffix = 2; ids.has(id); suffix++) id = `${preservedId || `mesh-${meshes.length + 1}`}-${suffix}`;
    ids.add(id);
    child.userData.meshId = id;
    const geometry = child.geometry as THREE.BufferGeometry;
    meshes.push({ id, name, triangles: (geometry.index?.count ?? geometry.getAttribute('position').count) / 3 });
  });
  if (!meshes.length) fail('The selected scene does not contain a visible mesh.');
  group.updateMatrixWorld(true);
  return { group, meshes, warnings };
}
