import React, { useEffect, useMemo, useRef, useState } from 'react';

export default function RosterMultiSelect({ id, options, value, onChange, disabled, loading, placeholder }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  const optionsMap = useMemo(() => {
    const map = new Map();
    options.forEach((option) => {
      map.set(option.id, option);
    });
    return map;
  }, [options]);

  const valueSet = useMemo(() => new Set(value), [value]);

  const normalizedSelected = useMemo(
    () =>
      value.map((selectedId) => {
        const option = optionsMap.get(selectedId);
        return {
          id: selectedId,
          label: option?.label || selectedId,
        };
      }),
    [value, optionsMap]
  );

  const filteredOptions = useMemo(() => {
    const available = options.filter((option) => !valueSet.has(option.id));
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return available.slice(0, 20);
    }
    return available.filter((option) => {
      const label = option.label?.toLowerCase() || '';
      const email = option.email?.toLowerCase() || '';
      return label.includes(trimmed) || email.includes(trimmed) || option.id.toLowerCase().includes(trimmed);
    });
  }, [options, query, valueSet]);

  const handleInputFocus = () => {
    if (!disabled) {
      setOpen(true);
    }
  };

  const handleInputChange = (event) => {
    if (disabled) return;
    setQuery(event.target.value);
    setOpen(true);
  };

  const addValue = (rawId) => {
    const trimmed = typeof rawId === 'string' ? rawId.trim() : '';
    if (!trimmed || valueSet.has(trimmed)) {
      setQuery('');
      setOpen(false);
      return;
    }
    onChange([...value, trimmed]);
    setQuery('');
    setOpen(false);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (filteredOptions.length > 0) {
        const [first] = filteredOptions;
        if (first) addValue(first.id);
      } else {
        addValue(query);
      }
    }
    if (event.key === 'Backspace' && !query && value.length > 0) {
      event.preventDefault();
      const next = value.slice(0, -1);
      onChange(next);
    }
  };

  const removeSelected = (selectedId) => {
    if (disabled) return;
    onChange(value.filter((idValue) => idValue !== selectedId));
  };

  const selectOption = (option) => {
    if (disabled) return;
    addValue(option.id);
  };

  const dropdownId = id ? `${id}-options` : undefined;

  const showDropdown = !disabled && open && filteredOptions.length > 0;

  return (
    <div className="relative" ref={containerRef}>
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-gray-300 px-2 py-1 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-200">
        {normalizedSelected.map((selected) => (
          <span
            key={selected.id}
            className="flex items-center space-x-1 rounded bg-blue-100 px-2 py-1 text-xs text-blue-800"
          >
            <span>{selected.label}</span>
            <button
              type="button"
              className="text-blue-600 hover:text-blue-800"
              aria-label={`Remove ${selected.label}`}
              onClick={() => removeSelected(selected.id)}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          value={query}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={normalizedSelected.length === 0 ? placeholder : ''}
          disabled={disabled}
          className="flex-1 border-none bg-transparent py-1 text-sm text-gray-700 outline-none"
          role="combobox"
          aria-expanded={showDropdown}
          aria-haspopup="listbox"
          aria-controls={dropdownId}
          aria-label="Search roster"
        />
      </div>
      {showDropdown ? (
        <ul
          id={dropdownId}
          role="listbox"
          className="absolute z-10 left-0 right-0 mt-1 max-h-48 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg"
        >
          {filteredOptions.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                role="option"
                aria-selected="false"
                className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
              >
                <span className="text-gray-700">{option.label}</span>
                {option.email ? <span className="text-xs text-gray-500">{option.email}</span> : null}
              </button>
            </li>
          ))}
          {filteredOptions.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500">No matches found.</li>
          ) : null}
        </ul>
      ) : null}
      {loading ? <p className="mt-1 text-xs text-gray-500">Loading roster…</p> : null}
    </div>
  );
}
