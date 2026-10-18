import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tree = JSON.parse(execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ls', '--omit=dev', '--all', '--long', '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
const directories = new Set();
function visit(node) {
  for (const dependency of Object.values(node.dependencies ?? {})) {
    if (dependency.path) directories.add(dependency.path);
    visit(dependency);
  }
}
visit(tree);
const licenseName = /^(?:licen[cs]e|copying|notice|ofl)(?:[._-].*)?$/i;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const portable = name => path.relative(root, name).split(path.sep).join('/');
const packages = [];
const supplements = JSON.parse(await readFile(path.join(root, 'docs/third-party/supplemental.json'), 'utf8'));
const bundleAudit = JSON.parse(await readFile(path.join(root, 'docs/bundle-audit.json'), 'utf8'));
for (const directory of [...directories].sort()) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !licenseName.test(entry.name)) continue;
    const location = path.join(directory, entry.name);
    if ((await stat(location)).size > 2 * 1024 * 1024) throw new Error(`License file exceeds safe collection limit: ${portable(location)}`);
    const bytes = await readFile(location);
    files.push({ path: portable(location), sha256: digest(bytes), text: bytes.toString('utf8') });
  }
  for (const source of supplements.filter(source => source.name === manifest.name && source.version === manifest.version)) {
    const bytes = await readFile(path.join(root, source.path));
    files.push({ path: source.path, sha256: digest(bytes), text: bytes.toString('utf8'), sourceUrl: source.url, checkedOn: source.checkedOn });
  }
  const includedInRenderer = bundleAudit.packages.some(item => item.name === manifest.name && item.version === manifest.version);
  const detectedLicense = manifest.name === 'webgl-constants' && files.some(file => file.text.includes('Permission is hereby granted, free of charge')) ? 'MIT' : undefined;
  packages.push({ name: manifest.name, version: manifest.version, installation: portable(directory), license: manifest.license ?? manifest.licenses ?? 'UNKNOWN', ...(detectedLicense ? { detectedLicense } : {}), includedInRenderer, repository: manifest.repository ?? null, licenseFiles: files });
}
packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version) || a.installation.localeCompare(b.installation));
const electron = JSON.parse(await readFile(path.join(root, 'node_modules/electron/package.json'), 'utf8'));
const binaryFiles = [];
for (const name of ['LICENSE', 'LICENSES.chromium.html']) {
  const location = path.join(root, 'node_modules/electron/dist', name);
  const bytes = await readFile(location);
  binaryFiles.push({ name, source: portable(location), bytes: bytes.length, sha256: digest(bytes), ...(name === 'LICENSE' ? { text: bytes.toString('utf8') } : {}) });
}
const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const vectorFontPath = 'public/fonts/NotoSansCJKkr-Regular.otf';
const vectorFontLicensePath = 'public/fonts/NotoSansCJKkr-LICENSE.txt';
const vectorFontBytes = await readFile(path.join(root, vectorFontPath));
const vectorFontLicense = await readFile(path.join(root, vectorFontLicensePath));
const bundledAssets = [{
  name: 'Noto Sans CJK KR Regular', license: 'OFL-1.1', path: vectorFontPath,
  bytes: vectorFontBytes.length, sha256: digest(vectorFontBytes),
  sourceUrl: 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/Korean/NotoSansCJKkr-Regular.otf',
  licenseFile: vectorFontLicensePath, licenseSha256: digest(vectorFontLicense), text: vectorFontLicense.toString('utf8'),
}];
const notice = {
  format: 'STULOOMA third-party notices', version: 1, generatedOn: date, timezone: 'Asia/Seoul',
  scope: 'Installed npm runtime dependency tree from npm ls --omit=dev --all --long --json, plus Electron binary license references. Metadata and collected root notice texts are an attribution record, not a legal compatibility assessment. Dev-only tooling and potentially embedded source-level notices require separate release review.',
  application: { name: tree.name, version: tree.version, license: tree.license },
  desktopRuntime: { name: 'electron', version: electron.version, license: electron.license, binaryFiles },
  bundleAudit: { source: 'docs/bundle-audit.json', chunks: bundleAudit.chunks },
  unresolved: packages.filter(item => (item.license === 'UNKNOWN' && !item.detectedLicense) || item.licenseFiles.length === 0).map(item => ({ name: item.name, version: item.version, license: item.license, includedInRenderer: item.includedInRenderer, issue: item.license === 'UNKNOWN' ? 'Missing license metadata' : 'No root license/notice file found; inspect upstream package before including it in a future release' })),
  packages,
  bundledAssets,
};
await writeFile(path.join(root, 'THIRD_PARTY_NOTICES.json'), `${JSON.stringify(notice, null, 2)}\n`);
const text = [
  `STULOOMA ${tree.version} — THIRD-PARTY NOTICES`,
  `Generated ${date} (Asia/Seoul)`, notice.scope,
  'The application package itself is UNLICENSED; no application distribution license is granted by dependency licenses.',
  `Electron ${electron.version}: ${electron.license}`,
  'The Electron/Chromium distribution includes LICENSE and LICENSES.chromium.html. Keep those files with each desktop release.',
  binaryFiles.find(file => file.name === 'LICENSE').text,
  ...bundledAssets.map(asset => `${'='.repeat(72)}\n${asset.name}\n${asset.license}\n${asset.path}\nSHA-256: ${asset.sha256}\n${asset.text}`),
  ...packages.map(item => [
    '='.repeat(72), `${item.name}@${item.version}`, `Declared license: ${typeof item.license === 'string' ? item.license : JSON.stringify(item.license)}`,
    `Installation: ${item.installation}`,
    item.licenseFiles.length ? item.licenseFiles.map(file => `--- ${path.basename(file.path)} ---\n${file.text}`).join('\n\n') : 'No root license text found. Inspect upstream before release.',
  ].join('\n')),
  notice.unresolved.length ? `UNRESOLVED REVIEW ITEMS\n${JSON.stringify(notice.unresolved, null, 2)}` : 'All recorded installed runtime packages have license metadata and a root license/notice file.',
].join('\n\n');
await writeFile(path.join(root, 'THIRD_PARTY_NOTICES.txt'), `${text}\n`);
console.log(`Recorded ${packages.length} installed runtime package locations; ${notice.unresolved.length} require license-file review.`);
