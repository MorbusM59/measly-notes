import type { EscapeMenuModeStatus } from './escapeMenuContract'

/**
 * A mode's running state, rendered on the chapter/tag bar below the editor
 * -- the bar that already exists for "what is the state of the thing you
 * are looking at", and which is otherwise empty while a mode owns the slot
 * (there is no note, so there are no chapters and no tags).
 *
 * Deliberately built out of the same elements the chapter bar itself uses
 * -- `.chapter-bar-row` around a `.chapter-tab-mode-shell` well of
 * `.tag-pill`s -- rather than a look of its own, so it lands at exactly the
 * bar's height and inset with no parallel geometry to keep in sync
 * (pillbars.css's whole reason for existing), and so a mode reads as
 * something this app is showing you rather than a guest with its own
 * furniture. Nothing here is interactive: every gesture a mode has belongs
 * in the ring.
 */
export function EscapeMenuStatusBar({ status }: { status: EscapeMenuModeStatus }) {
  if (status.readouts.length === 0 && !status.subject) return null
  return (
    <div className="chapter-bar-row">
      <div
        className="chapter-tab-mode-shell escape-menu-status-shell"
        role="status"
        aria-live="polite"
        aria-label={`${status.title} status`}
      >
        {status.subject ? <span className="escape-menu-status-subject">{status.subject}</span> : null}
        {status.readouts.map((readout) => (
          <div key={readout.key} className="tag-pill escape-menu-readout">
            <span className="tag-pill-label">{readout.label}</span>
            <span className="escape-menu-readout-value">{readout.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
