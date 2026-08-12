/**
 * relay/server.js — Relay E2EE tonto para drip partner sync.
 *
 * Un relay es un buzón: solo guarda y entrega blobs CIFRADOS por pairingId.
 * Nunca ve el contenido (las claves viven en los dispositivos).
 *
 * API:
 *   GET  /health                 -> { ok: true }
 *   PUT  /pairing/:pairingId     body: { blob: "<base64 cifrado>" }   (upsert)
 *   GET  /pairing/:pairingId     -> { blob: "<base64 cifrado>" | null, updatedAt }
 *
 * Seguridad mínima de un buzón:
 *   - Cada pairingId solo expone SU blob (path-based, nada más)
 *   - Sin listados, sin cross-reads
 *   - El blob es ininteligible sin las claves locales (E2EE)
 *
 * Uso: node relay/server.js [PORT=8080] [DATA_DIR=./data]
 * Sin dependencias externas.
 */

const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = Number(process.argv[2] || process.env.PORT || 8080)
const DATA_DIR = process.argv[3] || process.env.DATA_DIR || path.join(__dirname, 'data')

fs.mkdirSync(DATA_DIR, { recursive: true })

// pairingId -> archivo; contenido = JSON {blob, updatedAt}
function blobPath(pairingId) {
  // sanitizar: solo hex (los pairingId son hashes hex de 16 chars)
  if (!/^[0-9a-f]{8,64}$/.test(pairingId)) return null
  return path.join(DATA_DIR, `${pairingId}.json`)
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('payload demasiado grande'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  console.log('[relay]', req.method, req.url)
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    res.end()
    return
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'drip-partner-relay' }))
    return
  }

  const m = url.pathname.match(/^\/pairing\/([0-9a-f]{8,64})$/)
  if (!m) {
    res.writeHead(404, { ...cors, 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
    return
  }
  const pairingId = m[1]
  const file = blobPath(pairingId)
  if (!file) {
    res.writeHead(400, { ...cors, 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'bad pairingId' }))
    return
  }

  if (req.method === 'PUT') {
    try {
      const body = JSON.parse(await readBody(req))
      if (!body.blob || typeof body.blob !== 'string' || body.blob.length > 1024 * 1024) {
        res.writeHead(400, { ...cors, 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'blob requerido (string base64, max 1MB)' }))
        return
      }
      const record = { blob: body.blob, updatedAt: new Date().toISOString() }
      fs.writeFileSync(file, JSON.stringify(record))
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, updatedAt: record.updatedAt }))
    } catch (e) {
      res.writeHead(400, { ...cors, 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  if (req.method === 'GET') {
    try {
      const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' })
      res.end(JSON.stringify(raw || { blob: null, updatedAt: null }))
    } catch (e) {
      res.writeHead(500, { ...cors, 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  res.writeHead(405, { ...cors, 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'method not allowed' }))
})

server.listen(PORT, () => {
  console.log(`[drip-relay] escuchando en :${PORT} (datos en ${DATA_DIR})`)
})
