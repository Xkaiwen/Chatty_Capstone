"use client"
import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { auth } from "../../../server/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { sendChatMessage, getSuggestions, setScenario } from '@/services/api';

declare global {
  interface Window {
    debugVoices?: (languageCode?: string) => SpeechSynthesisVoice[] | Record<string, SpeechSynthesisVoice[]>;
    testVoice?: (voiceNameOrIndex: string | number, text?: string) => void;
    testTranslateAPI?: (text: string, from?: string, to?: string) => Promise<any>;
    forceVoiceLanguage?: (langCode: string) => SpeechSynthesisVoice[];
  }
}

interface PracticeSentence {
  text: string;
  audio_url?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  sublevel?: number;
}

interface PronunciationScore {
  score: number;
  feedback: string;
  detailed_feedback?: {
    pronunciation: number;
    fluency: number;
    accuracy: number;
  };
}

const VoicePracticePage = () => {
  const router = useRouter();
  
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [userLanguage, setUserLanguage] = useState<string>('en');
  const [username, setUsername] = useState<string>('');
  const [translation, setTranslation] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState<boolean>(false);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [practiceSentence, setPracticeSentence] = useState<PracticeSentence | null>(null);
  const [userRecording, setUserRecording] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState<string | null>(null);
  const [pronunciationScore, setPronunciationScore] = useState<PronunciationScore | null>(null);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('easy');
  const [sublevel, setSublevel] = useState<number>(1);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [practiceHistory, setPracticeHistory] = useState<Array<{sentence: string, score: number}>>([]);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const userRecordingRef = useRef<string | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState<boolean>(false);
  const [showDifficultySlider, setShowDifficultySlider] = useState<boolean>(false);
  const [usedWords, setUsedWords] = useState<Set<string>>(new Set());
  const maxHistoryItems = 50; 

  const isSpeechRecognitionSupported = () => {
    return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  };

  const getSpeechRecognitionLanguage = (langCode: string): string => {
    console.log(`Getting speech recognition language for code: ${langCode}`);
    
    const langMap: Record<string, string> = {
      'en': 'en-US',
      'fr': 'fr-FR',
      'de': 'de-DE',
      'it': 'it-IT',
      'hi': 'hi-IN',
      'ja': 'ja-JP',
      'ko': 'ko-KR',
      'zh-CN': 'zh-CN',
      'zh-TW': 'zh-TW'
    };
    
    const result = langMap[langCode] || 
                  (langCode.includes('-') ? langMap[langCode.split('-')[0]] : null) || 
                  'en-US';
    
    console.log(`Using speech recognition language: ${result}`);
    return result;
  };

  const testLanguageSupport = (language: string): boolean => {
    try {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) return false;
      
      const recognitionLang = getSpeechRecognitionLanguage(language);
      const recognition = new SpeechRecognition();
      
      recognition.lang = recognitionLang;
      
      recognition.start();
      recognition.stop();
      
      return true;
    } catch (error) {
      console.error(`Language ${language} not supported for speech recognition:`, error);
      return false;
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        const isGuest = localStorage.getItem('isGuest') === 'true';
        if (!isGuest) {
          router.push('/');
          return;
        }
      }
      
      setUser(currentUser);
      
      let userName;
      if (currentUser) {
        userName = currentUser.displayName || currentUser.email?.split('@')[0] || 'Guest';
      } else {
        userName = localStorage.getItem('userName') || 'Guest';
      }
      setUsername(userName);
      
    const savedLocale = localStorage.getItem('locale') || 'en';
    setUserLanguage(savedLocale);

    const savedDifficulty = localStorage.getItem('practiceDifficulty') as 'easy' | 'medium' | 'hard' || 'easy';
    const savedSublevel = parseInt(localStorage.getItem('practiceSublevel') || '1');
    
    setDifficulty(savedDifficulty);
    setSublevel(savedSublevel);
    
    try {
      const storedRecent = localStorage.getItem(`recentWords_${savedLocale}_${savedDifficulty}_${savedSublevel}`);
      if (storedRecent) {
        const recentWords = JSON.parse(storedRecent);
        setUsedWords(new Set(recentWords));
      }
    } catch (e) {
      console.error("Error reading word history from localStorage:", e);
    }
    
    await generateNewPracticeSentence(savedLocale, savedDifficulty, savedSublevel);
    
    setLoading(false);
  });
  
  return () => unsubscribe();
}, [router]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setShowProfileMenu(false);
      }
    }
    
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          console.error("Error stopping recognition on unmount:", e);
        }
      }
    };
  }, []);
  
  useEffect(() => {
    let inactivityTimer: NodeJS.Timeout | null = null;
    
    if (isListening) {
      inactivityTimer = setTimeout(() => {
        console.log("No speech detected for 10 seconds, stopping listening");
        stopListening();
      }, 10000);
    }
    
    return () => {
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
      }
    };
  }, [isListening]);

  useEffect(() => {
    console.log("Speech recognition supported:", isSpeechRecognitionSupported());
    
    navigator.mediaDevices?.getUserMedia({ audio: true })
      .then(() => console.log("Microphone permission granted"))
      .catch(err => console.error("Microphone permission issue:", err));
  }, []);

  useEffect(() => {
    (window as any).testTranslateAPI = async (text: string, from: string = userLanguage, to: string = 'en') => {
      console.log(`Testing translation API: "${text}" from ${from} to ${to}`);
      try {
        const response = await fetch('http://localhost:8000/api/translate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: text,
            source_language: from,
            target_language: to
          }),
        });
        
        console.log("Response status:", response.status);
        const data = await response.json();
        console.log("Translation API response:", data);
        return data;
      } catch (error) {
        console.error("Test translation failed:", error);
        return null;
      }
    };
  }, [userLanguage]);

  useEffect(() => {
    if (userLanguage && isSpeechRecognitionSupported()) {
      const isSupported = testLanguageSupport(userLanguage);
      console.log(`Language ${userLanguage} supported by speech recognition: ${isSupported}`);
      
      if (!isSupported) {
        setFeedback(`Warning: Speech recognition for ${userLanguage} may have limited support in your browser.`);
        setTimeout(() => setFeedback(null), 5000);
      }
    }
  }, [userLanguage]);

  useEffect(() => {
    const initializeVoices = () => {
      if (!window.speechSynthesis) return;
      
      const getVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
          console.log(`Loaded ${voices.length} voices`);
          
          if (userLanguage) {
            const langPrefix = userLanguage.split('-')[0].toLowerCase();
            const matchingVoices = voices.filter(v => 
              v.lang.toLowerCase().startsWith(langPrefix) || 
              (userLanguage.startsWith('zh') && v.lang.toLowerCase().includes('zh'))
            );
            
            console.log(`Found ${matchingVoices.length} voices for ${userLanguage}`);
            
            matchingVoices.forEach((v, i) => {
              console.log(`${i+1}. ${v.name} (${v.lang}) - ${v.localService ? 'Local' : 'Network'}`);
            });
            
            if (matchingVoices.length > 0) {
              const u = new SpeechSynthesisUtterance(' ');
              u.voice = matchingVoices[0];
              u.volume = 0;
              window.speechSynthesis.speak(u);
            }
          }
        } else {
          console.warn("No voices available");
        }
      };
      
      getVoices();
      
      window.speechSynthesis.onvoiceschanged = getVoices;
      
      setTimeout(() => {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        window.speechSynthesis.speak(u);
      }, 500);
      
      setTimeout(getVoices, 1000);
    };
    
    initializeVoices();
    
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, [userLanguage]);

  useEffect(() => {
    if (!window.forceVoiceLanguage) {
      window.forceVoiceLanguage = (langCode: string): SpeechSynthesisVoice[] => {
        console.log(`Forcing browser to load voices for: ${langCode}`);
        
        const u = new SpeechSynthesisUtterance('test');
        u.lang = langCode;
        u.volume = 0;
        
        window.speechSynthesis.speak(u);
        setTimeout(() => window.speechSynthesis.cancel(), 100);
        
        const voices = window.speechSynthesis.getVoices();
        const matchingVoices = voices.filter(v => 
          v.lang.toLowerCase().startsWith(langCode.toLowerCase().split('-')[0])
        );
        
        console.log(`Available voices (${voices.length}):`);
        console.log(`Matching voices for ${langCode} (${matchingVoices.length}):`);
        matchingVoices.forEach((v, i) => {
          console.log(`${i+1}. ${v.name} (${v.lang}) - ${v.localService ? 'Local' : 'Network'}`);
        });
        
        setTimeout(() => {
          const updatedVoices = window.speechSynthesis.getVoices();
          const updatedMatchingVoices = updatedVoices.filter(v => 
            v.lang.toLowerCase().startsWith(langCode.toLowerCase().split('-')[0])
          );
          console.log(`Updated matching voices for ${langCode} (${updatedMatchingVoices.length}):`);
        }, 500);
        
        return matchingVoices;
      };
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('practiceDifficulty', difficulty);
      localStorage.setItem('practiceSublevel', sublevel.toString());
    } catch (e) {
      console.error("Error saving settings to localStorage:", e);
    }
  }, [difficulty, sublevel]);


