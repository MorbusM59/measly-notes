// The confirmation twitch: a completed hold gesture, said in the cursor.
//
// A hold that fires while the button is still down has no natural
// acknowledgement -- nothing clicks, nothing releases, and the thing it did
// may be off-screen or purely internal (a purge armed, a tab pinned, a
// scrollbar snapped). The custom cursor is already deforming under the press,
// so it is the one surface every such gesture shares, and a brief excursion
// AGAINST the deformation reads as "that landed" without competing with the
// press itself.
//
// This module is only the wire. It carries no polarity, no strength and no
// timing: `MouseCursorOverlay` derives the direction from which way the press
// is currently deforming the orbit, and the shape from the user's own cursor
// settings. A caller that had to name its polarity would be a caller that can
// get it wrong -- and would have to know that a left press contracts, which
// is a fact about the cursor, not about the gesture.
//
// Emitting when no custom cursor is mounted, or when nothing is pressed, is a
// no-op by construction rather than by a check at the call site.

type CursorTwitchListener = () => void

const listeners = new Set<CursorTwitchListener>()

/**
 * Announces that a held gesture just completed. Called from ONE place --
 * `shared/holdTiming.ts`'s `armHold` -- for every hold that runs on a timer,
 * so a new hold gesture is acknowledged without its author knowing this
 * module exists. The rAF-driven holds (`editor/useHoldToBranch.ts`) call it
 * themselves, because they do not use a timer.
 */
export function emitCursorTwitch(): void {
  for (const listener of listeners) listener()
}

/** Subscribes the mounted cursor overlay. Returns its own unsubscribe. */
export function subscribeCursorTwitch(listener: CursorTwitchListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
