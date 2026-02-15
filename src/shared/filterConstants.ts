// Shared constants for date filtering
export const FILTER_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const FILTER_YEARS = ['older', 2022, 2023, 2024, 2025, 2026] as const;

// Special values for clear operations
export const CLEAR_MONTHS_SIGNAL = -1;
export const CLEAR_YEARS_SIGNAL = 'clear-all' as const;

// Type for year values including clear signal
export type YearValue = number | 'older' | typeof CLEAR_YEARS_SIGNAL;

/**
 * Generic multi-select handler that implements standard desktop behavior
 * @param value The clicked value
 * @param event The mouse event
 * @param currentSelection The current selection set
 * @param allValues The ordered array of all possible values
 * @param setSelection Function to update the selection
 */
export function handleMultiSelect<T>(
  value: T,
  event: React.MouseEvent,
  currentSelection: Set<T>,
  allValues: readonly T[],
  setSelection: (selection: Set<T>) => void
): void {
  if (event.ctrlKey || event.metaKey) {
    // Toggle individual button
    const newSelection = new Set(currentSelection);
    if (newSelection.has(value)) {
      newSelection.delete(value);
    } else {
      newSelection.add(value);
    }
    setSelection(newSelection);
  } else if (event.shiftKey && currentSelection.size === 1) {
    // Range select from the single selected button to clicked button
    const anchor = Array.from(currentSelection)[0];
    const anchorIndex = allValues.indexOf(anchor);
    const clickIndex = allValues.indexOf(value);
    const start = Math.min(anchorIndex, clickIndex);
    const end = Math.max(anchorIndex, clickIndex);
    const rangeValues = allValues.slice(start, end + 1);
    setSelection(new Set(rangeValues));
  } else if (event.shiftKey && currentSelection.size > 1) {
    // With multiple selected, shift behaves like ctrl (add single)
    const newSelection = new Set(currentSelection);
    if (!newSelection.has(value)) {
      newSelection.add(value);
    }
    setSelection(newSelection);
  } else {
    // Plain click — exclusive select (or deselect if already sole selection)
    if (currentSelection.size === 1 && currentSelection.has(value)) {
      setSelection(new Set()); // deselect
    } else {
      setSelection(new Set([value])); // exclusive select
    }
  }
}
