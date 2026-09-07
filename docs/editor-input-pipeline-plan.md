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

Session 3 shipped the first round of this rebuild. Interleaved A/B against
the pre-session tree, three rounds each, on one machine (slower than the one
the original figures came from -- compare within a column, not across):

| key | before | after | Enter penalty |
| --- | --- | --- | --- |
| plain character | 42.6 / 53.5 / 41.0 | 33.5 / 34.9 / 32.6 | |
| **Enter** | 61.3 / 68.4 / 60.3 | 44.3 / 43.5 / 41.8 | **18.7ms → 10.0ms** |

Every "after" run sits below every "before" run for both keys, which is the
bar this codebase asks for. Roughly a fifth off an ordinary keypress, a
third off Enter, and the Enter-specific penalty -- the thing this document
set out to remove -- nearly halved.

**Interleave, always.** A single before-run and a single after-run taken
minutes apart on this hardware differ by up to 40% for reasons that have
nothing to do with the code. A non-interleaved comparison during this
session showed a convincing 23% "improvement" from a change whose real
effect was below the noise floor. Alternate the two trees within one
command and require no overlap between the groups.

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

## The pipeline as it was (session 2), and what remains

> **Superseded in part.** Steps 2, 4 and 5 below no longer happen -- see
> "What shipped" near the end of this document. The description is kept
> because steps 1, 3 and 6 are unchanged and the reasoning still explains
> why the contract mattered.

Verified by reading, in session 2. Line numbers drift — find by name.

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

## The shape of the fix (the output half is done)

> The output-contract change described here shipped in session 3. The input
> half -- giving transforms something smaller than the whole document to read
> -- has not, and the paragraph on it below is still the plan.

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

## Answers to the questions above (session 2, verified by reading + profiling)

The previous session left six questions. All six are answered below. Read the
answers before the implementation sections above — two of them change what the
first implementation step should be.

### Q1 — What is the minimum input each of the five transforms needs?

Audited all five by reading their bodies. **None of them needs the whole
document.** Every one is a contiguous single-range edit whose inputs are
caret-local:

| transform | what it actually reads | whole-document work it currently does |
| --- | --- | --- |
| `onEnterTransform` | `inline.inFencedCodeBlock`, `line.lineText`, `line.lineStart`, `line.lineEndExclusive` (4 fields, as established) | `normalizeInternalText`, `countLineIndex`, `computeInlineStateAtOffset`, `nextText` concat, prefix/suffix rediscovery |
| `onTabIndentTransform` | `.line` only — `headingLevel`, `lineText`, `lineStart`, `lineEndExclusive`. **The whole `inline` object and `lineIndex` are computed and discarded.** `indentSelectionByStep` itself is O(selected block): it slices `[lineStart, lineEndExclusive)`, transforms those lines, and concatenates | same as Enter |
| `onMarkdownShortcutTransform` | all four builders (`buildTextDecorationTransform`, `…ToggleCurrentLineHeading…`, `…ToggleBulletedList…`, `…ToggleNumberedList…`) locate their own line/word bounds with `lastIndexOf('\n')` / `indexOf('\n')` and operate on `sourceText.slice(lineStart, lineEndExclusive)` | `normalizeInternalText` + `nextText` concat + prefix/suffix rediscovery |
| `onCharacterInsertTransform` | `charCodeAt` around the caret, then an O(line) prefix regex. Already minimal | `normalizeInternalText` — see Q3, this is the worst one |
| `onCaretClickTransform` | `charCodeAt(caret±1)`, then `lastIndexOf('\n')` + an O(line) regex. Already minimal | `normalizeInternalText` |

So the plan's claim that `onCharacterInsertTransform` "is already built the way
this document argues for" is true of the *policy* and false of the *binding*
that wraps it: `useEditorSectionMount.ts` runs `normalizeInternalText(text)`
over the full document **before** calling the cheap policy that returns `null`
in the ordinary case.

### Q2 — Can `inFencedCodeBlock` come from an incremental cache, cheaply and correctly?

Correctly: yes, and the argument is already made and fuzz-tested —
`updateInlineStateLineCacheIncremental`'s doc comment handles exactly the
forward-unbounded hazard the question worried about, by scanning forward from
the edit until a line's entering state matches its pre-edit state, degrading to
a full recompute when it never restabilizes. `MarkdownContext.test.ts` fuzzes it
against the O(document) ground truth. That is the standard this codebase asks
for and it has already been met.

**Cheaply: no — not as currently written, and this matters.** The plan proposed
simply wiring the Enter path to `resolveMarkdownSelectionContextIncremental`
because "the fast path was simply never wired to the hot caller". That would
help less than it looks:

