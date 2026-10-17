/** Three.js GLTFLoader material extensions supported by both import and storage. */
export const SUPPORTED_GLB_REQUIRED_EXTENSIONS: ReadonlySet<string> = new Set([
  'KHR_materials_unlit', 'KHR_texture_transform', 'KHR_materials_clearcoat',
  'KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_sheen',
  'KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_emissive_strength',
  'KHR_materials_iridescence', 'KHR_materials_anisotropy',
]);
