import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { bytesToDataUrl, createProject, loadProject, saveProject } from '../src/core/project';

const root = resolve(import.meta.dirname, '..');
const project = createProject('basketball');
project.name = '서울 유니폼 — 김수현 23';
project.regions.FRONT!.color = '#273d36';
project.regions.BACK!.color = '#273d36';
project.regions.COLLAR!.color = '#e9bc57';
project.regions.LEFT_SIDE!.color = '#e9bc57';
project.regions.RIGHT_SIDE!.color = '#e9bc57';
const logo = new Uint8Array(await readFile(resolve(root, 'samples/artwork/transparent-logo.png')));
project.assets.logo = { id: 'logo', name: 'STULOOMA 자체 제작 투명 로고.png', mime: 'image/png', data: bytesToDataUrl(logo, 'image/png') };
project.layers = [
  { id: 'front-logo', name: '앞판 로고', type: 'image', regionId: 'FRONT', assetId: 'logo', x: 0.5, y: 0.35, width: 0.5, height: 0.5, rotation: 0, opacity: 1, visible: true, locked: false },
  { id: 'front-team', name: '팀 이름', type: 'text', regionId: 'FRONT', text: 'SEOUL', color: '#e9bc57', fontSize: 100, x: 0.5, y: 0.66, width: 0.6, height: 0.12, rotation: 0, opacity: 1, visible: true, locked: false },
  { id: 'back-name', name: '한국어 선수 이름', type: 'text', regionId: 'BACK', text: '김수현', color: '#ffffff', fontSize: 90, x: 0.5, y: 0.3, width: 0.65, height: 0.12, rotation: 0, opacity: 1, visible: true, locked: false },
  { id: 'back-number', name: '등번호', type: 'text', regionId: 'BACK', text: '23', color: '#e9bc57', fontSize: 280, x: 0.5, y: 0.55, width: 0.6, height: 0.35, rotation: 0, opacity: 1, visible: true, locked: false },
];
project.metadata = { author: 'STULOOMA 독립 제작 예제', modelVersion: 1, purpose: '한국어·앞뒤 디자인·원본 PNG 보존 round-trip' };
const bytes = await saveProject(project);
const restored = await loadProject(bytes);
if (JSON.stringify(restored) !== JSON.stringify(project)) throw new Error('Sample project round-trip failed');
await mkdir(resolve(root, 'samples/projects'), { recursive: true });
await writeFile(resolve(root, 'samples/projects/korean-front-back.stulooma'), bytes);
console.log(`Verified sample project: samples/projects/korean-front-back.stulooma (${bytes.length} bytes)`);