* `updateInlineStateLineCacheIncremental` starts with `text.split('\n')` on the
  whole document — for the 1.5M-char realistic fixture that is ~30k substring
  allocations, **every call**.
* It then runs `computeCommonLinePrefixSuffixLen`, an O(lines) walk doing real
  string comparisons (the new array's strings are freshly allocated, so
  identity comparison never short-circuits).

It is asymptotically O(document) too — just with a smaller constant than
`scanInlineStateFrom`. The profile bears this out: with the toolbar already
driving it every keystroke, `updateInlineStateLineCacheIncremental` costs
38.6ms self-time per 10-keystroke run, versus `countLineIndex`'s 28.4ms.
Wiring Enter to it as-is would trade one O(document) pass for another.

The structurally right answer is that the cache should be fed **the edit**
(`{from, to, insert}`), not two full document strings to diff — which is the
same conclusion the output-contract change reaches from the other direction.
Keep the stabilization argument; replace the line-diff front end.

### Q3 — Is `normalizeInternalText(event.text)` on the transform path load bearing?

**No — and it is worse than waste: where it would do anything, it is a
correctness bug.**

The argument is structural, not empirical. `event.selection` holds offsets into
the *CM6 document*. `normalizeInternalText` collapses `\r\n` → `\n` and expands
`\t` → three spaces. If it changes anything *before* the caret, every offset in
`event.selection` is stale with respect to `sourceText`, so the transform reads
the wrong line and returns an edit at the wrong place — and the whole-document
`nextText` it returns then silently rewrites the note. So the call is only ever
*correct* in precisely the case where it is a *no-op*.

Ingress is in fact canonical by construction: paste goes through
`sanitizeDocumentText`/`sanitizeDocumentTextExtended`, whose
`normalizeLineSeparators` + tab expansion are a superset of
`normalizeInternalText`; Tab keypresses are intercepted and inserted as spaces;
ordinary typing cannot produce `\r`. The one ingress worth checking before
deleting the calls is **CM6's default drop handler** (no `drop:` override exists
in `CM6Editor.tsx`) and external-file note hydration.

The fix is therefore not "keep normalizing defensively" — that hides the bug
rather than preventing it. Normalize at *ingress* (drop handler, external-file
read), then delete the per-keystroke calls.

Cost of the calls today: 25.1ms self-time per 10-keystroke run, on **every
printable character**, in a path that discards the result.

### Q4 — Do Tab / markdown-shortcut edits need more than one `{from, to, insert}` range?

**No. One range expresses all of them.** Every multi-line case
(`indentSelectionByStep`, the two list toggles) already computes a single
contiguous block `[lineStart, lineEndExclusive)`, transforms the lines inside
it, and joins. The natural range is `{from: lineStart, to: lineEndExclusive,
insert: nextBlock}` — the block string these functions already build. No
multi-range shape is needed.

### Q5 — What is the ~14ms floor made of?

Not attributed yet; a small note's cost was not profiled this session. But the
profile of the *large* note answers the more urgent question, and it is not the
one the plan expected — see the new section below.

### Q6 — Which orphaned lines can be deleted?

Not yet actioned. Consumer lists re-verified as still accurate.

## What the profile actually shows (new, and it changes the priorities)

Measured this session, `--shape=realistic --chars=1500000 --keystrokes=10
--position=middle --gap=500`, with `--profile --stacks`. This machine is ~1.7x
slower than the one the table at the top of this document was measured on, so
compare *ratios*, not absolutes:

| key | handler median | (prior machine) |
| --- | --- | --- |
| plain character | 59.1ms | 31.3ms |
| **Enter** | **72.8ms** | **43.8ms** |
| Backspace | 64.1ms | 34.0ms |

The ~13ms Enter penalty reproduces. But the self-time breakdown shows the Enter
transform pipeline is **not** where most of the per-keystroke document-scale
cost lives.

**First, discount the instrument.** The profile is taken against `dev:browser`,
whose mock bridge does work the real Electron app does not do on the keystroke
thread. Verified by reading, not assumed:

* `persistStore` (148ms), `clone` (101ms), `setItem` (165ms), `deriveTitle`
  (25ms) — `installBrowserMockBridges.ts` only. The mock re-clones and
  re-serializes the entire note store to `localStorage`. No real counterpart.
* `extractChecklistCheckedStates` (99ms) — reached only via
  `checklistStateChanged`, whose sole real caller is
  `electron/noteLifecycleService.ts`, i.e. the **main process, on save**. In the
  real app this is off the renderer's keystroke path entirely.