useEffect(() => {
    const preloadVoicesForLanguage = async (language: string) => {
        console.log(`Preloading voices for ${language}...`);
        
        const langMap: Record<string, string> = {
        'en': 'en-US',
        'fr': 'fr-FR',
        'de': 'de-DE',
        'it': 'it-IT',
        'hi': 'hi-IN',
        'ja': 'ja-JP',
        'ko': 'ko-KR',
        'zh-CN': 'zh-CN',
        'zh-TW': 'zh-TW',
        'es': 'es-ES'
        };
        
        const locale = langMap[language] || language;
        
        const utterance = new SpeechSynthesisUtterance(" ");
        utterance.lang = locale;
        utterance.volume = 0;
        
        if (window.speechSynthesis) {
        window.speechSynthesis.speak(utterance);
        setTimeout(() => {
            window.speechSynthesis.cancel();
            
            const voices = window.speechSynthesis.getVoices();
            const matchingVoices = voices.filter(v => 
            v.lang.toLowerCase().startsWith(language.split('-')[0].toLowerCase())
            );
            
            console.log(`After preloading, found ${matchingVoices.length} voices for ${language}`);
            matchingVoices.forEach((v, i) => {
            console.log(`${i+1}. ${v.name} (${v.lang})`);
            });
        }, 300);
        }
    };
    
    if (userLanguage) {
        preloadVoicesForLanguage(userLanguage);
    }
    
    window.debugVoices = (langCode?: string) => {
        const voices = window.speechSynthesis.getVoices();
        
        if (langCode) {
        const baseCode = langCode.split('-')[0].toLowerCase();
        const matchingVoices = voices.filter(v => 
            v.lang.toLowerCase().startsWith(baseCode)
        );
        
        console.log(`Found ${matchingVoices.length} voices for ${langCode}:`);
        matchingVoices.forEach((v, i) => {
            console.log(`${i+1}. ${v.name} (${v.lang}) - ${v.default ? 'Default' : ''}`);
        });
        
        return matchingVoices;
        }
        
        const voicesByLang: Record<string, SpeechSynthesisVoice[]> = {};
        
        voices.forEach(voice => {
        const langBase = voice.lang.split('-')[0].toLowerCase();
        if (!voicesByLang[langBase]) {
            voicesByLang[langBase] = [];
        }
        voicesByLang[langBase].push(voice);
        });
        
        console.log(`Found voices for ${Object.keys(voicesByLang).length} languages:`);
        Object.entries(voicesByLang).forEach(([lang, voices]) => {
        console.log(`${lang}: ${voices.length} voices`);
        });
        
        return voicesByLang;
    };
    
    window.testVoice = (voiceNameOrIndex: string | number, text: string = "Hello, testing voice") => {
        const voices = window.speechSynthesis.getVoices();
        let voice;
        
        if (typeof voiceNameOrIndex === 'number') {
        voice = voices[voiceNameOrIndex];
        } else {
        voice = voices.find(v => v.name.includes(voiceNameOrIndex));
        }
        
        if (voice) {
        const u = new SpeechSynthesisUtterance(text);
        u.voice = voice;
        u.lang = voice.lang;
        console.log(`Testing voice: ${voice.name} (${voice.lang})`);
        window.speechSynthesis.speak(u);
        } else {
        console.error(`Voice "${voiceNameOrIndex}" not found`);
        }
    };
    
    }, [userLanguage]);

