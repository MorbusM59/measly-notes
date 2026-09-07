import type { EditorSelectionState } from './EditorContract'
import { applyMarkdownEnter } from './MarkdownContext'

export interface EnterTransformEvent {
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  text: string
  selection: EditorSelectionState
}

export function resolveMarkdownEnterTransform(
  event: EnterTransformEvent,
): { text: string; selection: EditorSelectionState } | null {
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
    return null
  }

  // event.text is canonical by construction -- CM6Editor.tsx's
  // canonicalTextFilter enforces that as a document invariant, so this path
  // does not re-normalize the whole document on every Enter press. See that
  // filter's doc comment for why the old call was unsound as well as costly.
  const next = applyMarkdownEnter(event.text, event.selection)
  if (!next) {
    return null
  }

  return {
    text: next.text,
    selection: next.selection,
  }
}