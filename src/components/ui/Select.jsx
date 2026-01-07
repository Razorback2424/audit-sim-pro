import React from 'react';

export const Select = React.forwardRef(({ className = '', options = [], children, ...props }, ref) => (
  <select
    ref={ref}
    className={`w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white ${className}`}
    {...props}
  >
    {options.length > 0
      ? options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))
      : children}
  </select>
));

Select.displayName = 'Select';
