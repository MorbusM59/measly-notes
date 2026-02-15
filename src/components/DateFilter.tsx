import React from 'react';
import './DateFilter.css';
import { FILTER_MONTHS, FILTER_YEARS, CLEAR_MONTHS_SIGNAL, CLEAR_YEARS_SIGNAL, YearValue } from '../shared/filterConstants';

interface DateFilterProps {
  selectedMonths: Set<number>;
  selectedYears: Set<number | 'older'>;
  onMonthToggle: (month: number, event: React.MouseEvent) => void;
  onYearToggle: (year: YearValue, event: React.MouseEvent) => void;
}

export const DateFilter: React.FC<DateFilterProps> = ({
  selectedMonths,
  selectedYears,
  onMonthToggle,
  onYearToggle,
}) => {
  const handleMonthClick = (e: React.MouseEvent, month: number) => {
    onMonthToggle(month, e);
  };

  const handleMonthRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    // Clear all month selections using special signal
    const syntheticEvent = {
      ...e,
      button: 2,
      type: 'contextmenu'
    } as React.MouseEvent;
    onMonthToggle(CLEAR_MONTHS_SIGNAL, syntheticEvent);
  };

  const handleYearClick = (e: React.MouseEvent, year: number | 'older') => {
    onYearToggle(year, e);
  };

  const handleYearRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    // Clear all year selections using special signal
    const syntheticEvent = {
      ...e,
      button: 2,
      type: 'contextmenu'
    } as React.MouseEvent;
    onYearToggle(CLEAR_YEARS_SIGNAL, syntheticEvent);
  };

  return (
    <div className="date-filter">
      <div className="filter-row" onContextMenu={handleMonthRightClick}>
        {FILTER_MONTHS.map(month => (
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
        {FILTER_YEARS.map(year => (
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