const generateNewPracticeSentence = async (
  language: string, 
  difficulty: 'easy' | 'medium' | 'hard', 
  sublevel: number = 1
) => {
  try {
    setIsLoading(true);
    setPronunciationScore(null);
    setFeedback(null);
    setTranslation(null);
    setShowTranslation(false);
    
    const contentType = difficulty === 'easy' ? 'word' : 'sentence';
    console.log(`Requesting ${difficulty} (level ${sublevel}) ${contentType} in ${language}`);

    // Increase history tracking and make it more specific
    const maxHistoryItems = 200;
    const historyKey = `recentWords_${language}_${difficulty}_${sublevel}`;
    let recentWords: string[] = [];
    
    try {
      const storedRecent = localStorage.getItem(historyKey);
      if (storedRecent) {
        recentWords = JSON.parse(storedRecent);
      }
      
      // Add current used words to recent history
      Array.from(usedWords).forEach(word => {
        if (!recentWords.includes(word)) {
          recentWords.push(word);
        }
      });
      
      // Also check history from other sublevels for better variety
      for (let i = 1; i <= 10; i++) {
        if (i !== sublevel) {
          const otherKey = `recentWords_${language}_${difficulty}_${i}`;
          try {
            const otherHistory = localStorage.getItem(otherKey);
            if (otherHistory) {
              const otherWords = JSON.parse(otherHistory);
              // Add some words from other levels to avoid (but not all)
              otherWords.slice(-20).forEach((word: string) => {
                if (!recentWords.includes(word)) {
                  recentWords.push(word);
                }
              });
            }
          } catch (e) {
            console.error("Error reading other level history:", e);
          }
        }
      }
    } catch (e) {
      console.error("Error reading from localStorage:", e);
    }

    // Enhanced randomization
    const timestamp = new Date().getTime();
    const randomToken = Math.random().toString(36).substring(2, 15) + timestamp;
    const sessionId = `${timestamp}_${Math.random() * 1000000}`;
    
    // Add more variety parameters
    const requestBody = {
      language: language,
      difficulty: difficulty,
      sublevel: sublevel, 
      username: username,
      content_type: contentType,
      randomize: true,
      force_variety: true,
      timestamp: timestamp,
      token: randomToken,
      session_id: sessionId,
      exclude: recentWords,
      frequency: sublevel <= 3 ? "high" : sublevel <= 7 ? "medium" : "any",
      seed: Math.floor(Math.random() * 1000000),
      max_retries: 10,
      avoid_duplicates: true,
      diversity_boost: true,
      expand_vocabulary: true,
      personal_history: true,
      exclude_count: recentWords.length,
      force_new_content: true,
      variety_threshold: 0.8,
      prevent_repetition: true,
      shuffle_pool: true,
      unique_session: true,
      entropy_boost: Math.random(),
      fresh_request: true,
      avoid_recent_count: Math.min(100, recentWords.length),
      request_unique_id: `${Date.now()}_${Math.random()}_${sublevel}`,
      force_different: true,
      min_variety_score: 0.9
    };
    
    // Try multiple attempts with different parameters
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        console.log(`Attempt ${attempts + 1}/${maxAttempts} for new content`);
        
        // Add more randomness for each attempt
        const attemptBody = {
          ...requestBody,
          attempt: attempts + 1,
          extra_randomness: Math.random() * 1000000,
          timestamp: new Date().getTime(),
          force_bypass_cache: true,
          super_unique: true,
          attempt_seed: Math.random() * attempts * 1000
        };
        
        const response = await fetch('http://localhost:8000/api/generate_practice_sentence', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'X-Request-ID': `${sessionId}_${attempts}`,
            'X-Timestamp': new Date().getTime().toString(),
            'X-Attempt': (attempts + 1).toString()
          },
          body: JSON.stringify(attemptBody),
        });
        
        console.log("API request sent for language:", language, "content_type:", contentType);
        console.log("Excluded words count:", recentWords.length);
        
        if (response.ok) {
          const data = await response.json();
          console.log("Backend returned practice content:", data);
          
          // Check if it's a duplicate (case-insensitive)
          const isDuplicate = recentWords.some(word => 
            word.toLowerCase() === data.text.toLowerCase()
          );
          
          if (!isDuplicate) {
            // Not a duplicate - use it!
            recentWords.push(data.text);
            if (recentWords.length > maxHistoryItems) {
              recentWords = recentWords.slice(-maxHistoryItems);
            }
            
            setUsedWords(prev => {
              const newSet = new Set(prev);
              newSet.add(data.text);
              if (newSet.size > maxHistoryItems) {
                const toRemove = Array.from(newSet).slice(0, newSet.size - maxHistoryItems);
                toRemove.forEach(word => newSet.delete(word));
              }
              return newSet;
            });
            
            try {
              localStorage.setItem(historyKey, JSON.stringify(recentWords));
            } catch (e) {
              console.error("Error writing to localStorage:", e);
            }
            
            const sentenceWithSublevel = {
              ...data,
              sublevel: sublevel
            };
            
            setPracticeSentence(sentenceWithSublevel);
            return data;
          } else {
            console.warn(`Attempt ${attempts + 1}: Received duplicate content "${data.text}", trying again...`);
            attempts++;
            continue;
          }
        } else {
          const errorText = await response.text();
          console.warn(`Attempt ${attempts + 1}: API returned ${response.status}: ${errorText}`);
          attempts++;
          continue;
        }
      } catch (apiError) {
        console.error(`Attempt ${attempts + 1} failed:`, apiError);
        attempts++;
        continue;
      }
    }
    
    console.log("All primary attempts failed, trying alternative endpoint...");
    
    try {
      const response = await fetch('http://localhost:8000/api/generate_varied_word', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'X-Request-ID': `alt_${Date.now()}_${Math.random()}`
        },
        body: JSON.stringify({
          language: language,
          difficulty_level: sublevel, 
          seed: new Date().getTime() + Math.random() * 1000,
          exclude_previous: true,
          variety_boost: true,
          avoid_words: Array.from(usedWords),
          force_unique: true,
          max_variety: true,
          fresh_content: true,
          entropy_seed: Math.random() * 1000000,
          unique_request: true,
          super_random_mode: true,
          bypass_history: true
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log("Alternative API returned content:", data);
        
        const sentenceWithSublevel = {
          ...data,
          sublevel: sublevel
        };
        setPracticeSentence(sentenceWithSublevel);
        
        if (data.text && !recentWords.includes(data.text.toLowerCase())) {
          recentWords.push(data.text);
          try {
            localStorage.setItem(historyKey, JSON.stringify(recentWords.slice(-maxHistoryItems)));
          } catch (e) {
            console.error("Error writing to localStorage:", e);
          }
        }
        
        return data;
      } else {
        console.error(`Alternative API failed with status: ${response.status}`);
        throw new Error("Alternative API also failed");
      }
    } catch (retryError) {
      console.error("All API attempts failed:", retryError);
      
      const fallbackTexts = {
        'en': ['practice', 'learn', 'speak', 'listen', 'understand', 'improve', 'study', 'review', 'repeat', 'focus'],
        'ja': ['練習', '学習', '話す', '聞く', '理解', '改善', '勉強', '復習', '繰り返し', '集中'],
        'ko': ['연습', '학습', '말하기', '듣기', '이해', '개선', '공부', '복습', '반복', '집중'],
        'zh-CN': ['练习', '学习', '说话', '听', '理解', '改善', '学习', '复习', '重复', '专注'],
        'zh-TW': ['練習', '學習', '說話', '聽', '理解', '改善', '學習', '複習', '重複', '專注'],
        'es': ['práctica', 'aprender', 'hablar', 'escuchar', 'entender', 'mejorar', 'estudiar', 'repasar', 'repetir', 'enfocar'],
        'fr': ['pratique', 'apprendre', 'parler', 'écouter', 'comprendre', 'améliorer', 'étudier', 'réviser', 'répéter', 'concentrer'],
        'de': ['übung', 'lernen', 'sprechen', 'hören', 'verstehen', 'verbessern', 'studieren', 'wiederholen', 'fokussieren'],
        'it': ['pratica', 'imparare', 'parlare', 'ascoltare', 'capire', 'migliorare', 'studiare', 'rivedere', 'ripetere', 'concentrare'],
        'hi': ['अभ्यास', 'सीखना', 'बोलना', 'सुनना', 'समझना', 'सुधार', 'अध्ययन', 'समीक्षा', 'दोहराना', 'ध्यान']
      };
      
      const fallbackList = fallbackTexts[language as keyof typeof fallbackTexts] || fallbackTexts['en'];
      
      const timeIndex = Math.floor(Date.now() / 60000) % fallbackList.length; // Changes every minute
      const randomOffset = Math.floor(Math.random() * 3); // Add some randomness
      const finalIndex = (timeIndex + randomOffset) % fallbackList.length;
      
      const fallbackText = fallbackList[finalIndex];
      
      const errorState = {
        text: fallbackText,
        difficulty: difficulty,
        sublevel: sublevel
      };
      
      setPracticeSentence(errorState);
      setFeedback("Using offline content. Internet connection may be limited.");
      
      return errorState;
    }
  } catch (error) {
    console.error("Error in generateNewPracticeSentence:", error);
    setFeedback("Unable to load new content. Please try again.");
    return null;
  } finally {
    setIsLoading(false);
  }
};

