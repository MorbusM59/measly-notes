import React from 'react';
import './DateFilter.css';

interface DateFilterProps {
  selectedMonths: Set<number>;
  selectedYears: Set<number | 'older'>;
  onMonthToggle: (month: number, event: React.MouseEvent) => void;
  onYearToggle: (year: number | 'older', event: React.MouseEvent) => void;
}

export const DateFilter: React.FC<DateFilterProps> = ({
  selectedMonths,
  selectedYears,
  onMonthToggle,
  onYearToggle,
}) => {
  const years: (number | 'older')[] = ['older', 2022, 2023, 2024, 2025, 2026];
  const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  const handleMonthClick = (e: React.MouseEvent, month: number) => {
    onMonthToggle(month, e);
  };

  const handleMonthRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    // Clear all month selections by calling onMonthToggle with null indicator
    // We'll use a special event marker
    const syntheticEvent = {
      ...e,
      button: 2,
      type: 'contextmenu'
    } as React.MouseEvent;
    onMonthToggle(-1, syntheticEvent); // -1 signals clear all
  };

  const handleYearClick = (e: React.MouseEvent, year: number | 'older') => {
    onYearToggle(year, e);
  };

  const handleYearRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    // Clear all year selections
    const syntheticEvent = {
      ...e,
      button: 2,
      type: 'contextmenu'
    } as React.MouseEvent;
    onYearToggle('clear-all' as any, syntheticEvent); // special signal
  };

  return (
    <div className="date-filter">
      <div className="filter-row" onContextMenu={handleMonthRightClick}>
        {months.map(month => (
          <button
            key={month}
            className={`filter-btn ${selectedMonths.has(month) ? 'active' : ''}`}
            onClick={(e) => handleMonthClick(e, month)}
            onContextMenu={(e) => e.preventDefault()}
          >
            {month}
          </button>
        ))}
      </div>
      
      <div className="filter-row" onContextMenu={handleYearRightClick}>
        {years.map(year => (
          <button
            key={year}
            className={`filter-btn ${selectedYears.has(year) ? 'active' : ''}`}
            onClick={(e) => handleYearClick(e, year)}
            onContextMenu={(e) => e.preventDefault()}
          >
            {year === 'older' ? 'Older' : year}
          </button>
        ))}
      </div>
    </div>
  );
};
