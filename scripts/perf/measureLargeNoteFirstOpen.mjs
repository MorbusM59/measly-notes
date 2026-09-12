// Where the time goes when a LARGE, NEVER-OPENED note is first opened --
// the imported-2MB-file case.
//
// The parse is no longer on this path at all (block zero is line zero, and
// the map is built later on a worker -- see EditRestoreMath.ts and
// blockSplitClient.ts), so what remains is mounting the document. This
// attributes that remainder, because "chunk the mount" is only the right fix
// if the mount is where the time is.
//
// KNOW WHAT THIS INSTRUMENT CANNOT SEE. Against `dev:browser` the browser
// mock (src/dev/installBrowserMockBridges.ts) serializes its ENTIRE store to
// localStorage on every write -- including the multi-megabyte note under
// test -- so `persistStore`/`setItem`/`clone` show up as a large, note-size-
// PROPORTIONAL cost that does not exist in the real app, where the same
// writes are SQLite over IPC. Measured at ~177ms of 1131ms on a 1953KB note,
// plus an unknown share of the unattributable `(program)` bucket. Because it
// scales with the note, it cannot be subtracted as a constant.
//
// So read this script's ORDERING of app-level frames, and do not trust its
// absolute numbers or its native buckets. For a real answer, run it against
// a packaged Electron build.
//
// Run: node scripts/perf/measureLargeNoteFirstOpen.mjs [targetChars]

import { chromium } from 'playwright'
import {
  startDevServer,
  waitForAppReady,
  startCdpJsProfile,
} from './perfHarness.mjs'

const TARGET_CHARS = Number(process.argv[2] ?? 2_000_000)
const PORT = 5251

const server = await startDevServer(PORT)
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage()

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' })
  await waitForAppReady(page).catch(() => {})
  await page.waitForTimeout(1500)

  const kb = await page.evaluate(async (targetChars) => {
    let text = '# Imported Report\n\n'
    while (text.length < targetChars) {
      text += `## Section ${text.length}\n\nA paragraph of prose long enough to wrap in a real editor window.\n\n- alpha\n- beta\n\n`
    }
    const note = await window.thockdownNotes.createNote({ title: 'Imported Report' })
    await window.thockdownNotes.saveNote({ id: note.id, text })
    return Math.round(text.length / 1024)
  }, TARGET_CHARS)
  console.log(`note: ${kb} KB, never opened`)

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  const profile = await startCdpJsProfile(page)
  const started = Date.now()
  await page.locator('.note-list-item').first().click()
  await page.waitForFunction(
    () => (document.querySelector('.cm-content')?.textContent ?? '').includes('Imported Report'),
    null,
    { timeout: 30000 },
  )
  const firstText = Date.now() - started
  await page.waitForTimeout(500)
  const { totalMs, entries } = await profile.stop()

  console.log(`time to first text: ${firstText}ms   (profiled ${Math.round(totalMs)}ms total)\n`)
  console.log('self time, hottest first:')
  for (const row of entries.slice(0, 20)) {
    console.log(`  ${String(Math.round(row.ms)).padStart(6)}ms  ${row.name}`)
  }
} finally {
  await browser.close()
  server.stop?.()
}
