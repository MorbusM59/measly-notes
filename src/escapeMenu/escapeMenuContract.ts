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

export interface EscapeMenuReadout {
  /** Stable identity for React keys. */
  key: string
  /** Short name, e.g. a stat's abbreviation. */
  label: string
  /** Its current value, already formatted. */
  value: string
}

/**
 * What a mode needs to show that will NOT fit in the ring. The ring's own
 * centre is a small circle whose entire job is naming the cell you are
 * about to activate -- it says what one press does, and nothing else. A
 * mode that tries to narrate through it makes the one label a player
 * actually needs harder to read, so a mode does not get to: it hands its
 * standing state here instead, and the host renders it in the space the
 * editor already has for exactly this -- the tab bar above and the
 * chapter/tag bar below, which are wide, already legible, and already the
 * place a reader looks for "what am I looking at" and "what is its state".
 *
 * Present whenever the mode is, INCLUDING while the menu is down: a mode
 * that owns an editor slot keeps describing itself there whether or not
 * the ring happens to be raised over it.
 */
export interface EscapeMenuModeStatus {
  /**
   * What KIND of thing this slot is showing, for the tab bar's identity
   * pill, where a collection's name would otherwise be ("User Guide" is the
   * existing precedent). That pill is a fixed 120px and clips, so this is a
   * short label -- roughly twelve characters -- not a name.
   */
  title: string
  /** The one line that says where you are -- shown across the tab strip. */
  headline: string
  /**
   * WHICH one, when the mode has instances worth naming: a story's title, a
   * document's name. Shown as the leading label of the status bar below,
   * where there is room for it. Omit when the mode is a single thing and
   * `title` has already said everything.
   */
  subject?: string
  /** Running state, as pills on the chapter/tag bar. Keep it to a handful. */
  readouts: EscapeMenuReadout[]
}

export interface EscapeMenuMode {
  /** Identifies the feature holding the ring; distinct modes never merge. */
  id: string
  /**
   * Changes exactly when the ring now represents a NEW decision -- a new
   * step, a new set of cells. The panel resets its dial to the top and
   * cancels any in-flight rotation when this changes, so each step starts
   * from a predictable position instead of wherever the previous step's
   * dial happened to be left. Holding it steady across a re-render that did
   * not change the decision leaves the dial alone, which is what makes it
   * safe to rebuild the mode object on every render.
   */
  stepKey: string
  /** The only cells shown while this mode is up. */
  cells: EscapeMenuCell[]
  /** Everything that does not belong in the ring -- see above. */
  status?: EscapeMenuModeStatus
}

export interface EscapeMenuContribution {
  /**
   * Cells added to the ordinary quick-actions ring. Nothing supplies these
   * today -- the one mode that exists is reached from a window control
   * instead -- but they are the other half of the seam and cost one line in
   * the panel: a feature that is LAUNCHED from the ring rather than living
   * inside it belongs here, and would otherwise have to be special-cased
   * into the panel's own cell list the way the built-in actions are.
   */
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
