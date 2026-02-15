import React from 'react';
import './DateFilter.css';

interface DateFilterProps {
  selectedMonths: Set<number>;
  selectedYears: Set<number | 'older'>;
  onMonthToggle: (month: number) => void;
  onYearToggle: (year: number | 'older') => void;
}

export const DateFilter: React.FC<DateFilterProps> = ({
  selectedMonths,
  selectedYears,
  onMonthToggle,
  onYearToggle,
}) => {
  const years: (number | 'older')[] = ['older', 2022, 2023, 2024, 2025, 2026];
  const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  return (
    <div className="date-filter">
      <div className="filter-row">
        {months.map(month => (
          <button
            key={month}
            className={`filter-btn ${selectedMonths.has(month) ? 'active' : ''}`}
            onClick={() => onMonthToggle(month)}
          >
            {month}
          </button>
        ))}
      </div>
      
      <div className="filter-row">
        {years.map(year => (
          <button
            key={year}
            className={`filter-btn ${selectedYears.has(year) ? 'active' : ''}`}
            onClick={() => onYearToggle(year)}
          >
            {year === 'older' ? 'Older' : year}
          </button>
        ))}
      </div>
    </div>
  );
};
