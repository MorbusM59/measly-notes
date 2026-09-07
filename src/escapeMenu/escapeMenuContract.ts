// The seam between the escape-hold quick-actions ring (EscapeHoldPanel.tsx)
// and any feature that wants to *live inside* it rather than merely add a
// button to it.
//
// The ring already had one job: show whichever of a fixed set of note
// actions are currently available, run one, and close. That model has no
// room for a feature that takes the ring over for a while and keeps taking
// input -- the adventure game (src/adventure) is the first, but nothing in
// this file knows about it, and nothing about it is game-shaped. A future
// note-picker, a confirm/cancel prompt, or a multi-step wizard would all
// use the same two hooks below without the panel gaining a second special
// case.
//
// Two directions, deliberately separate:
//   - `entryCells` are added to the ordinary quick-actions ring. This is
//     how a feature becomes reachable at all. They are already filtered for
//     availability by whoever supplies them -- the ring's own rule is that
//     an unavailable action drops out entirely rather than rendering
//     disabled, so there is no `disabled` flag here on purpose.
//   - `activeMode`, when non-null, REPLACES the ring wholesale: its cells
//     are the only cells, and its prompt is what the ring's centre reads.
//     The panel contributes nothing of its own while a mode is up, so a
//     mode never has to fight the built-in actions for slots.
//
// Neither direction gives the supplier any control over the ring's
// geometry, animation, focus model, or close behaviour. Those stay the
// panel's own, which is what keeps a mode from having to reimplement the
// dial to be usable.

export interface EscapeMenuCell {
  /**
   * Stable across renders for as long as this cell means the same thing.
   * Used as the React key, so a cell that keeps its id keeps its DOM node
   * (and therefore its focus) when the surrounding set is rebuilt.
   */
  id: string
  /** Shown in the ring's centre while this cell is focused or hovered. */
  label: string
  /** A Font Awesome class string, e.g. `fa-solid fa-fire`. */
  icon: string
  /**
   * Whether activating this cell leaves the menu up. The ring's default is
   * to close on activation -- a quick action does its thing and gets out of
   * the way. A cell that opens or advances a mode sets this, because the
   * whole point of a mode is that the next input also happens here. Note
   * that this is about the MENU, not the mode: a mode's own "leave" cell
   * leaves this false so that quitting closes the ring in one press.
   */
  keepsMenuOpen?: boolean
  onSelect: () => void | Promise<void>
}

export interface EscapeMenuMode {
  /** Identifies the feature holding the ring; distinct modes never merge. */
  id: string
  /**
   * Changes exactly when the ring now represents a NEW decision -- a new
   * step, a new prompt, a new set of cells. The panel resets its dial to
   * the top and cancels any in-flight rotation when this changes, so each
   * step starts from a predictable position instead of wherever the
   * previous step's dial happened to be left. Holding it steady across a
   * re-render that did not change the decision (a stat ticking, a label
   * being recomputed) leaves the dial alone, which is what makes it safe to
   * rebuild the mode object on every render.
   */
  stepKey: string
  /**
   * The standing text in the ring's centre -- the question being asked.
   * Kept short: the centre is a small circle, and a cell's own label is
   * shown alongside it when one is focused or hovered.
   */
  prompt: string
  /**
   * A secondary status line under the prompt -- a mode's running state (a
   * score, a resource, a step counter), not a second sentence. Optional,
   * and rendered smaller and dimmer than the prompt, because the centre is
   * a small circle and the prompt is what has to stay readable in it.
   */
  detail?: string
  /** The only cells shown while this mode is up. */
  cells: EscapeMenuCell[]
}

export interface EscapeMenuContribution {
  entryCells: EscapeMenuCell[]
  activeMode: EscapeMenuMode | null
}

/**
 * The "nothing to contribute" value. A shared frozen constant rather than a
 * fresh `{ entryCells: [], activeMode: null }` per render, so a consumer
 * that memoizes on identity is not defeated by the idle case.
 */
export const EMPTY_ESCAPE_MENU_CONTRIBUTION: EscapeMenuContribution = Object.freeze({
  entryCells: Object.freeze([]) as unknown as EscapeMenuCell[],
  activeMode: null,
})
