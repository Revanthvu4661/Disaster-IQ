/**
 * Serve `dist/` the way the nginx image does: gzip, long-cached hashed assets,
 * SPA fallback. Used for Lighthouse runs, because `vite preview` serves
 * uncompressed responses and understates real performance.
 *
 *   node scripts/serve-dist.mjs [port]
 */

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { createGzip } from 'node:zlib'

const PORT = Number(process.argv[2] ?? 4174)
const ROOT = path.resolve('dist')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
}
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt'])

createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')
  let filePath = path.join(ROOT, decodeURIComponent(url.pathname))
  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403).end('Forbidden')
    return
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = path.join(ROOT, 'index.html') // SPA fallback
  }

  const extension = path.extname(filePath)
  const headers = { 'Content-Type': TYPES[extension] ?? 'application/octet-stream' }
  headers['Cache-Control'] = filePath.includes(`${path.sep}assets${path.sep}`)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache'

  const acceptsGzip = /\bgzip\b/.test(request.headers['accept-encoding'] ?? '')
  if (acceptsGzip && COMPRESSIBLE.has(extension)) {
    headers['Content-Encoding'] = 'gzip'
    headers.Vary = 'Accept-Encoding'
    response.writeHead(200, headers)
    createReadStream(filePath).pipe(createGzip()).pipe(response)
    return
  }
  headers['Content-Length'] = statSync(filePath).size
  response.writeHead(200, headers)
  createReadStream(filePath).pipe(response)
}).listen(PORT, () => console.log(`serving dist on http://localhost:${PORT}`))
