import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';

type LanguageDropdownProps = {
  value: 'English' | 'Chinese' | 'Japanese'| 'Korean' | 'Spanish' | 'French' | 'Hindi';
  onChange: (value: 'English' | 'Chinese' | 'Japanese' | 'Korean' | 'Spanish' | 'French' | 'Hindi') => void;
  languageIcons: Record<'English' | 'Chinese' | 'Japanese' | 'Korean' | 'Spanish' | 'French' | 'Hindi', string>;
};

const LanguageDropdown: React.FC<LanguageDropdownProps> = ({
  value,
  onChange,
  languageIcons,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (btnRef.current && !btnRef.current.contains(event.target as Node) &&
          dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const languages: ('English' | 'Chinese' | 'Japanese' | 'Korean' | 'Spanish' | 'French' | 'Hindi')[] = ['English', 'Chinese', 'Japanese', 'Korean', 'Spanish', 'French', 'Hindi'];

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-6 py-4 bg-white rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg"
      >
        <div className="flex items-center space-x-2">
          <span className="text-xl">{languageIcons[value]}</span>
          <span className="text-black font-medium">{value}</span>
        </div>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${isOpen ? 'transform rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && typeof document !== "undefined" && ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            width: btnRef.current?.offsetWidth || 'auto',
            top: (btnRef.current?.getBoundingClientRect().bottom || 0) + window.scrollY + 4,
            left: (btnRef.current?.getBoundingClientRect().left || 0) + window.scrollX,
            zIndex: 1000,
          }}
          className="bg-white rounded-lg shadow-xl border border-gray-200"
        >
          {languages.map((language) => (
            <button
              key={language}
              onClick={() => {
                onChange(language);
                setIsOpen(false);
              }}
              className={`w-full text-left px-4 py-3 flex items-center hover:bg-blue-50 transition-colors duration-150 ${
                value === language ? 'bg-blue-50 text-blue-600 font-medium' : 'text-black'
              }`}
            >
              <div className="flex items-center space-x-2">
                <span className="text-xl">{languageIcons[language]}</span>
                <span>{language}</span>
              </div>
              {value === language && (
                <svg className="ml-auto h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
};

export default LanguageDropdown;