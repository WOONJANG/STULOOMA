import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
export default defineConfig({
  plugins: [react(), {
    name: 'development-refresh-csp', apply: 'serve',
    transformIndexHtml: { order: 'post', handler(html) {
      const hashes = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
      return html.replace("script-src 'self';", `script-src 'self' ${hashes.join(' ')};`);
    } }
  }],
  base: './', server: { host: '0.0.0.0', port: 5173, strictPort: true },
  build: { outDir: 'dist' },
  test: { include: ['tests/unit/**/*.test.ts', 'tests/security/**/*.test.ts'], environment: 'node' }
});
