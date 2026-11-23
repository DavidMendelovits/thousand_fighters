// npx tsx cli.ts            validate every fighter in fighters (exit 1 on any failure)
// npx tsx cli.ts fuzz 1000  design 1000 fighters in memory and validate them all
// npx tsx cli.ts roster 32  write the first 32 roster fighters to fighters
// npx tsx cli.ts legacy     re-create the old roster from public/fighters/*/description.txt
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { validate } from './validate'
import { design, rosterFighter } from './design'
import type { FighterDef } from './kit'

const dir = new URL('./fighters/', import.meta.url).pathname
const [cmd, arg] = process.argv.slice(2)
const save = (d: FighterDef) => { mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}${d.id}.json`, JSON.stringify(d, null, 2) + '\n') }

function report(defs: FighterDef[]) {
  const t0 = performance.now(), fails = new Map<string, number>()
  let bad = 0
  for (const d of defs) {
    const r = validate(d)
    if (r.ok) continue
    bad++
    for (const c of r.checks) if (!c.ok) { fails.set(c.name.replace(/^(String|Special).*/, '$1'), (fails.get(c.name.replace(/^(String|Special).*/, '$1')) ?? 0) + 1); if (defs.length <= 60) console.log(`✘ ${d.id}: ${c.name} — ${c.detail}`) }
  }
  console.log(`${defs.length - bad}/${defs.length} fighters pass every check (${((performance.now() - t0) / defs.length).toFixed(1)}ms each)`)
  for (const [k, n] of fails) console.log(`  ${n}× ${k}`)
  process.exit(bad ? 1 : 0)
}

if (cmd === 'fuzz') report(Array.from({ length: +arg || 100 }, (_, i) => rosterFighter(i)))
else if (cmd === 'roster') { const n = +arg || 32; for (let i = 0; i < n; i++) save(rosterFighter(i)); console.log(`wrote ${n} fighters to ${dir}`) }
else if (cmd === 'legacy') {
  const old = new URL('../public/fighters/', import.meta.url).pathname
  let n = 0
  for (const id of readdirSync(old)) {
    const f = `${old}${id}/description.txt`
    if (!existsSync(f)) continue
    const d = design(readFileSync(f, 'utf8'))
    save({ ...d, id, name: id.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ') }); n++
  }
  console.log(`re-created ${n} legacy fighters`)
}
else report(readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(dir + f, 'utf8'))))