const tryAnotherSentence = async () => {
  resetPracticeState(false);
  
  const currentText = practiceSentence?.text;
  let avoidWords = Array.from(usedWords);
  
  if (currentText) {
    if (!avoidWords.includes(currentText)) {
      avoidWords.push(currentText);
    }
    setUsedWords(prev => {
      const newSet = new Set(prev);
      newSet.add(currentText);
      return newSet;
    });
  }
  
  // Just call the main function instead of duplicating logic
  await generateNewPracticeSentence(userLanguage, difficulty, sublevel);
};

  const startListening = () => {
    try {
      if (!practiceSentence) {
        console.error("No practice sentence available");
        return;
      }
      
      setUserRecording(null);
      userRecordingRef.current = null;
      setPronunciationScore(null);
      
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      
      if (!SpeechRecognition) {
        console.error("Speech Recognition API not supported in this browser");
        alert("Speech recognition is not supported in your browser. Please try using Chrome or Edge.");
        return;
      }
      
      recognitionRef.current = new SpeechRecognition();
      const recognition = recognitionRef.current;
      
      const recognitionLang = getSpeechRecognitionLanguage(userLanguage);
      recognition.lang = recognitionLang;
      console.log(`Speech recognition started with language: ${recognitionLang}`);
      
      if (difficulty === 'easy') {
        recognition.continuous = true; 
        recognition.interimResults = true; 
        recognition.maxAlternatives = 5;
      } else {
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
      }
      
      recognition.onstart = () => {
        console.log("Voice recognition started");
        setIsListening(true);
        setFeedback("Listening... Keep holding the button while speaking");
      };
      
      const handleResult = (event: any) => {
        const results = event.results;
        
        if (results && results.length > 0) {
          let transcript = "";
          
          if (difficulty === 'easy') {
            const targetWord = practiceSentence?.text?.toLowerCase().trim() || "";
            console.log("Target word:", targetWord);
            
            let allTranscripts: string[] = [];
            
            for (let i = 0; i < results.length; i++) {
              for (let j = 0; j < results[i].length; j++) {
                const rawTranscript = results[i][j].transcript.toLowerCase().trim();
                
                const words = rawTranscript.split(/\s+/);
                allTranscripts = [...allTranscripts, ...words, rawTranscript];
              }
            }
            
            allTranscripts = [...new Set(allTranscripts.filter(t => t))];
            console.log("All recognized alternatives:", allTranscripts);
            
            const exactMatch = allTranscripts.find(t => t === targetWord);
            if (exactMatch) {
              transcript = exactMatch;
              console.log("Found exact match:", transcript);
            } else {
              const closeMatch = allTranscripts.find(t => 
                t.startsWith(targetWord) || 
                targetWord.startsWith(t) ||
                (targetWord.length <= 3 && t.includes(targetWord)) ||
                (["zh-CN", "zh-TW", "ja"].includes(userLanguage) && 
                (t.includes(targetWord) || targetWord.includes(t)))
              );
              
              if (closeMatch) {
                transcript = closeMatch;
                console.log("Found close match:", transcript);
              } else {
                transcript = results[0][0].transcript.trim().toLowerCase();
                console.log("Using default transcript:", transcript);
              }
            }
          } else {
            transcript = results[0][0].transcript;
          }
          
          console.log("Final recognized text:", transcript);
          setUserRecording(transcript);
          userRecordingRef.current = transcript;
        }
      };
      
      recognition.onresult = handleResult;
      
      recognition.onerror = (event: any) => {
        console.error("Recognition error:", event.error, event);
        
        if (event.error === 'no-speech') {
          setFeedback("No speech detected. Please speak louder or check your microphone.");
        } else if (event.error === 'not-allowed') {
          setFeedback("Microphone access denied. Please allow microphone access to use voice practice.");
        } else if (event.error === 'language-not-supported') {
          setFeedback(`Speech recognition for ${userLanguage} may not be fully supported in your browser.`);
        } else {
          setFeedback("Error during voice recognition. Please try again.");
        }
        
        setTimeout(() => {
          setIsListening(false);
        }, 1000);
      };
      
      recognition.onend = () => {
        console.log("Voice recognition ended");
        setIsListening(false);
      };
      
      if (difficulty === 'easy') {
        let hasDetectedWord = false;
        let wordTimerId: NodeJS.Timeout | null = null;
        
        const easyModeResultHandler = (event: any) => {
          handleResult(event);
          
          if (!hasDetectedWord && userRecordingRef.current) {
            hasDetectedWord = true;
            
            if (wordTimerId) clearTimeout(wordTimerId);
            wordTimerId = setTimeout(() => {
              if (isListening && userRecordingRef.current) {
                console.log("Auto-submitting after recognizing word");
                stopListening();
              }
            }, 1200);
          }
        };
        
        recognition.onresult = easyModeResultHandler;
      }
      
      recognition.addEventListener('end', () => {
        if (isListening && difficulty !== 'easy') {
          try {
            recognition.start();
            console.log("Automatically restarted recognition");
          } catch (e) {
            console.error("Could not restart recognition:", e);
          }
        }
      });
      
      recognition.start();
    } catch (error) {
      console.error("Error starting speech recognition:", error);
      setIsListening(false);
      setFeedback("Something went wrong with the microphone. Please try again.");
    }
  };

  const stopListening = () => {
    console.log("Stopping speech recognition...");
    
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
        console.log("Recognition stopped successfully");
      } catch (e) {
        console.error("Error stopping recognition:", e);
      }
    }
    
    const currentRecording = userRecordingRef.current || userRecording;
    
    console.log("Final recording value:", currentRecording);
    
    if (currentRecording) {
      submitForScoring(currentRecording);
    } else {
      setFeedback("No speech detected. Please try again.");
    }
    
    setIsListening(false);
  };

  const handleMouseDown = () => {
    startListening();
  };
  
  const handleMouseUp = () => {
    stopListening();
  };
  
  const handleTouchStart = (e: React.TouchEvent) => {
    e.preventDefault(); 
    handleMouseDown();
  };
  
  const handleTouchEnd = (e: React.TouchEvent) => {
    e.preventDefault();
    handleMouseUp();
  };

  const resetPracticeState = (keepSentence: boolean = false) => {
    setUserRecording(null);
    userRecordingRef.current = null;
    setPronunciationScore(null);
    setFeedback(null);
    
    if (!keepSentence) {
      setTranslation(null);
      setShowTranslation(false);
    }
  };

  const submitForScoring = async (recording: string) => {
    if (!practiceSentence) {
      console.error("No practice sentence available for scoring");
      setFeedback("No practice sentence available. Please try again.");
      return null;
    }
    
    if (!recording || recording.trim() === '') {
      console.error("No recording provided for scoring");
      setFeedback("No speech detected. Please try recording again.");
      return null;
    }
    
    console.log("Starting scoring process for:", recording);
    console.log("Target sentence:", practiceSentence.text);
    console.log("User language:", userLanguage);
    
    try {
      setIsLoading(true);
      setFeedback("Analyzing your pronunciation...");
      
      let processedRecording = recording;
      let referenceText = practiceSentence.text;
      let exactMatchFound = false;
      
      if (difficulty === 'easy') {
        processedRecording = recording.toLowerCase().trim();
        referenceText = practiceSentence.text.toLowerCase().trim();
        
        const words = processedRecording.split(/\s+/);
        
        exactMatchFound = words.some(word => word === referenceText);
        console.log(`Exact match found: ${exactMatchFound}`);
        
        if (exactMatchFound) {
          processedRecording = referenceText;
        } else {
          const closeMatches = words.filter(w => 
            w.includes(referenceText) || 
            referenceText.includes(w) ||
            w.startsWith(referenceText) ||
            referenceText.startsWith(w)
          );
          
          if (closeMatches.length > 0) {
            processedRecording = closeMatches[0];
            console.log("Using close match for scoring:", processedRecording);
          }
        }
      }
      
      console.log("Calling backend scoring API with processed recording:", processedRecording);
      const response = await fetch('http://localhost:8000/api/score_pronunciation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audio_data: processedRecording,
          reference_text: referenceText,
          language: userLanguage,
          username: user?.email || 'guest',
          difficulty: difficulty,
          sublevel: sublevel,
          is_short_word: difficulty === 'easy',
          allow_partial_match: difficulty === 'easy',
          original_recording: recording,
          exact_match_found: exactMatchFound
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Scoring API returned ${response.status}: ${errorText}`);
        setFeedback("Unable to analyze pronunciation. Please try again later.");
        return null;
      }
      
      const scoreData = await response.json();
      console.log("Backend returned pronunciation score:", scoreData);
      
      if (!scoreData || typeof scoreData.score !== 'number' || !scoreData.feedback) {
        throw new Error("Invalid score data received from backend");
      }
      
      const simplifiedScoreData = {
        score: Math.round(scoreData.score),
        feedback: scoreData.feedback
      };
      
      if (difficulty === 'easy') {
        if (exactMatchFound) {
          console.log("Exact match found, ensuring high score");
          simplifiedScoreData.score = Math.max(simplifiedScoreData.score, 95);
          simplifiedScoreData.feedback = "Excellent! Perfect pronunciation.";
        } 
        else {
          const targetWord = referenceText.toLowerCase();
          const recordedWord = processedRecording.toLowerCase();
          
          if (simplifiedScoreData.score < 80) {
            let shouldBoost = false;
            let boostAmount = 0;
            
            if (["zh-CN", "zh-TW", "ja", "ko"].includes(userLanguage)) {
              if (targetWord.length === 1 && recordedWord.includes(targetWord)) {
                shouldBoost = true;
                boostAmount = 30;
              } else if (targetWord.length > 1) {
                let matchedChars = 0;
                for (let char of targetWord) {
                  if (recordedWord.includes(char)) matchedChars++;
                }
                
                const matchRatio = matchedChars / targetWord.length;
                if (matchRatio >= 0.7) {
                  shouldBoost = true;
                  boostAmount = 35;
                } else if (matchRatio >= 0.5) {
                  shouldBoost = true;
                  boostAmount = 25;
                }
              }
            } 
            else {
              if (targetWord.includes(recordedWord) && recordedWord.length >= targetWord.length * 0.7) {
                shouldBoost = true;
                boostAmount = 35;
              } else if (recordedWord.includes(targetWord)) {
                shouldBoost = true;
                boostAmount = 30;
              }
              else if (targetWord.startsWith(recordedWord) || recordedWord.startsWith(targetWord)) {
                const matchLength = Math.min(targetWord.length, recordedWord.length);
                if (matchLength >= 2 && matchLength >= targetWord.length * 0.6) {
                  shouldBoost = true;
                  boostAmount = 25;
                }
              }
            }
            
            if (shouldBoost) {
              console.log(`Boosting score for partial match by ${boostAmount}`);
              simplifiedScoreData.score = Math.min(90, simplifiedScoreData.score + boostAmount);
              
              if (simplifiedScoreData.score >= 80) {
                simplifiedScoreData.feedback = "Great job! Very good pronunciation.";
              } else {
                simplifiedScoreData.feedback = "Good attempt! Your pronunciation is close.";
              }
            }
          }
        }
      }
      
      setPronunciationScore(simplifiedScoreData);
      
      if (user?.email) {
        setPracticeHistory(prev => [
          ...prev, 
          {
            sentence: practiceSentence.text, 
            score: simplifiedScoreData.score, 
            date: new Date().toISOString(),
            language: userLanguage,
            difficulty: practiceSentence.difficulty,
            sublevel: sublevel
          }
        ]);
        
        try {
          const historyKey = `practiceHistory_${user.email}`;
          const currentHistory = JSON.parse(localStorage.getItem(historyKey) || '[]');
          const newEntry = {
            sentence: practiceSentence.text,
            score: simplifiedScoreData.score,
            date: new Date().toISOString(),
            language: userLanguage,
            difficulty: practiceSentence.difficulty,
            sublevel: sublevel
          };
          currentHistory.push(newEntry);
          const trimmedHistory = currentHistory.slice(-50);
          localStorage.setItem(historyKey, JSON.stringify(trimmedHistory));
        } catch (storageError) {
          console.warn("Could not save to localStorage:", storageError);
        }
      }
      
      return simplifiedScoreData;
    } catch (error) {
      console.error("Error in scoring process:", error);
      setFeedback("Sorry, there was a problem analyzing your pronunciation. Please try again.");
      return null;
    } finally {
      setIsLoading(false);
      setTimeout(() => {
        if (feedback === "Analyzing your pronunciation...") {
          setFeedback(null);
        }
      }, 1000);
    }
  };

const playAudio = async (type: 'sentence' | 'recording', audioUrl?: string) => {
  if (isPlaying === type) {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsPlaying(null);
    return;
  }
  
  if (audioRef.current) {
    audioRef.current.pause();
    audioRef.current = null;
  }
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  
  setIsLoadingAudio(true);
  setIsPlaying(type);
  
  try {
    const text = practiceSentence?.text || "";
    if (!text) {
      setIsLoadingAudio(false);
      setIsPlaying(null);
      return;
    }
    
    await playEnhancedMessageAudio(text);
    
  } catch (error) {
    console.error("Audio playback error:", error);
    setIsPlaying(null);
    setIsLoadingAudio(false);
  }
};

const playEnhancedMessageAudio = async (text: string) => {
  try {
    console.log(`Generating enhanced audio for: "${text.substring(0, 30)}..."`);
    
    const backendSuccess = await tryBackendTTS(text);
    if (!backendSuccess) {
      console.log("Backend TTS failed, falling back to browser TTS");
      await playOptimizedBrowserTTS(text, userLanguage);
    }
  } catch (error) {
    console.error('All audio methods failed:', error);
    setIsPlaying(null);
    setIsLoadingAudio(false);
  }
};

const tryBackendTTS = async (text: string): Promise<boolean> => {
  try {
    console.log(`Generating audio via backend for: "${text.substring(0, 30)}..."`);
    
    const getLanguageForTTS = (lang: string): string => {
      const languageMap: Record<string, string> = {
        'en': 'en',
        'ja': 'ja',
        'ko': 'ko',
        'ko-KR': 'ko', 
        'zh-CN': 'zh-CN',
        'zh-TW': 'zh-TW',
        'es': 'es',
        'fr': 'fr',
        'it': 'it',
        'de': 'de',
        'hi': 'hi'
      };
      return languageMap[lang] || 'en';
    };

    const ttsLanguage = getLanguageForTTS(userLanguage);
    
    const voiceConfig: Record<string, any> = {
      'en': { voice_type: 'neural', model: 'en-US-Neural2-F' },
      'ja': { voice_type: 'neural', model: 'ja-JP-Neural2-B' },
      'ko-KR': { voice_type: 'neural', model: 'ko-KR-Neural2-A' },
      'zh-CN': { voice_type: 'neural', model: 'cmn-CN-Neural2-A' },
      'zh-TW': { voice_type: 'neural', model: 'cmn-TW-Neural2-A' },
      'es': { voice_type: 'neural', model: 'es-ES-Neural2-A' },
      'fr': { voice_type: 'neural', model: 'fr-FR-Neural2-A' },
      'it': { voice_type: 'neural', model: 'it-IT-Neural2-A' },
      'de': { voice_type: 'neural', model: 'de-DE-Neural2-B' },
      'hi': { voice_type: 'neural', model: 'hi-IN-Neural2-A' }
    };

    const config = voiceConfig[ttsLanguage] || { voice_type: 'neural' };
    
    console.log(`Using TTS language: ${ttsLanguage}`);
    console.log(`Voice config:`, config);
    
    const response = await fetch('http://localhost:8000/api/generate_audio', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: text,
        language: ttsLanguage,
        use_optimized: true,
        debug: true,
        ...config
      }),
    });
    
    console.log(`Backend TTS response status: ${response.status}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log("Backend TTS response data:", data);
      
      if (data.audio_url) {
        const fullAudioUrl = `http://localhost:8000${data.audio_url}`;
        console.log(`Audio URL from backend: ${fullAudioUrl}`);
        
        const audio = new Audio();
        
        audio.addEventListener('canplaythrough', () => {
          setIsLoadingAudio(false);
        });
        
        audio.addEventListener('ended', () => {
          console.log('Backend TTS playback completed');
          setIsPlaying(null);
          audioRef.current = null;
        });
        
        audio.addEventListener('error', (e) => {
          console.error('Backend TTS playback failed:', e);
          setIsPlaying(null);
          audioRef.current = null;
          setIsLoadingAudio(false);
          return false;
        });
        
        audioRef.current = audio;
        audio.src = fullAudioUrl;
        audio.load();
        
        try {
          await audio.play();
          console.log("Backend TTS audio playing successfully");
          return true;
        } catch (playError) {
          console.error("Backend TTS play error:", playError);
          audioRef.current = null;
          return false;
        }
      } else {
        console.error("Backend TTS response missing audio_url:", data);
        return false;
      }
    } else {
      try {
        const errorData = await response.text();
        console.error(`Backend TTS failed (${response.status}):`, errorData);
      } catch (e) {
        console.error(`Backend TTS failed with status: ${response.status}`);
      }
      return false;
    }
  } catch (error) {
    console.error('Backend TTS error:', error);
    return false;
  }
};