**What is left is real renderer work, and most of it is not the Enter
transform.** Self-time per 10-keystroke run:

| function | self | on the transform path? |
| --- | --- | --- |
| `noteHasTableOfContents` @ `useMarkdownFormattingToolbar.ts` | 92.1ms | **no** |
| `computeMinimalTextReplacement` @ `MinimalTextDiff.ts` | 73.5ms | no |
| `deriveNoteTitleIncremental` @ `noteTitle.ts` | 70.8ms | no |
| `invalidatePreviewVirtualizerMeasurementsAfterIndex` | 66.7ms | no |
| `usePreviewMarkdownRendering.tsx:1200` | 63.5ms | no |
| `scanInlineStateFrom` @ `MarkdownContext.ts` | 62.4ms | partly |
| `normalizeForComparison` @ `useNoteSnapshots.ts` | 61.0ms | no |
| `runPassiveSync` @ `CM6Editor.tsx` | 55.7ms | no |
| `commonSuffixLen` + `commonPrefixLen` @ `CM6Editor.tsx` | 85.4ms | **yes** |
| `updateInlineStateLineCacheIncremental` | 38.6ms | partly |
| `countLineIndex` | 28.4ms | **yes** |
| `normalizeInternalText` | 25.1ms | **yes** |

The single clearest example, and it is not in this document's original scope:
`isTableOfContentsActive` is a `useMemo` keyed on `currentEditorText`, so on
**every keystroke** it runs `normalizeInternalText` over the whole document,
`split('\n')` it, and regex-tests every line — to decide whether one toolbar
button renders as active. Nobody can observe that boolean change mid-keystroke.

So the pipeline splits into two tiers, and the plan above only names the first:

1. **The Enter/transform pipeline** (~140ms of the sampled window):
   `commonPrefixLen`/`commonSuffixLen`, `countLineIndex`, `normalizeInternalText`.
   This is what the output-contract change removes. Real, and it is the Enter
   penalty specifically.
2. **Everything else that walks the document on every keystroke** (~480ms of
   the sampled window): the TOC memo, title derivation, the minimal-diff sync
   effect, snapshot normalization, preview virtualizer invalidation. These fire
   for **every key**, not just Enter, and they are what the plain-character
   floor is made of.

Tier 2 is the larger number and, per-item, the easier work — most of it is a
`useMemo`/effect keyed on the whole text that should be keyed on the edit, or
deferred off the keystroke. Tier 1 is the more structural change and is what
makes Enter cost more than a letter.

**Neither supersedes the other, and the ordering is a real choice.** Tier 1 is
this document's thesis and fixes the contract that makes the cost recur; tier 2
is where the milliseconds currently are. The honest sequencing argument is that
tier 1 first is still right — the transform contract is the thing that will
otherwise keep regenerating these costs — but tier 2 should not be left
undocumented as it was, because a session that only does tier 1 will measure a
disappointing total and may wrongly conclude the thesis was wrong.

### The cheapest correct first move

Independent of that ordering: delete `normalizeInternalText(text)` from the
four transform bindings in `useEditorSectionMount.ts`, after normalizing at
ingress instead (Q3). It removes a full-document regex pass from **every
printable keystroke**, it is a latent correctness fix rather than a tradeoff,
and it is small enough to A/B cleanly.

---

# What shipped (session 3)

Four changes, each A/B'd, each with the removed work verified as gone from
the CDP profile rather than inferred from an end-to-end number.

