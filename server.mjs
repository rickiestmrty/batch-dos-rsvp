// Local dev server: serves the static site and POST /api/rsvp, mirroring Vercel.
// Run with `pnpm dev` (loads .env.local).
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { recordRsvp } from './lib/rsvp.js'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const PORT = Number(process.env.PORT) || 5173
const MAX_BODY = 4096

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

// Only the public site is served — never lib/, api/, .env files or node_modules.
const PUBLIC = (path) => path === '/index.html' || /^\/(script\.js|styles\.css)$/.test(path) || path.startsWith('/assets/')

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type })
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

async function handleRsvp(req, res) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > MAX_BODY) return send(res, 413, { ok: false, error: 'Too large.' })
  }
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    return send(res, 400, { ok: false, error: 'Body must be JSON.' })
  }
  const result = await recordRsvp(body)
  send(res, result.status, result.body)
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')

  if (url.pathname === '/api/rsvp') {
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed.' })
    return handleRsvp(req, res)
  }

  let path
  try {
    path = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)
  } catch {
    return send(res, 400, 'Bad request', 'text/plain')
  }
  // Allow-list the path *after* resolving it, so "/assets/%2e%2e/.env.local" is refused.
  const file = normalize(join(ROOT, path))
  const rel = '/' + relative(ROOT, file).split(sep).join('/')
  if (rel.startsWith('/..') || !PUBLIC(rel)) return send(res, 404, 'Not found', 'text/plain')

  try {
    const data = await readFile(file)
    send(res, 200, data, TYPES[extname(file)] ?? 'application/octet-stream')
  } catch {
    send(res, 404, 'Not found', 'text/plain')
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`RSVP site on http://127.0.0.1:${PORT}`)
})
