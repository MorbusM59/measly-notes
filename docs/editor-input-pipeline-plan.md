# The editor input pipeline — plan and handoff

Written for the agent who picks this up next. Everything stated as fact here
was verified in the session that wrote it; everything not verified is marked as
a question, not an assumption. Keep that discipline — the whole point of this
document is that the pipeline gets rebuilt from *what each operation actually
needs*, not from what the current code happens to do.

Read `docs/document-scale-performance-philosophy.md` first for the standing
contract, and `docs/large-document-performance-handover.md` for the measurement
history this grew out of.

## The goal

Typing in a large note must cost what typing in a small note costs. Not "fast
enough" — *the same*. A keystroke's work should be proportional to what the
keystroke changed, never to how much text surrounds it.

The intent is a **hand-built pipeline that does exactly what this editor needs**.
Where a general-purpose mechanism is doing general-purpose work, the question is
not "can it be tuned" but "what does this app actually require here, and what is
the smallest thing that delivers it". Several costs below exist only because a
generic structure was reached for early, or because machinery for an editor that
no longer exists is still being carried.

## Where things stand (measured, `--shape=realistic`, 1.5M characters)

`node scripts/perf/measureTypeLatency.mjs --chars=1500000 --shape=realistic
--keystrokes=10 --position=middle --gap=500 --key=<key>`

| key | handler (keydown → end of the synchronous task) |
| --- | --- |
| plain character | 31.3ms |
| **Enter** | **43.8ms** |
| Backspace | 34.0ms |

Enter costs ~12ms more than an ordinary character, every single press. That is
the target. A small note pays ~14ms for any key, so roughly half the 31.3ms is
document-scale cost that is also still open, and the other half is fixed
overhead (CM6's commit, the app's re-render, the caret pass).

### Know what each instrument cannot see

This has cost this effort more time than any bug. Read before measuring.

* **`npm run perf:input-lag` has a ~14ms floor.** It times
  `page.keyboard.press` from Node, so every sample includes a CDP round trip:
  it reports ~13.8ms on a 3,000-character note and ~16.0ms on a 400,000-character
  one. It cannot see a change smaller than its own noise, and it is the reason
  this cost was believed "resolved" for a long time. Do not use it for anything
  in this document.
* **`handler` timing goes blind the moment work is deferred.** Moving a cost
  off the keystroke's own task onto a later idle moment improves `handler` and
  changes nothing the reader feels — the main thread is still blocked. When you
  defer rather than remove, **the long-task count is the metric**, not
  `handler`.
* **A measurement cadence slower than a debounce turns deferred work back into
  per-keystroke work.** Typing at 300ms intervals settles every 200ms debounce
  in the app, so profiles taken that way attribute debounced work to every
  keystroke. Check the cadence against the debounce before believing an
  attribution.
* **Document shape changes the answer more than document size.** Use
  `--shape=realistic` (headings, prose, short lists). `--shape=indented` and
  `--shape=indented-spaced` are deliberate extremes — 5,000 list rows and
  nothing else — kept only to show what a pathological document does. An
  earlier round of this work reported a "~1 second per keystroke" figure that
  was entirely an artifact of that fixture.
* **`dev:browser` has no `thockdownExternalFiles` mock at all**, so every
  external-file path is inert there.

## The pipeline as it actually is

Verified by reading, this session. Line numbers drift — find by name.

