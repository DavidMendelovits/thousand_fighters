// Dev server + the whole "CMS": fighters are JSON files in ./fighters, sprite sheets are PNGs beside them.
import { defineConfig } from 'vite'
import { readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'

const dir = new URL('./fighters/', import.meta.url).pathname
mkdirSync(dir, { recursive: true })

export default defineConfig({
  server: { port: 5180, allowedHosts: ['.ts.net'], watch: { ignored: ['**/fighters/**'] } },
  plugins: [{
    name: 'fighters-api',
    configureServer(server) {
      server.middlewares.use('/api', (req, res) => {
        const [, kind, id] = (req.url ?? '').split('?')[0].split('/')
        const send = (code: number, body: unknown) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)) }
        if (req.method === 'GET' && kind === 'fighters' && !id)
          return send(200, readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(dir + f, 'utf8'))))
        if (!/^[a-z0-9_]{1,40}$/.test(id ?? '') || (kind !== 'fighters' && kind !== 'atlas')) return send(400, { error: 'bad path' })
        if (req.method === 'DELETE') { rmSync(`${dir}${id}.json`, { force: true }); rmSync(`${dir}${id}.png`, { force: true }); return send(200, {}) }
        if (req.method !== 'PUT') return send(405, { error: 'method' })
        const chunks: Buffer[] = []; let size = 0
        req.on('data', c => { size += c.length; if (size > 40e6) req.destroy(); else chunks.push(c) })
        req.on('end', () => {
          const body = Buffer.concat(chunks)
          try {
            if (kind === 'atlas') { if (body.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG'); writeFileSync(`${dir}${id}.png`, body) }
            else { const d = JSON.parse(body.toString()); if (d.id !== id) throw new Error('id mismatch'); writeFileSync(`${dir}${id}.json`, JSON.stringify(d, null, 2) + '\n') }
            send(200, {})
          } catch (e) { send(400, { error: String(e) }) }
        })
      })
    },
  }],
})