const playOptimizedBrowserTTS = async (text: string, language: string): Promise<boolean> => {
  return new Promise((resolve) => {
    try {
      if (!window.speechSynthesis) {
        console.log("Speech synthesis not available");
        setIsPlaying(null);
        setIsLoadingAudio(false);
        resolve(false);
        return;
      }
      
      console.log(`Playing browser TTS: "${text.substring(0, 30)}..."`);
      
      const normalizedLanguage = 
        language === 'ko' ? 'ko-KR' : 
        language === 'ja' ? 'ja-JP' : 
        language;
        
      console.log(`Using normalized language for browser TTS: ${normalizedLanguage}`);
      
      window.speechSynthesis.cancel();
      
      const utterance = new SpeechSynthesisUtterance(text);
      
      let voices = window.speechSynthesis.getVoices();
      
      if (voices.length === 0) {
        console.log("No voices available yet, waiting for voices to load...");
        
        setTimeout(() => {
          voices = window.speechSynthesis.getVoices();
          console.log(`After waiting, found ${voices.length} voices`);
          continueWithVoices(voices);
        }, 100);
      } else {
        console.log(`Found ${voices.length} voices immediately`);
        continueWithVoices(voices);
      }
      
      function continueWithVoices(voices: SpeechSynthesisVoice[]) {
        const languageConfig = {
          'en': {
            locale: 'en-US',
            preferredVoices: [
              'Google US English Female', 'Microsoft Zira', 'Samantha'
            ],
            rate: difficulty === 'easy' ? 0.85 : 0.95,
            pitch: 1.0
          },
          'ja': {
            locale: 'ja-JP',
            preferredVoices: [
              'Google 日本語', 'Microsoft Haruka', 'Kyoko'
            ],
            rate: difficulty === 'easy' ? 0.75 : 0.85,
            pitch: 1.05
          },
          'ja-JP': {
            locale: 'ja-JP',
            preferredVoices: [
              'Google 日本語', 'Microsoft Haruka', 'Kyoko'
            ],
            rate: difficulty === 'easy' ? 0.75 : 0.85,
            pitch: 1.05
          },
          'zh-CN': {
            locale: 'zh-CN',
            preferredVoices: [
              'Google 普通话（中国大陆）', 'Microsoft Yaoyao', 'Tingting'
            ],
            rate: difficulty === 'easy' ? 0.75 : 0.85,
            pitch: 1.0
          },
          'zh-TW': {
            locale: 'zh-TW',
            preferredVoices: [
              'Google 國語（臺灣）', 'Microsoft Hanhan', 'Meijia'
            ],
            rate: difficulty === 'easy' ? 0.75 : 0.85,
            pitch: 1.0
          },
          'ko': {
            locale: 'ko-KR',
            preferredVoices: [
              'Google 한국어', 'Microsoft Heami', 'Yuna'
            ],
            rate: difficulty === 'easy' ? 0.70 : 0.80,
            pitch: 1.0
          },
          'ko-KR': {
            locale: 'ko-KR',
            preferredVoices: [
              'Google 한국어', 'Microsoft Heami', 'Yuna'
            ],
            rate: difficulty === 'easy' ? 0.70 : 0.80,
            pitch: 1.0
          },
          'es': {
            locale: 'es-ES',
            preferredVoices: [
              'Google español', 'Microsoft Helena', 'Monica'
            ],
            rate: difficulty === 'easy' ? 0.82 : 0.92,
            pitch: 1.0
          },
          'fr': {
            locale: 'fr-FR',
            preferredVoices: [
              'Google français', 'Microsoft Julie', 'Amelie'
            ],
            rate: difficulty === 'easy' ? 0.82 : 0.9,
            pitch: 1.0
          },
          'it': {
            locale: 'it-IT',
            preferredVoices: [
              'Google italiano', 'Microsoft Elsa', 'Alice'
            ],
            rate: difficulty === 'easy' ? 0.82 : 0.9,
            pitch: 1.0
          },
          'de': {
            locale: 'de-DE',
            preferredVoices: [
              'Google Deutsch', 'Microsoft Hedda', 'Anna'
            ],
            rate: difficulty === 'easy' ? 0.80 : 0.9,
            pitch: 0.95
          },
          'hi': {
            locale: 'hi-IN',
            preferredVoices: [
              'Google हिन्दी', 'Microsoft Heera', 'Lekha'
            ],
            rate: difficulty === 'easy' ? 0.75 : 0.85,
            pitch: 1.05
          }
        };
        
        const config = languageConfig[language as keyof typeof languageConfig] || {
          locale: language,
          preferredVoices: [],
          rate: difficulty === 'easy' ? 0.8 : 0.9,
          pitch: 1.0
        };
        
        console.log(`Looking for voices matching ${config.locale}`);
        const matchingVoices = voices.filter(v => 
          v.lang.toLowerCase().startsWith(config.locale.toLowerCase().split('-')[0])
        );
        
        console.log(`Found ${matchingVoices.length} matching voices:`, 
          matchingVoices.map(v => `${v.name} (${v.lang}${v.localService ? ', local' : ', network'})`)
        );
        
        let selectedVoice: SpeechSynthesisVoice | null = null;
        
        if (config.preferredVoices.length > 0) {
          selectedVoice = voices.find(voice => 
            voice.lang.toLowerCase().startsWith(config.locale.toLowerCase().split('-')[0]) && 
            config.preferredVoices.some(preferred => 
              voice.name.includes(preferred)
            )
          ) || null;
        }
        
        if (!selectedVoice) {
          selectedVoice = voices.find(voice => 
            voice.lang.toLowerCase().startsWith(config.locale.toLowerCase().split('-')[0]) && 
            voice.name.includes('Google')
          ) || null;
        }
        
        if (!selectedVoice) {
          selectedVoice = voices.find(voice => 
            voice.lang.toLowerCase().startsWith(config.locale.toLowerCase().split('-')[0]) && 
            (voice.name.toLowerCase().includes('female') || 
            voice.name.includes('Samantha') || voice.name.includes('Karen') ||
            voice.name.includes('Kyoko') || voice.name.includes('Ting-Ting') ||
            voice.name.includes('Yuna') || voice.name.includes('Monica'))
          ) || null;
        }
        
        if (!selectedVoice) {
          selectedVoice = matchingVoices.length > 0 ? matchingVoices[0] : null;
        }
        
        if (!selectedVoice && voices.length > 0) {
          selectedVoice = voices[0];
          console.warn(`No matching voice found for ${language}. Using default voice.`);
        }
        
        if (!selectedVoice) {
          console.error(`No voices available at all for ${language}`);
          setIsPlaying(null);
          setIsLoadingAudio(false);
          resolve(false);
          return;
        }
        
        console.log(`Selected voice: ${selectedVoice.name} (${selectedVoice.lang})`);
        utterance.voice = selectedVoice;
        utterance.lang = selectedVoice.lang;
        utterance.rate = config.rate;
        utterance.pitch = config.pitch;
        utterance.volume = 1.0;
        
        utterance.onstart = () => {
          setIsLoadingAudio(false);
        };
        
        utterance.onend = () => {
          console.log(`TTS playback ended for ${language}`);
          setIsPlaying(null);
          resolve(true);
        };
        
        utterance.onerror = (event) => {
          console.error('Browser TTS error:', event);
          setIsPlaying(null);
          setIsLoadingAudio(false);
          resolve(false);
        };
        
        if (/iPhone|iPad|iPod|Safari/.test(navigator.userAgent) && !(/Chrome/.test(navigator.userAgent))) {
          setTimeout(() => {
            window.speechSynthesis.speak(utterance);
          }, 100);
        } else {
          window.speechSynthesis.speak(utterance);
          
          if (/Chrome/.test(navigator.userAgent)) {
            const resumeInfinity = setInterval(() => {
              if (!window.speechSynthesis.speaking) {
                clearInterval(resumeInfinity);
                return;
              }
              window.speechSynthesis.pause();
              window.speechSynthesis.resume();
            }, 10000);
          }
        }
      }
    } catch (error) {
      console.error('Browser TTS error:', error);
      setIsPlaying(null);
      setIsLoadingAudio(false);
      resolve(false);
    }
  });
};

