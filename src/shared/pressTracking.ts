// What "pressed" means, decided by the app rather than inferred by the
// browser from pointer history.
//
// ## The bug this exists because of
//
// Chromium sets `:active` on a mousedown of ANY button but only clears it on
// the release of the PRIMARY one. So a right-click on any button in the app
// left it looking held down -- indefinitely, until the pointer happened to
// move and the browser re-evaluated. Measured in the real app: four seconds
// after the release, `el.matches(':active')` was still true and the computed
// background was still `--btn-bg-pressed`.
//
// It is invisible to the usual ways of looking. `:active` is a pseudo-class,
// so nothing is added to the DOM and an Elements-panel watch shows no
// mutation; and reaching for the console or the inspector moves the mouse,
// which is the exact gesture that clears it. It also could not be reproduced
// with synthetic events: Chromium's CDP path does not set the active chain
// for a secondary button at all, so a headless probe sees nothing happen.
//
// ## Why this rather than a nudge on release
//
// The app has real right-click semantics nearly everywhere -- rename, close,
// archive, the adventure. A secondary press is a DIFFERENT GESTURE here, and
// it should never read as an activation of the control it lands on. Trying to
// un-stick the browser's state after the fact would be treating the symptom;
// what is actually wrong is that the styling asked the browser to infer a
// gesture it does not model the way this app means it.
//
// So the app says it instead. `:active` appears nowhere in the stylesheets:
// with nothing selecting on it, Chromium's stuck state has nothing to style,
// which is why this fix is sound by construction rather than by timing.
//
// This is the same move `EscapeHoldPanel.tsx` made for hover, for the same
// underlying reason -- the browser's pointer-state inference does not survive
// the things this app does with pointers -- and the two now read alike:
// hover and pressed are both state we own.
//
// ## The chain, and why only part of it
//
// `:active` applies to the whole ancestor chain, not just the element under
// the pointer, and the stylesheets rely on that (a pill's inner `<span>` is
// usually what a press actually lands on). So this walks the chain too --
// but it only WRITES to the elements a `[data-pressed]` rule could match.
//
// Marking the whole chain was the first version and it was measurably wrong:
// a press in the editor marked 20 elements, none of which any rule could
// style, and a mark-and-clear with the style recalc it forces costs ~0.9ms
// on a 14-deep chain in an almost empty document. A click can afford that.
// The keyboard path could not -- every SPACE typed in the editor was paying
// it, on the keydown path this project has a whole optimization plan about.
//
// WHICH elements those are is read out of the stylesheets rather than
// written down here. A hand-maintained list of "things that can look
// pressed" is precisely the shape of the drift this codebase keeps being
// bitten by (see CLAUDE.md on sanitizeMenu): add a `[data-pressed]` rule for
// a new control, forget the list, and the control silently never looks
// pressed. Derived from the CSS, that cannot happen.

/**
 * An ATTRIBUTE, not a class, and that is not cosmetic.
 *
 * React rewrites `className` whenever a component's own class list changes,
 * and it has no idea about a class added from outside its render -- so a
 * press that causes a re-render (pressing a toggle, most obviously) wiped
 * the mark mid-gesture and the control stopped looking held. Caught by the
 * keyboard-activation check, where Enter on a toggle re-rendered it in the
 * same tick. React never writes `data-pressed` on these elements, so it
 * survives.
 *
 * Attribute selectors carry the same specificity as a class, so every rule
 * that used `:active` keeps the weight it had.
 */
export const PRESSED_ATTRIBUTE = 'data-pressed'

/** Keys that activate a focused control, and so should look like a press. */
const ACTIVATION_KEYS = new Set([' ', 'Spacebar', 'Enter'])

/**
 * Every element a `[data-pressed]` rule could match, as one selector read
 * out of the stylesheets. Computed once, lazily, on the first press.
 *
 * The fallback when the sheets cannot be read (a cross-origin sheet throws
 * on `.cssRules`) is the ancestor chain unfiltered -- correct but wasteful,
 * which is the right way round for a fallback.
 *
 * In dev, a hot stylesheet reload after this has been computed leaves it
 * stale until the next full reload. That is a dev-only staleness in a value
 * that only ever narrows work, so the worst case is a control that misses
 * its pressed look until you reload -- never a wrong one.
 */
let pressableSelector: string | null | undefined
function resolvePressableSelector(): string | null {
  if (pressableSelector !== undefined) return pressableSelector

  const subjects = new Set<string>()
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule) || !rule.selectorText.includes(`[${PRESSED_ATTRIBUTE}]`)) continue
      for (const part of rule.selectorText.split(',')) {
        const subject = part.trim().replace(`[${PRESSED_ATTRIBUTE}]`, '').replace(/::[\w-]+$/, '').trim()
        if (subject.length > 0) subjects.add(subject)
      }
    }
  }

  pressableSelector = subjects.size > 0 ? Array.from(subjects).join(',') : null
  return pressableSelector
}

/** Elements currently marked, so ending a press never has to search the document. */
let marked: Element[] = []

function clearAll(): void {
  for (const node of marked) node.removeAttribute(PRESSED_ATTRIBUTE)
  marked = []
}

function markChain(from: EventTarget | null): void {
  // Always before marking, never only on release: a second button pressed
  // while the first is held would otherwise strand the first press's marks.
  clearAll()

  const selector = resolvePressableSelector()
  let node = from instanceof Element ? from : null
  while (node) {
    if (selector === null || node.matches(selector)) {
      node.setAttribute(PRESSED_ATTRIBUTE, '')
      marked.push(node)
    }
    node = node.parentElement
  }
}

/** Typing a space in a text field is not activating a control. */
function isTextEntry(node: Element | null): boolean {
  if (!node) return true
  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) return true
  return node instanceof HTMLElement && node.isContentEditable
}

/**
 * Installs the tracking. Idempotent, and never removed: it is a property of
 * the document for the app's whole life, not something a component owns.
 *
 * A press can end in more ways than it can begin -- a release anywhere, a
 * drag starting, the window losing focus, the pointer being cancelled -- so
 * every one of those clears. Clearing works from a remembered list rather
 * than a document-wide query: the query was a full tree walk on every
 * mouseup, and a list cannot strand anything as long as marking clears
 * first, which it does.
 */
let installed = false
export function installPressTracking(): void {
  if (installed) return
  installed = true

  window.addEventListener('mousedown', (event) => {
    // The PRIMARY button only. This one line is the whole fix: a secondary
    // press is a different gesture and never looks like an activation.
    if (event.button !== 0) return
    markChain(event.target)
  }, { capture: true })

  for (const endEvent of ['mouseup', 'dragstart', 'pointercancel'] as const) {
    window.addEventListener(endEvent, clearAll, { capture: true })
  }
  // The WINDOW losing focus, and nothing else. Deliberately not in the
  // capture list above: `blur` does not bubble, but a capturing listener on
  // window still sees every descendant's blur -- including the focus shift
  // the press itself causes when it lands on a button while a text field is
  // focused, which cleared the mark in the same tick it was set.
  window.addEventListener('blur', clearAll)

  // Keyboard activation reads as a press too -- `:active` covered that, so
  // dropping it would have traded one gap for another.
  window.addEventListener('keydown', (event) => {
    if (event.repeat || !ACTIVATION_KEYS.has(event.key)) return
    if (isTextEntry(document.activeElement)) return
    markChain(document.activeElement)
  }, { capture: true })
  window.addEventListener('keyup', (event) => {
    if (!ACTIVATION_KEYS.has(event.key)) return
    clearAll()
  }, { capture: true })
}
