import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await b.newPage()
const lines = []
p.on('console', m => { const t = m.text(); if (t.includes('[preview-block-cache]')) lines.push(t) })
await p.addInitScript(() => localStorage.setItem('thockdown:debug-input-lag', '1'))
await p.goto('http://localhost:5199/', { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.locator('.note-list-item').first().click()
await p.waitForTimeout(3000)
console.log('--- 3s after opening a note:')
console.log(lines.filter(l => /prewarm|DB cache/.test(l)).join('\n') || '(none)')
await b.close()
