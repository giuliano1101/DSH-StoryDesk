import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStore } from './store.mjs';
import { createApi } from './api.mjs';

export { createStore, createApi };
const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const loopbacks = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' };
async function serveClient(req, res, clientDirectory) {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); res.end('请求网址不正确'); return; }
  const path = resolve(clientDirectory, `.${pathname}`);
  if (!(path === clientDirectory || path.startsWith(`${clientDirectory}${sep}`)) || pathname.split('/').some(part => part.startsWith('.'))) { res.writeHead(404); res.end('找不到此文件'); return; }
  let target = path;
  try { if (!(await stat(target)).isFile()) target = join(clientDirectory, 'index.html'); }
  catch { if (!extname(pathname)) target = join(clientDirectory, 'index.html'); }
  try {
    const content = await readFile(target);
    res.writeHead(200, { 'content-type': mimeTypes[extname(target)] || 'application/octet-stream', 'content-length': content.length, 'x-content-type-options': 'nosniff', 'cache-control': extname(target) === '.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('尚未找到工作台页面，请先完成客户端构建。'); }
}
export async function startServer({ port = 4378, host = '127.0.0.1', directory, seed, modelAdapter, clientDirectory = join(packageDirectory, 'dist/client') } = {}) {
  if (!loopbacks.has(host)) throw new Error('工作台仅支持绑定本机地址');
  const store = await createStore({ directory, seed });
  const api = createApi({ store, modelAdapter });
  clientDirectory = resolve(clientDirectory);
  const server = createServer(async (req, res) => {
    let hostname;
    try { hostname = new URL(`http://${req.headers.host}`).hostname; } catch { /* Reject malformed Host values. */ }
    if (!loopbacks.has(hostname)) { res.writeHead(403); res.end('请求来源不正确'); return; }
    try { if (!(await api(req, res))) await serveClient(req, res, clientDirectory); }
    catch { if (!res.headersSent) res.writeHead(500); res.end('工作台暂时无法完成请求'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host === '[::1]' ? '::1' : host, () => { server.off('error', reject); resolve(); }); });
  const address = server.address();
  const url = `http://${host.includes(':') ? `[${host.replace(/[\[\]]/g, '')}]` : host}:${address.port}`;
  return { server, url, store, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const app = await startServer({ port: Number(process.env.SCREENWRITER_PORT || 4378) });
  console.log(`编剧工作台已启动：${app.url}`);
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
