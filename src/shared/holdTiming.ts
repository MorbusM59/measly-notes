// How long a hold has to last, and what happens when it does.
//
// Every press-and-hold gesture in the app used to carry its own threshold,
// each chosen on its own day: 200, 200, 250, 300, 500, 550, 700, 1000. None
// of those numbers disagreed with each other on purpose, and holding two
// controls that mean the same kind of thing should not feel different.
//
// There are two kinds, and only two:
//
// - CONFIRM -- "I meant this one, not the one next to it." Arming a purge,
//   splitting a chapter pill, snapping a scrollbar instead of travelling,
//   copying a colour. Long enough that an ordinary click cannot reach it,
//   short enough that it never feels like waiting.
// - COMMIT -- "I know this is not undoable." Pinning, branching, merging,
//   purging a song from the library. Long enough that the pause itself is
//   the warning.
//
// A third number would mean a third kind, and there is not one. If a gesture
// seems to want its own, the question to answer first is which of these two
// it actually is.

import { emitCursorTwitch } from './cursorTwitch'

/** A deliberate press: past this, it was not an ordinary click. */
export const HOLD_CONFIRM_MS = 250

/** An irreversible press: the wait is the confirmation. */
export const HOLD_COMMIT_MS = 550

/**
 * Arms a hold, returning the function that abandons it.
 *
 * A drop-in for the `window.setTimeout` every one of these gestures was
 * already doing, with two things folded in that were previously each site's
 * own business: the threshold comes from the two constants above, and the
 * completion announces itself to the custom cursor (`shared/cursorTwitch.ts`)
 * so the reader sees that the hold landed.
 *
 * That second part is why this exists rather than a bare constant. Wiring the
 * twitch at each of the nine call sites would make "and tell the cursor" a
 * thing to remember, which is the failure this codebase keeps repeating; here
 * a gesture cannot complete without it.
 *
 * The twitch goes first, and deliberately: it acknowledges the GESTURE, which
 * happened whatever the action then does or throws.
 */
export function armHold(onComplete: () => void, holdMs: number = HOLD_CONFIRM_MS): () => void {
  const timerId = window.setTimeout(() => {
    emitCursorTwitch()
    onComplete()
  }, holdMs)
  return () => { window.clearTimeout(timerId) }
}
