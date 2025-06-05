import React, { useState, useEffect } from 'react';

const Dictionary = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [locale, setLocale] = useState('en');
  const [translatedDefinition, setTranslatedDefinition] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [isWordSearch, setIsWordSearch] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [originalText, setOriginalText] = useState('');

  useEffect(() => {
    const savedLocale = localStorage.getItem('locale') || 'en';
    console.log("Dictionary component - loaded locale:", savedLocale);
    setLocale(savedLocale);
    
    const handleStorageChange = () => {
      const newLocale = localStorage.getItem('locale') || 'en';
      if (newLocale !== locale) {
        console.log("Dictionary - locale changed from", locale, "to", newLocale);
        setLocale(newLocale);
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [locale]);


  const detectLanguage = (text: string): string => {
    if (!text || !text.trim()) {
      return 'unknown';
    }
    
    const hasJapaneseChars = /[\u3040-\u309f\u30a0-\u30ff]/.test(text); 
    const hasKoreanChars = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(text); 
    const hasChineseChars = /[\u4e00-\u9fff]/.test(text); 
    const hasSpanishChars = /[áéíóúñü¿¡]/i.test(text);
    const hasFrenchChars = /[àâæçéèêëîïôœùûüÿ]/i.test(text);
    const hasItalianChars = /[àèéìíîòóùú]/i.test(text);
    const hasGermanChars = /[äöüßÄÖÜ]/i.test(text);
    const hasHindiChars = /[\u0900-\u097F]/.test(text);
    const japaneseKanaCount = (text.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
    const chineseCharCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const frenchSpecificCount = (text.match(/[çœÿ]/gi) || []).length;
    const germanSpecificCount = (text.match(/[äöüß]/gi) || []).length;
    
    if (hasHindiChars) {
      console.log("Detected as Hindi (client-side)");
      return 'hi';
    }
    
    if (hasJapaneseChars && (japaneseKanaCount > 0 || !hasChineseChars)) {
      console.log("Detected as Japanese (client-side)");
      return 'ja';
    }
    
    if (hasKoreanChars) {
      console.log("Detected as Korean (client-side)");
      return 'ko';
    }
    
    if (hasChineseChars) {
      console.log("Detected as Chinese (client-side)");
      return 'zh-CN';
    }
    
    if (hasGermanChars && germanSpecificCount > 0) {
      console.log("Detected as German (client-side)");
      return 'de';
    }
    
    if (hasFrenchChars && frenchSpecificCount > 0) {
      console.log("Detected as French (client-side)");
      return 'fr';
    }
    
    if (hasItalianChars) {
      console.log("Detected as Italian (client-side)");
      return 'it';
    }
    
    if (hasSpanishChars) {
      console.log("Detected as Spanish (client-side)");
      return 'es';
    }
    
    console.log("Defaulting to English (client-side)");
    return 'en';
  };

  const handleSearch = async () => {
    if (!searchTerm.trim()) return;
    
    setIsLoading(true);
    setSearchResults(null);
    setTranslatedDefinition('');
    setTranslatedText('');
    setLastError(null);
    setDetectedLanguage(null);
    setOriginalText(searchTerm.trim());

    const detectedLang = detectLanguage(searchTerm.trim());
    setDetectedLanguage(detectedLang);
    console.log(`Detected language: ${detectedLang}`);
    
    const isSingleWord = ['ja', 'zh-CN', 'ko'].includes(detectedLang)
      ? searchTerm.trim().length <= 5
      : searchTerm.trim().split(/\s+/).length === 1; 
    
    setIsWordSearch(isSingleWord);
    console.log(`Dictionary search: "${searchTerm}" as ${isSingleWord ? 'word' : 'phrase'} in ${detectedLang}`);

    if (detectedLang !== 'en') {
      try {
        const response = await fetch('http://localhost:8000/api/translate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: searchTerm.trim(),
            source: detectedLang,
            target: 'en'
          }),
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log("Translation to English response:", data);
          
          if (data && data.translated_text) {
            const englishText = data.translated_text;
            console.log(`Translated to English: "${englishText}"`);
            
            if (isSingleWord) {
              setTranslatedText(englishText);
              await lookupWordInDictionary(englishText);
            } else {
              setSearchResults({
                isSentence: true,
                text: searchTerm.trim(),
                translatedText: englishText,
                isEnglishInput: false,
                detectedLanguage: detectedLang
              });
              setTranslatedText(englishText);
              setIsLoading(false);
            }
          } else {
            throw new Error('Translation API returned unexpected format');
          }
        } else {
          const errorText = await response.text();
          console.error("Translation API error response:", errorText);
          throw new Error(`Translation failed: ${response.status}`);
        }
      } catch (error) {
        console.error("Translation error:", error);
        setSearchResults({
          error: true,
          message: error instanceof Error ? error.message : "Unknown error",
          originalText: searchTerm.trim(),
          detectedLanguage: detectedLang
        });
        setLastError(error instanceof Error ? error.message : "An error occurred during translation");
        setIsLoading(false);
      }
    } else {
      if (isSingleWord) {
        await lookupWordInDictionary(searchTerm.trim());
      } else {
        setSearchResults({
          isSentence: true,
          text: searchTerm.trim(),
          isEnglishInput: true,
          detectedLanguage: 'en'
        });
        setIsLoading(false);
      }
    }
  };

  const lookupWordInDictionary = async (word: string) => {
    try {
      console.log(`Looking up word in dictionary: "${word}"`);
      const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
      
      if (!response.ok) {
        console.log(`Dictionary API returned status: ${response.status}`);
        if (response.status === 404) {
          setSearchResults({
            error: true,
            message: "Word not found in English dictionary",
            originalText: originalText,
            translatedWord: word,
            detectedLanguage: detectedLanguage
          });
        } else {
          throw new Error(`Dictionary API error: ${response.status}`);
        }
      } else {
        const data = await response.json();
        console.log("Dictionary API response:", data);
        setSearchResults({
          ...data[0],
          originalText: originalText,
          detectedLanguage: detectedLanguage,
          translatedWord: word
        });
      }
    } catch (error) {
      console.error("Dictionary search error:", error);
      setSearchResults({
        error: true,
        message: error instanceof Error ? error.message : "Unknown error",
        originalText: originalText,
        detectedLanguage: detectedLanguage
      });
      setLastError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleSearch();
    }
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
  };

  const getLanguageName = (code: string): string => {
    const languageMap: Record<string, string> = {
      'en': 'English',
      'zh-CN': 'Chinese (Simplified)',
      'zh-TW': 'Chinese (Traditional)',
      'zh': 'Chinese',
      'ja': 'Japanese',
      'ko': 'Korean',
      'es': 'Spanish',
      'fr': 'French',
      'it': 'Italian',
      'de': 'German',
      'hi': 'Hindi',
      'unknown': 'Unknown'
    };
    return languageMap[code] || code;
  };

  return (
    <div className="w-full">
      <div className="flex mb-3">
        <input
          type="text"
          value={searchTerm}
          onChange={handleInputChange}
          onKeyPress={handleKeyPress}
          placeholder="Type a word or phrase..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded-l-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-800"
        />
        <button
          onClick={handleSearch}
          disabled={isLoading}
          className="bg-[#20b2aa] hover:bg-[#008080] text-white px-4 py-2 rounded-r-lg transition-colors"
        >
          {isLoading ? (
            <div className="w-5 h-5 border-t-2 border-white rounded-full animate-spin"></div>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          )}
        </button>
      </div>

      {isLoading && (
        <div className="flex justify-center py-4">
          <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-[#20b2aa]"></div>
        </div>
      )}

      {/* Word dictionary result */}
      {!isLoading && searchResults && !searchResults.error && isWordSearch && (
        <div className="bg-white rounded-lg p-4 shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <h4 className="text-lg font-bold text-gray-800">{searchResults.word}</h4>
              
              {detectedLanguage && detectedLanguage !== 'en' && (
                <div className="text-sm text-gray-500 mb-2">
                  <p>Original ({getLanguageName(detectedLanguage)}): {originalText}</p>
                  {searchResults.translatedWord && originalText !== searchResults.translatedWord && (
                    <p>Translation: {searchResults.translatedWord}</p>
                  )}
                </div>
              )}
              
              <p className="text-sm text-gray-500">
                {searchResults.phonetic || (searchResults.phonetics && searchResults.phonetics.length > 0 ? searchResults.phonetics[0].text : '')}
              </p>
            </div>
            
            {searchResults.phonetics && searchResults.phonetics.some((p: any) => p.audio) && (
              <button 
                className="bg-gray-100 hover:bg-gray-200 rounded-full p-2 transition-colors"
                onClick={() => {
                  const audio = searchResults.phonetics.find((p: any) => p.audio)?.audio;
                  if (audio) {
                    new Audio(audio).play();
                  }
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              </button>
            )}
          </div>
          
          {searchResults.meanings && searchResults.meanings.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-gray-500 mb-1">{searchResults.meanings[0].partOfSpeech}</p>
              <p className="text-sm text-gray-700">{searchResults.meanings[0].definitions[0].definition}</p>
              
              {searchResults.meanings[0].definitions[0].example && (
                <div className="mt-2 pt-2 border-t border-gray-100">
                  <p className="text-sm text-gray-700 italic">"{searchResults.meanings[0].definitions[0].example}"</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sentence translation result */}
      {!isLoading && searchResults && !searchResults.error && !isWordSearch && (
        <div className="bg-white rounded-lg p-4 shadow-sm">
          <div>
            <h4 className="text-md font-medium text-gray-800">
              {searchResults.isEnglishInput ? 'Text' : `Original`}:
            </h4>
            <p className="text-sm text-gray-700 mt-1">{searchResults.text}</p>
            
            {!searchResults.isEnglishInput && translatedText && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <h4 className="text-md font-medium text-gray-800">English Translation:</h4>
                <p className="text-sm text-gray-700 mt-1">{translatedText}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error or no results found */}
      {!isLoading && searchResults && searchResults.error && (
        <div className="bg-white rounded-lg p-4">
          {detectedLanguage && detectedLanguage !== 'en' && detectedLanguage !== 'unknown' && (
            <div className="mb-3">
              <h4 className="text-md font-medium text-gray-800">Original ({getLanguageName(detectedLanguage)}):</h4>
              <p className="text-sm text-gray-700 mt-1">{originalText || searchResults.originalText}</p>
              
              {searchResults.translatedWord && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <h4 className="text-md font-medium text-gray-800">English Translation:</h4>
                  <p className="text-sm text-gray-700 mt-1">{searchResults.translatedWord}</p>
                </div>
              )}
            </div>
          )}
          
          <div className="text-center mt-2">
            <p className="text-gray-600">
              {detectedLanguage && detectedLanguage !== 'en' && searchResults.translatedWord 
                ? "" 
                : "No results found"}
            </p>
            {lastError && (
              <p className="text-sm text-red-500 mt-1">{lastError}</p>
            )}
          </div>
        </div>
      )}

      {!isLoading && !searchResults && (
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <p className="text-gray-500 text-sm">
            Translation...
          </p>
        </div>
      )}
    </div>
  );
};

export default Dictionary;