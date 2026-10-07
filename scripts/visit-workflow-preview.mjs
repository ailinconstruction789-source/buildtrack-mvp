/** Loopback-only synthetic UI harness. Never loads application environment or database. */
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const preview = resolve(root, 'browser-tests/visit-workflow-preview');
const server = await createServer({ configFile: false, envFile: false, envDir: false, root: preview,
  cacheDir: resolve(root, '.next/visit-workflow-preview-cache'), define: { 'process.env': '{}' }, plugins: [react()],
  resolve: { alias: [
    { find: '@/lib/supabase', replacement: resolve(preview, 'supabase.ts') },
    { find: 'next/link', replacement: resolve(preview, 'link.tsx') },
    { find: 'next/image', replacement: resolve(preview, 'image.tsx') },
    { find: '@', replacement: root },
  ] }, server: { host: '127.0.0.1', port: 4179, strictPort: true, fs: { allow: [root] },
    headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:4179; font-src 'self'; form-action 'self'; frame-src 'none'" } },
});
await server.listen(); server.printUrls();
let stopping = false;
async function stop() { if (stopping) return; stopping = true; clearTimeout(timer); await server.close(); process.stdin.pause(); }
const timer = setTimeout(stop, 30 * 60_000);
process.stdin.on('data', value => { if (String(value).trim() === 'stop') void stop(); });
process.stdin.resume(); process.on('SIGINT', stop); process.on('SIGTERM', stop);
