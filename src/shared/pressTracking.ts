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
// ## The chain
//
// `:active` applies to the whole ancestor chain, not just the element under
// the pointer, and the stylesheets rely on that (`.tag-pill.suggested`,
// `.note-tab-pill` and `button` are frequently different nodes in one press).
// So this marks the target and every ancestor, which is what makes swapping
// `:active` for `[data-pressed]` a mechanical substitution with no selector
// rewritten.

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

function markChain(from: EventTarget | null): void {
  let node = from instanceof Element ? from : null
  while (node) {
    node.setAttribute(PRESSED_ATTRIBUTE, '')
    node = node.parentElement
  }
}

function clearAll(): void {
  for (const node of document.querySelectorAll(`[${PRESSED_ATTRIBUTE}]`)) {
    node.removeAttribute(PRESSED_ATTRIBUTE)
  }
}

/**
 * Installs the tracking. Idempotent, and never removed: it is a property of
 * the document for the app's whole life, not something a component owns.
 *
 * Clearing sweeps the document rather than remembering what was marked --
 * a press can end in more ways than it can begin (a release anywhere, a
 * drag starting, the window losing focus, the pointer being cancelled), and
 * a sweep cannot leave a straggler behind the way a remembered list can.
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
    markChain(document.activeElement)
  }, { capture: true })
  window.addEventListener('keyup', (event) => {
    if (!ACTIVATION_KEYS.has(event.key)) return
    clearAll()
  }, { capture: true })
}
