import { useState, useRef, useEffect } from 'react';
import './CustomSelect.css';

interface SelectOption {
  value: string;
  label: string;
  icon?: string;
}

interface CustomSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function CustomSelect({ 
  options, 
  value, 
  onChange, 
  placeholder = 'Select...',
  disabled = false 
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => opt.value === value);

  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightedIndex(prev => 
            prev < options.length - 1 ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightedIndex(prev => prev > 0 ? prev - 1 : prev);
          break;
        case 'Enter':
          e.preventDefault();
          const selectedOption = options[highlightedIndex];
          if (selectedOption) {
            onChange(selectedOption.value);
            setIsOpen(false);
          }
          break;
        case 'Escape':
          setIsOpen(false);
          break;
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, highlightedIndex, options, onChange]);

  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      const selectedIdx = options.findIndex(opt => opt.value === value);
      if (selectedIdx !== -1) {
        setHighlightedIndex(selectedIdx);
      }
    }
  }, [isOpen, value, options]);

  return (
    <div 
      className={`custom-select ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
      ref={containerRef}
    >
      <button
        type="button"
        className="custom-select__trigger"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="custom-select__value">
          {selectedOption?.icon && (
            <span className="custom-select__icon">{selectedOption.icon}</span>
          )}
          {selectedOption?.label || placeholder}
        </span>
        <span className="custom-select__arrow">
          {isOpen ? '▲' : '▼'}
        </span>
      </button>

      {isOpen && (
        <ul 
          className="custom-select__dropdown"
          role="listbox"
          aria-label="Options"
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              className={`custom-select__option ${
                highlightedIndex === index ? 'highlighted' : ''
              } ${
                value === option.value ? 'selected' : ''
              }`}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              onMouseEnter={() => setHighlightedIndex(index)}
              role="option"
              aria-selected={value === option.value}
            >
              {option.icon && (
                <span className="custom-select__option-icon">{option.icon}</span>
              )}
              <span className="custom-select__option-label">{option.label}</span>
              {value === option.value && (
                <span className="custom-select__check">✓</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
