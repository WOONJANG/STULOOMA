import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('dist-electron', { recursive: true });
await Promise.all([
  build({ entryPoints: ['electron/main/index.ts'], outfile: 'dist-electron/main.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: true }),
  // The sandboxed preload can require only Electron; bundle all local imports into one CJS file.
  build({ entryPoints: ['electron/preload/index.ts'], outfile: 'dist-electron/preload.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: true }),
]);
