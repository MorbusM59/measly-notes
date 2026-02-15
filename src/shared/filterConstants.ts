// Shared constants for date filtering
export const FILTER_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const FILTER_YEARS: (number | 'older')[] = ['older', 2022, 2023, 2024, 2025, 2026] as const;

// Special values for clear operations
export const CLEAR_MONTHS_SIGNAL = -1;
export const CLEAR_YEARS_SIGNAL = 'clear-all' as const;