**1. Canonical text is now a document invariant, not a per-keystroke rescan.**
`CanonicalTextFilter.ts` is a CM6 transaction filter that scans each
*inserted fragment* and normalizes only when it has to — cost proportional
to what was typed or dropped, never to the document. Every transform's
`normalizeInternalText(text)` over the whole note is gone. That call was not
merely wasted: a transform is handed `selection` in document coordinates, so
if normalization had ever changed anything before the caret, every offset
would have been stale against the string the transform then read. It was
only correct in exactly the case where it was a no-op. (The old
`EnterTransformPolicy` test "normalizes tabs before applying enter
continuation semantics" was that bug written down as an expectation.)

**2. The transform contract carries the edit.** `EditorTransformResult` now
has `edit: {from, to, insert}` alongside `text`, and `buildTransformResult`
*derives* the text from the edit so the two cannot drift.
`applyTransformResult` dispatches the range instead of rediscovering it with
a common-prefix/common-suffix diff of two 1.5M-character strings.

**3. CM6's React→CM6 sync effect reads `previousTextRef`** instead of
rebuilding the document with `doc.toJSON().join('\n')` every keystroke.
Bonus: the equality check becomes O(1) on identity, because during typing
`initialText` *is* the string the updateListener handed to React.

**4. `noteHasTableOfContents` got a necessary-condition guard.** It rescanned
the whole note on every keystroke to style one toolbar button. Both heading
forms it recognizes contain the literal `Table of Contents`, so one
allocation-free substring scan rules out every note without one.

Verified gone from the profile (self-time per 10-keystroke Enter run):
`normalizeInternalText` 25.1ms, `commonPrefixLen` + `commonSuffixLen`
73.2ms, `noteHasTableOfContents` 63.2ms.

New tests: `CanonicalTextFilter.test.ts` (22, including a 400-step fuzz that
the document stays canonical after every edit) and `TransformResult.test.ts`
(7). The second one guards the *performance* property, which nothing else
does: a transform reporting `{from: 0, to: length, insert: wholeNewText}`
would satisfy every text-level assertion in the suite while silently
restoring the whole-document cost. Both A/B'd by disabling the code under
test and confirming the tests fail.

# The systemic pattern (this is the next structural step)

The transform contract was one instance of a defect this codebase has in at
least four places. In each, the app **knows the edit**, throws it away at an
interface boundary, and then spends O(document) rediscovering it — or never
had it and pays O(document) for want of it:

| consumer | what it does per keystroke | what it needs |
| --- | --- | --- |
| `trackWordCount` (`WordCount.ts`, via `EditorSection.tsx`) | `computeMinimalTextReplacement(oldText, newText)` — a full prefix/suffix diff — then does genuinely O(edit) work | the edit |
| `deriveNoteTitleIncremental` (`noteTitle.ts`) | `text.split('\n')` on the whole document, then O(edit) work | the edit |
| `updateInlineStateLineCacheIncremental` (`MarkdownContext.ts`) | `text.split('\n')` plus an O(lines) string-comparison diff, then O(edit) work | the edit |
| `canonicalizeParagraphSegmentsIncremental` (`TextPolicy.ts`) | per-segment prefix/suffix reuse over the whole segment array | the edit |

Every one of these is *already* labelled "incremental" and has a careful doc
comment and a fuzz test. The per-line work genuinely was removed. What
remains is an **O(document) front end whose entire job is to reconstruct the
edit** — the same thing `applyTransformResult` was doing, for the same
reason. A past optimization being real is not evidence it went far enough.

Their combined self-time in the current profile is roughly 150ms per
10-keystroke run, and unlike the Enter penalty it is paid on **every key**.

**The shape of the fix.** These consumers should be fed the edit, not two
documents to diff. The producer side now exists on the transform path
(`EditorTransformResult.edit`) and has always existed on the CM6 side
(`update.changes`, a `ChangeSet`). What is missing is a single edit-carrying
channel from the editor to app-state consumers — `onTextChange` currently
hands over `{text, selection}` and nothing about what changed.

The obvious shared primitive underneath is a **line index maintained by
splicing rather than re-splitting**: `lines: string[]` plus
`lineStartOffsets`, updated per edit in O(changed lines) plus an O(lines)
pointer memmove, instead of ~30k fresh substring allocations per keystroke.
Three of the four consumers above start by splitting the document into
exactly this, independently, every keystroke.

Design it once, deliberately, with the whole consumer list in view — the
mistake to avoid is bolting an edit parameter onto each of the four in turn
and ending up with four private incremental line indexes instead of one.

# Still open

* **The input half of the transform contract.** Enter still calls
  `resolveMarkdownSelectionContext`, which computes `countLineIndex`
  (discarded entirely — ~20ms/10 keystrokes) and a full
  `computeInlineStateAtOffset` scan (~45ms) to extract one boolean,
  `inFencedCodeBlock`. Q1 and Q2 above say what it actually needs and why
  wiring it to the existing incremental variant as-is would not help. The
  fence state is the only genuinely document-wide input any transform has,
  and it wants the same edit-driven treatment as the table above.
* **Q5 — the small-note floor.** Still unattributed. Now the more
  interesting question: with the document-scale costs coming down, what a
  keystroke costs when there is nothing to be proportional *to* is the next
  ceiling.
* **Q6 — the 1,319 orphaned lines.** Untouched; consumer lists re-verified
  as still accurate.
* **The remaining tier-2 items** not covered by the table above:
  `invalidatePreviewVirtualizerMeasurementsAfterIndex` (~50ms),
  `usePreviewMarkdownRendering.tsx:1200` (~49ms), `runPassiveSync` (~59ms),
  `normalizeForComparison` in `useNoteSnapshots` (~36ms). None audited yet.