const changeDifficulty = async (newDifficulty: 'easy' | 'medium' | 'hard') => {
  if (newDifficulty !== difficulty) {
    resetPracticeState(false); 
    setDifficulty(newDifficulty);
    
    setUsedWords(new Set());
    
    try {
      localStorage.setItem('practiceDifficulty', newDifficulty);
      localStorage.setItem('practiceSublevel', '1');
      setSublevel(1);
    } catch (e) {
      console.error("Error saving settings to localStorage:", e);
    }
    
    await generateNewPracticeSentence(userLanguage, newDifficulty, 1);
  }
};

useEffect(() => {
  if (userLanguage) {
    setUsedWords(new Set());
  }
}, [userLanguage]);

  const translateSentence = async () => {
    if (!practiceSentence) {
      return;
    }
    
    if (showTranslation) {
      setShowTranslation(false);
      return;
    }
    
    try {
      setIsTranslating(true);
      
      if (translation) {
        setShowTranslation(true);
        setIsTranslating(false);
        return;
      }
      
      const response = await fetch('http://localhost:8000/api/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: practiceSentence.text,
          source_language: userLanguage,
          target_language: 'en',
          quality: 'high',
          prefer_native: true
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Translation failed with status ${response.status}`);
      }
      
      const data = await response.json();
      console.log("Translation result:", data);
      
      if (data && data.translated_text) {
        setTranslation(data.translated_text);
        setShowTranslation(true);
      } else {
        throw new Error("Invalid translation response");
      }
    } catch (error) {
      console.error("Error translating sentence:", error);
      setTranslation("Translation unavailable");
      setShowTranslation(true);
    } finally {
      setIsTranslating(false);
    }
  };

  const navigateToDashboard = () => {
    router.push('/dashboard');
    setShowProfileMenu(false);
  };

  const handleBackClick = () => {
    router.push('/choose');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-teal-500 mx-auto mb-4"></div>
          <p className="text-xl text-white">Loading...</p>
        </div>
      </div>
    );
  }

return (
  <div className="min-h-screen bg-gray-900 text-black relative"
  style={{
    backgroundImage: "url('/icons/background1.jpg')",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    backgroundAttachment: "fixed"
  }}>
    {/* Profile menu button */}
    <div className="absolute top-8 left-8 z-10" ref={profileMenuRef}>
      <button 
        onClick={() => setShowProfileMenu(!showProfileMenu)}
        className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 transition-colors duration-200 flex items-center justify-center overflow-hidden"
      >
        {user?.photoURL ? (
          <Image
            src={user.photoURL}
            alt="Profile"
            width={40}
            height={40}
            className="object-cover"
          />
        ) : (
          <div className="w-full h-full bg-[#48d1cc] flex items-center justify-center text-white font-semibold text-sm">
            {user?.displayName ? user.displayName.charAt(0).toUpperCase() : 
             user?.email ? user.email.charAt(0).toUpperCase() : "G"}
          </div>
        )}
      </button>
      
      {showProfileMenu && (
        <div className="absolute top-12 left-0 bg-white rounded-lg shadow-lg py-2 min-w-[180px] text-gray-800 z-20">
          <div className="px-4 py-2 border-b border-gray-200">
            <p className="font-medium">{user?.displayName || "Guest"}</p>
            {user?.email && (
              <p className="text-xs text-gray-500">{user.email}</p>
            )}
          </div>
          <div className="px-4 py-2 border-b border-gray-200">
            <div className="flex items-center mt-1">
              <p className="text-xs text-gray-500"> Language: 
                {userLanguage === 'en' ? ' English' : 
                 userLanguage === 'zh-CN' ? ' Chinese (Simplified)' :
                 userLanguage === 'zh-TW' ? ' Chinese (Traditional)' :
                 userLanguage === 'ja' ? ' Japanese' :
                 userLanguage === 'ko' ? ' Korean' :
                 userLanguage === 'es' ? ' Spanish' :
                 userLanguage === 'fr' ? ' French' :
                 userLanguage === 'it' ? ' Italian' :
                 userLanguage === 'de' ? ' German' :
                 userLanguage === 'hi' ? ' Hindi' :
                 userLanguage}
              </p>
            </div>
          </div>
          <button 
                onClick={() => router.push('/help')}
                className="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors flex items-center"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Help
              </button>
          {user ? (
            <div>
              <button 
                onClick={navigateToDashboard}
                className="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors flex items-center"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                Profile Dashboard
              </button>
            </div>
          ) : (
            <button 
              onClick={() => router.push('/')}
              className="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors flex items-center"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
              </svg>
              Sign In
            </button>
          )}
        </div>
      )}
    </div>

    {/* Back button */}
    <button 
      onClick={handleBackClick}
      className="absolute top-8 left-24 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 transition-colors duration-200 flex items-center justify-center"
    >
      <Image
        src="/icons/back.png"
        alt="Back"
        width={24}
        height={24}
      />
    </button>
      
    <main className="max-w-6xl mx-auto pt-24 pb-20 px-4"> 
      <div className="text-center mb-8 mt-2"> 
          <h1 className="text-2xl font-bold text-black mb-2">Pronunciation Practice</h1>
      </div>
      
      {/* Difficulty selection */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <button 
          onClick={() => changeDifficulty('easy')}
          className={`py-3 rounded-lg transition-colors ${
            difficulty === 'easy' 
              ? 'bg-[#20b2aa] text-white' 
              : 'bg-white/30 text-black hover:bg-white/50'
          }`}
        >
          Easy
        </button>
        <button 
          onClick={() => changeDifficulty('medium')}
          className={`py-3 rounded-lg transition-colors ${
            difficulty === 'medium' 
              ? 'bg-[#20b2aa] text-white' 
              : 'bg-white/30 text-black hover:bg-white/50'
          }`}
        >
          Medium
        </button>
        <button 
          onClick={() => changeDifficulty('hard')}
          className={`py-3 rounded-lg transition-colors ${
            difficulty === 'hard' 
              ? 'bg-[#20b2aa] text-white' 
              : 'bg-white/30 text-black hover:bg-white/50'
          }`}
        >
          Hard
        </button>
      </div>

      {/* Sublevel indicator and control */}
      <div className="mb-6 flex flex-col md:flex-row items-center justify-center gap-3">
        <div className="inline-flex items-center bg-white/50 rounded-full px-4 py-2">
          <span className="text-sm font-medium text-black mr-2">Level:</span>
          <span className="font-semibold text-black">
            {difficulty} - {sublevel}/10
          </span>
        </div>
        
        <button
          onClick={() => setShowDifficultySlider(!showDifficultySlider)}
          className="inline-flex items-center bg-[#20b2aa]/80 hover:bg-[#20b2aa] text-white rounded-full px-4 py-2 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
          </svg>
          Adjust Level
        </button>
      </div>

      {/* Difficulty slider */}
      {showDifficultySlider && (
        <div className="mb-6 bg-white/70 backdrop-blur-sm rounded-lg p-4 animate-fadeIn">
          <h3 className="text-center font-medium text-black mb-3">Adjust Difficulty Level</h3>
          <div className="flex flex-col md:flex-row gap-3 items-center justify-center">
            <div className="flex-1 w-full max-w-md">
              <input
                type="range"
                min="1"
                max="10"
                value={sublevel}
                onChange={(e) => {
                  const newLevel = parseInt(e.target.value);
                  setSublevel(newLevel);
                  try {
                    localStorage.setItem('practiceSublevel', newLevel.toString());
                  } catch (e) {
                    console.error("Error saving sublevel to localStorage:", e);
                  }
                }}
                className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-gray-700 px-1 mt-1">
                <span>Easier</span>
                <span>Harder</span>
              </div>
            </div>
            <button
              onClick={() => {
                setShowDifficultySlider(false);
                generateNewPracticeSentence(userLanguage, difficulty, sublevel);
              }}
              className="px-4 py-2 bg-[#20b2aa] text-white rounded-lg"
            >
              Apply
            </button>
          </div>
          
          <div className="mt-3 flex flex-wrap gap-2 justify-center">
            {Array.from({length: 10}, (_, i) => i + 1).map(level => (
              <button
                key={level}
                onClick={() => {
                  setSublevel(level);
                  try {
                    localStorage.setItem('practiceSublevel', level.toString());
                  } catch (e) {
                    console.error("Error saving sublevel to localStorage:", e);
                  }
                }}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                  sublevel === level 
                    ? 'bg-[#20b2aa] text-white' 
                    : 'bg-white/50 text-gray-700 hover:bg-white/70'
                }`}
              >
                {level}
              </button>
            ))}
          </div>
          
          <div className="mt-3 text-center text-sm text-gray-700">
            <p>
              {sublevel <= 3 ? '' :
              sublevel <= 6 ? '' :
              sublevel <= 8 ? '' :
              ''}
            </p>
          </div>
        </div>
      )}
      
      <div className="flex flex-col md:flex-row gap-6 mt-10">
        {/* Left column - Practice content */}
        <div className="flex-1 md:w-1/2">
          <div className="bg-white/70 backdrop-blur-sm rounded-lg p-4 mb-6 animate-fadeIn">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-xl font-semibold text-black">
                {difficulty === 'easy' ? 'Pronounce this word' : 'Practice this sentence'}
              </h2>
              <button 
                onClick={tryAnotherSentence}
                className="flex items-center text-white bg-blue-500 hover:bg-blue-600 rounded-lg px-3 py-1.5 text-sm transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Try Another
              </button>
            </div>
            
            <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
              {isLoading ? (
                <div className="flex justify-center items-center py-6">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-teal-500"></div>
                </div>
              ) : (
                <>
                  <p className="text-2xl text-gray-800 font-medium mb-3">
                    {practiceSentence?.text || "Loading..."}
                  </p>
                  <div className="flex justify-center mt-1 gap-2">
                    <button
                      onClick={() => playAudio('sentence')}
                      className={`flex items-center text-sm px-3 py-1.5 rounded-full transition-colors ${
                        isPlaying === 'sentence' ? 'bg-red-500 text-white' : 'bg-teal-500 hover:bg-teal-600 text-white'
                      }`}
                      disabled={isLoadingAudio}
                    >
                      {isLoadingAudio && isPlaying === 'sentence' ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white mr-1"></div>
                      ) : isPlaying === 'sentence' ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.536a5 5 0 001.414-9.9m-1.414 9.9a9 9 0 010-12.728" />
                        </svg>
                      )}
                      {isPlaying === 'sentence' ? 'Stop' : 'Listen'}
                    </button>
                    {!translation && (
                      <button
                        onClick={translateSentence}
                        className="flex items-center text-sm px-3 py-1.5 rounded-full bg-blue-400 hover:bg-blue-500 text-white transition-colors"
                        disabled={isTranslating}
                      >
                        {isTranslating ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white mr-1"></div>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                          </svg>
                        )}
                        Translate
                      </button>
                    )}
                    {translation && (
                      <button
                        onClick={translateSentence}
                        className={`flex items-center text-sm px-3 py-1.5 rounded-full transition-colors ${
                          showTranslation ? 'bg-gray-500 text-white' : 'bg-blue-400 hover:bg-blue-500 text-white'
                        }`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                        </svg>
                        {showTranslation ? 'Hide Translation' : 'Show Translation'}
                      </button>
                    )}
                  </div>
                </>
              )}
              
              {showTranslation && translation && (
                <div className="mt-3 pt-3 border-t border-gray-300 animate-fadeIn">
                  <p className="italic text-gray-700">
                    "{translation}"
                  </p>
                </div>
              )}
            </div>
            
            <div className="flex items-center justify-center mt-3">
              <span className="text-sm bg-black/30 px-2 py-0.5 rounded-full text-white">
                {difficulty} • Level {sublevel}/10
              </span>
            </div>
          </div>
        </div>
        
        {/* Right column - Results */}
        <div className="flex-1 md:w-1/2">
          {pronunciationScore ? (
            <div className="bg-white/70 backdrop-blur-sm rounded-lg p-4 mb-6 animate-fadeIn">
              <h3 className="text-lg font-medium mb-3 text-center text-black">Your Result</h3>
              
              <div className="flex items-center justify-center mb-4">
                <div 
                  className={`w-24 h-24 rounded-full flex items-center justify-center text-2xl font-bold border-4 ${
                    pronunciationScore.score >= 90 ? 'border-green-500 text-green-600 bg-green-100' :
                    pronunciationScore.score >= 70 ? 'border-blue-500 text-blue-600 bg-blue-100' :
                    pronunciationScore.score >= 50 ? 'border-yellow-500 text-yellow-600 bg-yellow-100' :
                    'border-red-500 text-red-600 bg-red-100'
                  }`}
                >
                  {pronunciationScore.score}%
                </div>
              </div>
              
              <p className="text-center text-black mb-3">
                {pronunciationScore.feedback}
              </p>
              
              <div className="flex justify-center gap-3">
                <button
                  onClick={() => resetPracticeState(true)}
                  className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors text-sm"
                >
                  Try Again
                </button>
                <button
                  onClick={tryAnotherSentence}
                  className="px-3 py-1.5 bg-teal-500 hover:bg-teal-600 text-white rounded-lg transition-colors text-sm"
                >
                  Next Practice
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white/70 backdrop-blur-sm rounded-lg p-4 h-[280px] mb-6 flex flex-col items-center justify-center">
              <div className="text-center mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
        
    {/* Record button */}
    <div className="fixed bottom-16 left-0 right-0 flex justify-center px-4">
      <div className="rounded-full p-1.5 bg-white/10 backdrop-blur-sm shadow-lg flex justify-center">
        <button
          className={`h-20 w-20 rounded-full flex items-center justify-center transition-all ${
            isListening ? 'bg-red-500 scale-110' : 
            isLoading ? 'bg-gray-400 cursor-not-allowed' : 'bg-teal-500 hover:bg-teal-600'
          }`}
          onMouseDown={!isLoading ? handleMouseDown : undefined}
          onMouseUp={!isLoading ? handleMouseUp : undefined}
          onTouchStart={!isLoading ? handleTouchStart : undefined}
          onTouchEnd={!isLoading ? handleTouchEnd : undefined}
          disabled={isLoading}
        >
          {isLoading ? (
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-white"></div>
          ) : isListening ? (
            <div className="animate-pulse">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          )}
        </button>
      </div>
    </div>
    
    {/* Status indicator */}
    <div className="fixed bottom-4 left-0 right-0 flex justify-center px-4 pointer-events-none">
      <div className="bg-white/70 backdrop-blur-sm text-black px-4 py-2 rounded-full text-sm shadow-lg">
        {isListening ? (
          <span className="flex items-center">
            <span className="relative flex h-3 w-3 mr-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
            </span>
            Listening... Keep holding the button while speaking
          </span>
        ) : isLoading ? (
          <span className="flex items-center">
            <div className="animate-spin rounded-full h-3 w-3 border-t-2 border-b-2 border-gray-700 mr-2"></div>
            {feedback || "Processing..."}
          </span>
        ) : feedback ? (
          <span>{feedback}</span>
        ) : (
          <span className="flex items-center">
            <span className="h-3 w-3 mr-2 bg-green-500 rounded-full"></span>
            Press and hold to start speaking
          </span>
        )}
      </div>
    </div>
  </div>
);
}
export default VoicePracticePage;