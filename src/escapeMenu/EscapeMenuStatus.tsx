import type { EscapeMenuModeStatus } from './escapeMenuContract'

/**
 * A mode's two output channels, and WHICH BAR each one lands on.
 *
 * The split is a design rule, not a layout convenience (see the adventure's
 * design document): the tab bar above the editor carries STATE -- what you
 * are and what you have -- and the chapter bar below it carries NARRATION --
 * what just happened, and the frame for what is being asked. A reader's eye
 * goes up for "how am I doing" and down for "what is going on", the same way
 * it does for a note's tabs and its chapters.
 *
 * Both are built out of the elements the bar they land on already uses,
 * rather than a look of their own, so each sits at exactly that bar's height
 * and inset with no parallel geometry to keep in sync (pillbars.css's whole
 * reason for existing) -- and so a mode reads as something this app is
 * showing you rather than a guest with its own furniture.
 *
 * Nothing here is interactive: every gesture a mode has belongs in the ring.
 */

/** State, on the TAB BAR, in the strip a note's tabs would occupy. */
export function EscapeMenuReadouts({ status }: { status: EscapeMenuModeStatus }) {
  if (status.readouts.length === 0) return null
  return (
    <div
      className="escape-menu-readouts"
      role="status"
      aria-live="polite"
      aria-label={`${status.title} state`}
    >
      {status.readouts.map((readout) => (
        <div key={readout.key} className="tag-pill escape-menu-readout">
          <span className="tag-pill-label">{readout.label}</span>
          <span className="escape-menu-readout-value">{readout.value}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Narration, on the CHAPTER BAR, which is otherwise empty while a mode owns
 * the slot (there is no note, so there are no chapters and no tags).
 *
 * `subject` leads it -- which instance of the mode this is -- and the
 * headline follows, as a sentence rather than a pill: it is prose, and
 * putting prose in a pill would make it look like something to press.
 */
export function EscapeMenuNarration({ status }: { status: EscapeMenuModeStatus }) {
  if (!status.headline && !status.subject) return null
  return (
    <div className="chapter-bar-row">
      <div
        className="chapter-tab-mode-shell escape-menu-narration-shell"
        role="status"
        aria-live="polite"
        aria-label={`${status.title} narration`}
      >
        {status.subject ? <span className="escape-menu-status-subject">{status.subject}</span> : null}
        {status.headline ? <span className="escape-menu-narration">{status.headline}</span> : null}
      </div>
    </div>
  )
}
