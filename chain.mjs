import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await b.newPage()
const lines = [], bad = []
p.on('pageerror', e => bad.push(String(e).slice(0,140)))
p.on('console', m => { const t = m.text(); if (/preview-block-cache/.test(t)) lines.push(t) })
await p.addInitScript(() => localStorage.setItem('thockdown:debug-input-lag', '1'))
await p.goto('http://localhost:5199/', { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
const note = p.locator('.note-list-item').first()
await note.click(); await p.waitForTimeout(2500)
lines.length = 0
await p.locator('.help-guide').first().click(); await p.waitForTimeout(1500)
await note.click(); await p.waitForTimeout(1800)
console.log(lines.filter(l => /persisting out|activation|prewarm completed/.test(l)).join('\n'))
console.log('--- errors:', bad.length ? bad.join('\n') : 'none')

// Corrupt the persisted record's version and confirm it is refused.
await p.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('thockdown:browser-mock') ?? '{}')
  for (const s of Object.values(raw.noteUiStates ?? {})) if (s.previewBlockCache) s.previewBlockCache.v = 99
  localStorage.setItem('thockdown:browser-mock', JSON.stringify(raw))
})
