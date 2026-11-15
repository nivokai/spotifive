// Petit serveur de fichiers pour prévisualiser l'interface dans un navigateur :
//   node dev/serve.mjs   puis ouvrir http://localhost:5173/ui/
// L'interface y tourne avec le faux backend de dev/mock.js.

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT) || 5173;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (path === '/') {
    response.writeHead(302, { Location: '/ui/' });
    return response.end();
  }
  let file = normalize(join(root, path));
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) {
    response.writeHead(403);
    return response.end();
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    response.writeHead(404);
    return response.end('Introuvable');
  }
  response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`Aperçu de l'interface : http://localhost:${port}/ui/`));