A keypress reaching `CM6Editor.tsx`'s `keydown` handler is offered to a chain of
transform callbacks (`EditorContract.ts`'s `EditorBindings`). **All five share
one shape:**

```
(event & { text: <THE WHOLE DOCUMENT>, selection })
  => { text: <A WHOLE NEW DOCUMENT>, selection } | null
```

`onEnterTransform`, `onTabIndentTransform`, `onMarkdownShortcutTransform`,
`onCharacterInsertTransform`, `onCaretClickTransform`.

**That contract is the root cause.** A transform knows exactly what it changed
and where; the contract discards that and hands back a whole document, so the
caller has to rediscover the edit position by comparing two 1.5M-character
strings.

Following Enter specifically:

1. `CM6Editor.tsx` passes `previousTextRef.current` (the whole document) as
   `text`.
2. `EnterTransformPolicy.resolveMarkdownEnterTransform` calls
   `normalizeInternalText(event.text)` — regex passes over the whole document,
   on text that is **already canonical** by construction.
3. `MarkdownContext.applyMarkdownEnter` calls
   `resolveMarkdownSelectionContext(sourceText, selection)`, which does **two
   O(document) passes**:
   * `countLineIndex(safeText, lineStart)` — counts newlines from offset 0.
   * `computeInlineStateAtOffset(safeText, caretOffset)` — scans inline state
     from offset 0.
4. `applyMarkdownEnter` builds `nextText` by slicing and concatenating around
   the caret: **a whole new document string**.
5. `CM6Editor.applyTransformResult` recovers the edit range from that string
   with `commonPrefixLen` + `commonSuffixLen` — two more scans that between them
   walk the entire document to find a position step 4 already knew.
6. It dispatches the resulting `{from, to, insert}` to CM6.

A plain character insert does none of this. `onCharacterInsertTransform`
(`ChecklistTypingTransformPolicy`) short-circuits on cheap `charCodeAt` checks
and returns `null` in the ordinary case — **it is already built the way this
document argues for**, and is the model to copy. The contract is only dangerous
for transforms that actually fire, and Enter fires on essentially every press.

## What Enter actually requires, against what it does

Verified by reading `applyMarkdownEnter`'s body: of the whole
`MarkdownSelectionContext` it is handed, it uses exactly four things —
`inline.inFencedCodeBlock`, `line.lineText`, `line.lineStart`,
`line.lineEndExclusive`. It re-derives the line's structure itself via
`parseLineStructure(lineText)`.

So per press:

| computed | used? |
| --- | --- |
| `countLineIndex` — **O(document)** | **no. Discarded entirely.** |
| `computeInlineStateAtOffset` — **O(document)** | one boolean (`inFencedCodeBlock`) |
| `blockquoteDepth`, `headingLevel`, `listMeta` on the line | no — recomputed by `parseLineStructure` |
| `lineStart` / `lineEndExclusive` / `lineText` | yes — and these are O(line), already cheap |

**And an incremental variant already exists.**
`resolveMarkdownSelectionContextIncremental` maintains an `InlineStateLineCache`
and is used by `useMarkdownFormattingToolbar` — but the Enter path calls the
non-incremental one. Nobody decided that; the fast path was simply never wired
to the hot caller.

This is the clearest example of the bloat this rebuild is aimed at: a generic
"resolve everything about the caret's context" object, most of it thrown away,
two full-document scans to produce it, and a cheaper implementation of the same
thing sitting unused in the same file.

## Dead weight, verified

**1,319 lines of orphaned editor code**, none of it imported by anything
outside its own island or tests:

| file | lines | note |
| --- | --- | --- |
| `editor/SelectionOffsets.ts` (+ test) | 484 (+test) | imported only by `CaretTerminalOffset` |
| `editor/ParagraphOffsetIndex.ts` (+ test) | 295 (+test) | **zero consumers** |
| `editor/RefocusTransaction.ts` | 56 | zero consumers |
| `editor/CaretVisualPosition.ts` | 34 | zero consumers |
| `editor/CaretTerminalOffset.ts` | 30 | imported only by `CaretVisualPosition` |
| `editor/ContractInvariantHarness.ts` | — | zero consumers |
| `editor/ScenarioProbe.ts` | 23 | zero consumers |

`SelectionOffsets` → `CaretTerminalOffset` → `CaretVisualPosition` is a closed
island: `CM6Editor.tsx` mentions the last two **only in comments**, never
imports them.

`ParagraphOffsetIndex` deserves a specific note, because it is the sharpest
illustration of the point. It is a positional treap built to make Lexical's
`getOffsetWithinRoot` O(log n) instead of O(document) — a genuine, hard-won,
well-tested win, written up at length in the handover doc as a headline result.
CM6 does not have that problem, so the treap has been dead since Lexical was
removed. **A past optimization is not evidence of present need.** Check the
consumer list before preserving anything on the strength of its history.

`CM6Editor.tsx` is 5,949 lines and mentions Lexical 33 times, mostly in
comments explaining why CM6 differs. Those comments are worth reading before
changing behaviour and worth deleting once the reasoning no longer refers to a
live alternative.

## The shape of the fix

**Give transforms a contract that carries what they know.** Instead of
`{ text, selection }` out, return the edit:

```
{ from: number; to: number; insert: string; selection: EditorSelectionState }
```

That deletes steps 4 and 5 outright — no whole-document string is built, and no
scan is needed to rediscover the position. `applyTransformResult` becomes a
dispatch.

Then, separately: give the transforms an *input* that is not the whole document
either. The transforms need the caret's line and a small amount of block
context; only `inFencedCodeBlock` genuinely depends on everything before the
caret, and that is exactly what an incrementally maintained cache is for.

**Do these as two steps, measuring between them.** The output contract is the
bigger and safer win; the input side needs the cache-correctness argument made
properly.

## Rules for doing this well

1. **Establish what each operation requires before touching it.** For every
   transform, write down the minimum information it needs to produce its edit.
   `applyMarkdownEnter` needs four fields; the others have not been audited and
   that audit is the first task, not an implementation detail.
2. **Never trust a past optimization's write-up as evidence it is still
   needed.** Check consumers. `ParagraphOffsetIndex` has a superb doc comment
   and zero callers.
3. **Prove the assumption, don't reason about it.** This codebase has burned
   multiple sessions on plausible-but-wrong caching arguments — see the
   `PreviewBlockSplit` code-fence hazard and the Lexical node-identity cache in
   the handover doc. Both passed careful reasoning and failed against real
   output. Fuzz new caches against a ground-truth implementation.
4. **Measure with the right instrument and say which one.** Quote the shape,
   the size, the key and the metric. A number without those is not a result.
5. **A/B every fix by disabling it,** so you know your check can actually fail.
   Two "fixes" this effort shipped were unproven because the fixture passed with
   them disabled.
6. **`npm test` and the preview suite are the safety net** —
   `verifyPreviewWindow`, `verifyPreviewCharThumb`, `verifyPreviewTrackLanding`,
   `verifyPreviewRestStability`, `verifyModeToggleRoundTrip`,
   `verifyProgrammaticSwitchCaret`. The transform work touches caret placement,
   which is the highest-severity surface in this codebase: a wrong offset does
   not look wrong, it edits the wrong place.

## Questions to answer before writing code

None of these are settled. Answer them from the code, not from this document.

1. What is the minimum input each of the five transforms needs? (Enter is
   answered above. Tab, markdown-shortcut, character-insert and caret-click are
   not.)
2. Can `inFencedCodeBlock` be answered from an incrementally maintained cache
   cheaply and *correctly* under arbitrary edits — including edits that open or
   close a fence far from the caret? This is the same forward-unbounded hazard
   class that `PreviewBlockSplit` documents; assume it applies until proven
   otherwise.
3. Is `normalizeInternalText(event.text)` in the transform policies ever load
   bearing, or is the document canonical by construction at that point? If
   canonical, the call is pure waste on every transform. If not, what makes it
   non-canonical, and should that be fixed at the source instead?
4. Do `onTabIndentTransform` / `onMarkdownShortcutTransform` operate over
   selections large enough that a single `{from, to, insert}` range is the wrong
   shape? (`indentSelectionByStep` suggests multi-line edits — check whether one
   range still expresses them.)
5. What is the ~14ms floor a 5,000-character note pays made of? That is now
   comparable to the document-scale cost and nobody has attributed it.
6. Which of the 1,319 orphaned lines can simply be deleted, and does anything in
   them encode knowledge worth keeping as a comment somewhere live?
