import { spawn } from 'node:child_process';
import process from 'node:process';
import { setTimeout } from 'node:timers/promises';
import electron from 'electron';

const origin = 'http://127.0.0.1:5173';
const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
function start(command, args, env = process.env) {
  const child = spawn(command, args, { stdio: 'inherit', env, shell: false });
  children.add(child);
  child.on('error', (error) => { console.error(error.message); stop(1); });
  child.on('exit', (code) => { children.delete(child); stop(code ?? 0); });
  return child;
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

await import('./build-electron.mjs');
start(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort']);
let ready = false;
for (let attempt = 0; attempt < 100 && !stopping; attempt++) {
  try { const response = await fetch(origin); ready = response.ok; } catch { /* Vite is still starting. */ }
  if (ready) break;
  await setTimeout(150);
}
if (!ready || stopping) stop(1);
else start(electron, ['.'], { ...process.env, STULOOMA_DEV_URL: origin });
