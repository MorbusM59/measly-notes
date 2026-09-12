import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

/**
 * A full remark parse never runs on the main thread.
 *
 * This rule was already true in intent and false in fact at SEVEN call
 * sites. One of them -- a `useMemo` in usePreviewMarkdownRendering -- cost
 * 26 seconds on the first open of a 2MB note in a packaged build, with a
 * worker sitting right there, built for exactly that parse, that could never
 * win because a synchronous reader upstream always got the answer first.
 * Three more were hidden behind a single optional `blocks` parameter that
 * quietly parsed when handed none.
 *
 * So the rule is not remembered, it is enforced. The two TOTAL entry points
 * in PreviewBlockSplit.ts -- the ones that can reach `fullSplit` -- may be
 * imported only by the worker that exists to run them, by the client that
 * owns the documented no-worker fallback, and by tests. Everything else on
 * the main thread takes `splitPreviewBlocksWithoutFullParse`, which returns
 * null rather than parsing, or awaits `requestFullBlockSplit`.
 *
 * Parsed with the TypeScript compiler rather than matched with a regex,
 * because the question is about IMPORT BINDINGS: the same identifiers appear
 * in prose comments across these files (deliberately -- they explain why the
 * call is not there), and a regex cannot tell a comment from a binding.
 */

const TOTAL_SPLIT_EXPORTS = new Set([
  'splitMarkdownIntoPreviewBlocks',
  'splitMarkdownIntoPreviewBlocksIncremental',
])

/**
 * The worker runs the parse; the client owns the fallback for an environment
 * that cannot construct one (see blockSplitClient.ts's own doc comment on
 * why that fallback is a slow path rather than a broken one).
 */
const ALLOWED = new Set([
  'editor/blockSplit.worker.ts',
  'editor/blockSplitClient.ts',
])

const SRC = new URL('..', import.meta.url).pathname

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

function totalSplitImports(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: string[] = []

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      // `propertyName` is the exported name in `import { a as b }`; without
      // one the local name IS the exported name.
      const imported = (element.propertyName ?? element.name).text
      if (element.isTypeOnly) continue
      if (TOTAL_SPLIT_EXPORTS.has(imported)) found.push(imported)
    }
  }
  return found
}

describe('the block split contract', () => {
  it('keeps every full-document parse off the main thread', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const path = relative(SRC, file).split('\\').join('/')
      if (ALLOWED.has(path)) continue
      for (const imported of totalSplitImports(file)) {
        offenders.push(`${path} imports ${imported}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('names entry points that actually exist, so a rename cannot silently disarm it', async () => {
    const module = await import('./PreviewBlockSplit')
    for (const name of TOTAL_SPLIT_EXPORTS) {
      expect(typeof (module as Record<string, unknown>)[name]).toBe('function')
    }
    expect(typeof module.splitPreviewBlocksWithoutFullParse).toBe('function')
  })
})
