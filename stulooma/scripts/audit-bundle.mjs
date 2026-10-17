import { build } from 'vite';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const digest = data => createHash('sha256').update(data).digest('hex');
await build({ build: { write: false }, plugins: [{
  name: 'stulooma-bundle-attribution-audit',
  async generateBundle(_options, bundle) {
    const modules = [], packages = new Map(), chunks = [];
    for (const [fileName, chunk] of Object.entries(bundle)) {
      if (chunk.type !== 'chunk') continue;
      const actual = await readFile(path.join(root, 'dist', fileName));
      if (digest(actual) !== digest(chunk.code)) throw new Error(`Build audit differs from distributed chunk: ${fileName}`);
      chunks.push({ fileName, sha256: digest(actual), bytes: actual.length });
      for (const [id, info] of Object.entries(chunk.modules)) {
        if (!info.renderedLength || !id.includes('/node_modules/')) continue;
        modules.push({ path: path.relative(root, id), renderedLength: info.renderedLength, chunk: fileName });
        let folder = path.dirname(id.split('?')[0]);
        while (folder.includes('node_modules')) {
          try { const pkg = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'));
            if (!pkg.name || !pkg.version) { folder = path.dirname(folder); continue; }
            packages.set(`${pkg.name}@${pkg.version}`, { name: pkg.name, version: pkg.version, installation: path.relative(root, folder), license: pkg.license ?? null }); break;
          } catch { folder = path.dirname(folder); }
        }
      }
    }
    // Font CSS produces assets instead of JS modules, so account for it explicitly.
    if (Object.keys(bundle).some(name => name.includes('noto-sans-kr') && name.endsWith('.woff2'))) {
      const pkg = JSON.parse(await readFile(path.join(root, 'node_modules/@fontsource-variable/noto-sans-kr/package.json'), 'utf8'));
      packages.set(`${pkg.name}@${pkg.version}`, { name: pkg.name, version: pkg.version, installation: `node_modules/${pkg.name}`, license: pkg.license });
    }
    await writeFile(path.join(root, 'docs/bundle-audit.json'), JSON.stringify({
      checkedOn: '2026-10-18', method: 'Vite write:false generateBundle module renderedLength > 0, plus emitted font assets; every JS chunk SHA-256 compared with dist.',
      chunks, packages: [...packages.values()].sort((a,b)=>a.name.localeCompare(b.name)), modules,
    }, null, 2) + '\n');
  }
}] });
