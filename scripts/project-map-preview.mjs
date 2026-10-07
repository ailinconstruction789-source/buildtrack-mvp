/** Loopback-only visual fixture; no application environment, credentials, or database. */
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const preview = resolve(root, 'browser-tests/project-map-preview');
const server = await createServer({ configFile: false, envFile: false, envDir: false, root: preview, cacheDir: resolve(root, '.next/project-map-preview-cache'),
  define: { 'process.env': '{}' }, plugins: [react()], resolve: { alias: [
    { find: '@/lib/supabase', replacement: resolve(preview, 'supabase.ts') },
    { find: '@', replacement: root },
  ] },
  server: { host: '127.0.0.1', port: 4178, strictPort: true, fs: { allow: [root] } },
});
await server.listen(); server.printUrls();
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await server.close(); clearTimeout(timer); process.stdin.pause(); console.log('Map fixture stopped.'); }
const timer = setTimeout(stop, 10 * 60_000);
process.stdin.on('data', value => { if (String(value).trim() === 'stop') void stop(); });
process.stdin.resume(); process.on('SIGINT', stop); process.on('SIGTERM', stop);
