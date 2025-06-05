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
  const [feedback, setFeedback] = useState<string | null>(null);
  const [practiceHistory, setPracticeHistory] = useState<Array<{sentence: string, score: number}>>([]);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const userRecordingRef = useRef<string | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState<boolean>(false);

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
      
      await generateNewPracticeSentence(savedLocale, 'easy');
      
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
      
      // Get voices
      const getVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
          console.log(`Loaded ${voices.length} voices`);
          
          if (userLanguage) {
            // Find voices for user's language
            const langPrefix = userLanguage.split('-')[0].toLowerCase();
            const matchingVoices = voices.filter(v => 
              v.lang.toLowerCase().startsWith(langPrefix) || 
              (userLanguage.startsWith('zh') && v.lang.toLowerCase().includes('zh'))
            );
            
            console.log(`Found ${matchingVoices.length} voices for ${userLanguage}`);
            
            // Log the voices we found
            matchingVoices.forEach((v, i) => {
              console.log(`${i+1}. ${v.name} (${v.lang}) - ${v.localService ? 'Local' : 'Network'}`);
            });
            
            // Force use of a native voice for current language
            if (matchingVoices.length > 0) {
              // Pre-load the voice by speaking silently with it
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
      
      // Initial load
      getVoices();
      
      // Chrome and Firefox handle voice loading differently
      window.speechSynthesis.onvoiceschanged = getVoices;
      
      // Initialize with silent utterance (helps on Safari/iOS)
      setTimeout(() => {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        window.speechSynthesis.speak(u);
      }, 500);
      
      // Additional delay initialization for some browsers
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
        
        // Try to trigger voice loading for specific language
        const u = new SpeechSynthesisUtterance('test');
        u.lang = langCode;
        u.volume = 0;
        
        // Force voice loading then cancel
        window.speechSynthesis.speak(u);
        setTimeout(() => window.speechSynthesis.cancel(), 100);
        
        // Get available voices
        const voices = window.speechSynthesis.getVoices();
        const matchingVoices = voices.filter(v => 
          v.lang.toLowerCase().startsWith(langCode.toLowerCase().split('-')[0])
        );
        
        // Log voice information
        console.log(`Available voices (${voices.length}):`);
        console.log(`Matching voices for ${langCode} (${matchingVoices.length}):`);
        matchingVoices.forEach((v, i) => {
          console.log(`${i+1}. ${v.name} (${v.lang}) - ${v.localService ? 'Local' : 'Network'}`);
        });
        
        // Set timeout to check again after voices may have loaded, but return initial results immediately
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

  const generateNewPracticeSentence = async (language: string, difficulty: 'easy' | 'medium' | 'hard') => {
    try {
      setIsLoading(true);
      setPronunciationScore(null);
      setFeedback(null);
      setTranslation(null);
      setShowTranslation(false);
      
      const contentType = difficulty === 'easy' ? 'word' : 'sentence';
      console.log(`Requesting ${difficulty} ${contentType} in ${language}`);

      let recentWords: string[] = [];
      try {
        const storedRecent = localStorage.getItem(`recentWords_${language}_${difficulty}`);
        if (storedRecent) {
          recentWords = JSON.parse(storedRecent);
        }
      } catch (e) {
        console.error("Error reading from localStorage:", e);
      }

      const timestamp = new Date().getTime();
      const randomToken = Math.random().toString(36).substring(2, 15) + timestamp;
      
      try {
        const response = await fetch('http://localhost:8000/api/generate_practice_sentence', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
          },
          body: JSON.stringify({
            language: language,
            difficulty: difficulty,
            username: username,
            content_type: contentType,
            randomize: true,
            force_variety: true,
            timestamp: timestamp,
            token: randomToken,
            exclude: recentWords,
            frequency: difficulty === 'easy' ? "high" : "any",
            seed: Math.floor(Math.random() * 1000000), 
            max_retries: 3 
          }),
        });
        
        console.log("API request sent for language:", language, "content_type:", contentType);
        
        if (response.ok) {
          const data = await response.json();
          console.log("Backend returned practice content:", data);
          
          if (difficulty === 'easy' && data.text && !recentWords.includes(data.text)) {
            recentWords.push(data.text);
            if (recentWords.length > 15) recentWords.shift(); 
            
            try {
              localStorage.setItem(`recentWords_${language}_${difficulty}`, JSON.stringify(recentWords));
            } catch (e) {
              console.error("Error writing to localStorage:", e);
            }
          }
          
          setPracticeSentence(data);
          return data;
        } else {
          const errorText = await response.text();
          console.warn(`API returned ${response.status}: ${errorText}. Trying alternative approach.`);
          throw new Error(`Failed to fetch practice content: ${response.status}`);
        }
      } catch (apiError) {
        console.error("Primary API endpoint error:", apiError);
        throw apiError;
      }
      
    } catch (error) {
      console.error("Error with primary API endpoint:", error);
      
      try {
        console.log("Attempting alternative word generation endpoint...");
        
        const response = await fetch('http://localhost:8000/api/generate_varied_word', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          },
          body: JSON.stringify({
            language: userLanguage,
            seed: new Date().getTime() + Math.random() * 1000,
            exclude_previous: true,
            variety_boost: true
          }),
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log("Alternative API returned content:", data);
          setPracticeSentence(data);
          return data;
        } else {
          throw new Error("Alternative API failed");
        }
      } catch (retryError) {
        console.error("All API attempts failed:", retryError);
        setFeedback("Unable to connect to language server. Please try again later.");
        
        const errorState = {
          text: "Loading error. Please try again.",
          difficulty: difficulty
        };
        
        setPracticeSentence(errorState);
        return errorState;
      }
    } finally {
      setIsLoading(false);
    }
  };

  const tryAnotherSentence = async () => {
    resetPracticeState(false);
    
    const currentText = practiceSentence?.text;
    
    try {
      const timestamp = new Date().getTime();
      
      const response = await fetch('http://localhost:8000/api/generate_practice_sentence', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        },
        body: JSON.stringify({
          language: userLanguage,
          difficulty: difficulty,
          content_type: difficulty === 'easy' ? 'word' : 'sentence',
          username: username,
          force_new: true,
          exclude: [currentText], // Explicitly exclude current text
          timestamp: timestamp,
          random_seed: Math.random() * 100000,
          unique_request: true // Add flag to request unique content
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log("Received new content:", data);
        
        // Only accept if it's different from current text
        if (data.text !== currentText) {
          setPracticeSentence(data);
          return;
        } else {
          console.log("Got same content, trying fallback method");
        }
      }
      
      // If we didn't return above, use the regular function with strong randomization
      await generateNewPracticeSentence(userLanguage, difficulty);
      
      // If we still got the same content, force a different result
      if (currentText === practiceSentence?.text) {
        // Add a small delay to help with backend caching
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Try once more with a totally different approach
        const fallbackResponse = await fetch('http://localhost:8000/api/generate_varied_word', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            language: userLanguage,
            current_text: currentText,
            force_different: true,
            timestamp: new Date().getTime()
          }),
        });
        
        if (fallbackResponse.ok) {
          const data = await fallbackResponse.json();
          if (data.text !== currentText) {
            setPracticeSentence(data);
          }
        }
      }
    } catch (error) {
      console.error("Error trying another sentence:", error);
      setFeedback("Error fetching new content. Please try again.");
    }
  };

  const testTranslationAPI = async () => {
    try {
      console.log("Testing translation API...");
      const response = await fetch('http://localhost:8000/api/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: practiceSentence?.text || "Hello, this is a test.",
          source_language: 'en',
          target_language: 'es'
        }),
      });
      
      const data = await response.json();
      console.log("Translation API test result:", data);
      return data;
    } catch (error) {
      console.error("Translation API test failed:", error);
      return null;
    }
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
            difficulty: practiceSentence.difficulty
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
            difficulty: practiceSentence.difficulty
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

// Replace the playAudio function with this cleaner version
const playAudio = async (type: 'sentence' | 'recording', audioUrl?: string) => {
  // If already playing, stop it
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
  
  // Stop any current playback
  if (audioRef.current) {
    audioRef.current.pause();
    audioRef.current = null;
  }
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  
  // Set loading and playing state
  setIsLoadingAudio(true);
  setIsPlaying(type);
  
  try {
    // Get the text to speak
    const text = practiceSentence?.text || "";
    if (!text) {
      setIsLoadingAudio(false);
      setIsPlaying(null);
      return;
    }
    
    // Use the existing URL if available
    if (audioUrl || practiceSentence?.audio_url) {
      const url = audioUrl || practiceSentence?.audio_url;
      const fullUrl = url?.startsWith('http') ? url : `http://localhost:8000${url}`;
      
      try {
        const audio = new Audio(fullUrl);
        audioRef.current = audio;
        
        audio.addEventListener('ended', () => {
          setIsPlaying(null);
          setIsLoadingAudio(false);
          audioRef.current = null;
        });
        
        audio.addEventListener('error', () => {
          // Fall through to backend TTS
          generateAndPlayTTS(text);
        });
        
        await audio.play();
        setIsLoadingAudio(false);
        return;
      } catch (e) {
        console.error("Error playing audio from URL:", e);
        // Fall through to backend TTS
      }
    }
    
    // Generate and play TTS
    await generateAndPlayTTS(text);
    
  } catch (error) {
    console.error("Audio playback error:", error);
    setIsPlaying(null);
    setIsLoadingAudio(false);
  }
};

const generateAndPlayTTS = async (text: string) => {
  try {
    // Enhanced voice models with more natural-sounding options for each language
    const voiceParams: Record<string, { voice_type: string, model?: string, voice_id?: string, ssml_gender?: string }> = {
      'en': { 
        voice_type: 'neural', 
        model: 'en-US-Neural2-F', 
        voice_id: 'en-US-JennyNeural',
        ssml_gender: 'FEMALE'
      },
      'ja': { 
        voice_type: 'neural', 
        model: 'ja-JP-Neural2-C',  // Using Nanami - more natural Japanese
        voice_id: 'ja-JP-NanamiNeural',
        ssml_gender: 'FEMALE' 
      },
      'zh-CN': { 
        voice_type: 'neural', 
        model: 'cmn-CN-Neural2-C',  // Using Xiaoxiao - native-like Mandarin
        voice_id: 'zh-CN-XiaoxiaoNeural',
        ssml_gender: 'FEMALE' 
      },
      'zh-TW': { 
        voice_type: 'neural', 
        model: 'cmn-TW-Neural2-A', 
        voice_id: 'zh-TW-HsiaoChenNeural',
        ssml_gender: 'FEMALE' 
      },
      'ko': { 
        voice_type: 'neural', 
        model: 'ko-KR-Neural2-C',  // Using SoonBok - more natural Korean
        voice_id: 'ko-KR-SunHiNeural',
        ssml_gender: 'FEMALE' 
      },
      'es': { 
        voice_type: 'neural', 
        model: 'es-ES-Neural2-D',  // Using Elvira - native Spanish
        voice_id: 'es-ES-ElviraNeural',
        ssml_gender: 'FEMALE' 
      },
      'fr': { 
        voice_type: 'neural', 
        model: 'fr-FR-Neural2-E',  // Using Denise - authentic French accent
        voice_id: 'fr-FR-DeniseNeural',
        ssml_gender: 'FEMALE' 
      },
      'it': { 
        voice_type: 'neural', 
        model: 'it-IT-Neural2-A', 
        voice_id: 'it-IT-ElsaNeural',
        ssml_gender: 'FEMALE' 
      },
      'de': { 
        voice_type: 'neural', 
        model: 'de-DE-Neural2-F',  // Using Katja - natural German
        voice_id: 'de-DE-KatjaNeural',
        ssml_gender: 'FEMALE' 
      },
      'hi': { 
        voice_type: 'neural', 
        model: 'hi-IN-Neural2-A', 
        voice_id: 'hi-IN-SwaraNeural',
        ssml_gender: 'FEMALE' 
      }
    };
    
    const voiceConfig = voiceParams[userLanguage] || { voice_type: 'neural' };
    
    // Language-specific text processing for more natural speech
    let processedText = text;
    
    // Language-specific text processing
    if (userLanguage === 'zh-CN' || userLanguage === 'zh-TW') {
      // For Chinese, no need to modify very short texts
      if (text.length <= 2) {
        // Keep as is for very short text
      } 
      // For longer Chinese phrases, add slight pauses
      else if (text.length <= 5) {
        processedText = text.split('').join(' ');
      }
    } 
    else if (userLanguage === 'ja') {
      // For Japanese single characters or very short texts
      if (text.length <= 2) {
        // Add です for isolated characters to make pronunciation clearer
        processedText = text + 'です';
      }
      // For short phrases, slow down slightly
      else if (text.length <= 5) {
        // Adding slight spaces helps with clarity in browser TTS
        processedText = text.split('').join(' ');
      }
    }
    else if (userLanguage === 'ko') {
      // Korean benefits from slightly slower speech for learning
      if (text.length <= 3) {
        // Adding 요 for very short phrases helps with pronunciation
        if (!text.endsWith('요')) {
          processedText = text + '요';
        }
      }
    }
    
    console.log(`Generating audio for "${processedText}" in ${userLanguage} with ${voiceConfig.model || 'default model'}`);
    
    // Call backend TTS API with enhanced parameters
    const response = await fetch('http://localhost:8000/api/generate_audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: processedText,
        language: userLanguage,
        priority: 'quality',
        use_native: true,
        natural_speed: difficulty !== 'easy', // Use slower speed for 'easy' mode
        optimize_clarity: difficulty === 'easy', // Optimize for clarity in 'easy' mode
        ...voiceConfig
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      
      if (data.audio_url) {
        const audioUrl = `http://localhost:8000${data.audio_url}`;
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        
        audio.addEventListener('ended', () => {
          setIsPlaying(null);
          setIsLoadingAudio(false);
          audioRef.current = null;
        });
        
        audio.addEventListener('error', (e) => {
          console.log("Backend audio failed, falling back to browser TTS:", e);
          playBrowserTTS(text);
        });
        
        await audio.play();
        setIsLoadingAudio(false);
        return;
      }
    } else {
      console.error("Backend TTS API error:", await response.text());
    }
    
    // If backend TTS fails, use browser TTS
    await playBrowserTTS(text);
    
  } catch (error) {
    console.error("Error generating TTS:", error);
    await playBrowserTTS(text);
  }
};

const playBrowserTTS = async (text: string) => {
  if (!window.speechSynthesis) {
    setIsPlaying(null);
    setIsLoadingAudio(false);
    return;
  }
  
  const utterance = new SpeechSynthesisUtterance(text);
  
  // Get all available voices
  let voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) {
    // Wait briefly and try again if no voices available
    await new Promise(resolve => setTimeout(resolve, 100));
    voices = window.speechSynthesis.getVoices();
  }
  
  console.log(`Found ${voices.length} browser voices`);
  
  // Enhanced preferred voice names for each language - ordered by quality & naturalness
  const preferredVoiceMap = {
    'en': [
      'Google US English Neural', 'Google US English Female', 'Google UK English Female', 
      'Microsoft Aria', 'Microsoft Jenny', 'Samantha', 'Karen', 'en-US', 'en-GB'
    ],
    'ja': [
      'Google 日本語 Neural', 'Google 日本語', 'Microsoft Nanami', 'Microsoft Ichiro', 
      'Kyoko', 'Mizuki', 'Otoya', 'Microsoft Haruka', 'ja-JP'
    ],
    'zh-CN': [
      'Google 普通话（中国大陆）Neural', 'Google 普通话（中国大陆）', 
      'Microsoft Xiaoxiao', 'Microsoft Yunxi', 'Microsoft Yaoyao', 
      'Microsoft Huihui', 'Tingting', 'Google Chinese', 'zh-CN'
    ],
    'zh-TW': [
      'Google 國語（臺灣）Neural', 'Google 國語（臺灣）', 
      'Microsoft HsiaoChen', 'Microsoft HanHan', 'Microsoft Tracy', 
      'Microsoft Zhiwei', 'Mei-Jia', 'zh-TW', 'cmn-Hant-TW'
    ],
    'ko': [
      'Google 한국어 Neural', 'Google 한국의', 'Microsoft SunHi', 
      'Microsoft InJoon', 'Yuna', 'Microsoft Heami', 'ko-KR'
    ],
    'es': [
      'Google español Neural', 'Google español', 'Microsoft Elvira', 'Microsoft Alvaro',
      'Paulina', 'Monica', 'Juan', 'Microsoft Helena', 'Microsoft Pablo', 'es-ES', 'es-MX'
    ],
    'fr': [
      'Google français Neural', 'Google français', 'Microsoft Denise', 'Microsoft Henri',
      'Thomas', 'Amelie', 'Microsoft Julie', 'Microsoft Claude', 'fr-FR', 'fr-CA'
    ],
    'it': [
      'Google italiano Neural', 'Google italiano', 'Microsoft Elsa', 'Microsoft Diego',
      'Alice', 'Luca', 'Microsoft Isabella', 'Microsoft Cosimo', 'it-IT'
    ],
    'de': [
      'Google Deutsch Neural', 'Google Deutsch', 'Microsoft Katja', 'Microsoft Conrad',
      'Anna', 'Microsoft Hedda', 'Microsoft Stefan', 'de-DE'
    ],
    'hi': [
      'Google हिन्दी Neural', 'Google हिन्दी', 'Microsoft Swara', 'Microsoft Madhur',
      'Lekha', 'Microsoft Heera', 'Microsoft Hemant', 'hi-IN'
    ]
  };
  
  // Enhanced language-specific optimized settings for more natural speech
  const languageConfig = {
    'en': { locale: 'en-US', rate: 0.95, pitch: 1.0 },
    'ja': { locale: 'ja-JP', rate: 0.78, pitch: 1.05 },  // Slower for better clarity
    'zh-CN': { locale: 'zh-CN', rate: 0.80, pitch: 1.0 }, // Slower for better tones
    'zh-TW': { locale: 'zh-TW', rate: 0.80, pitch: 1.0 },
    'ko': { locale: 'ko-KR', rate: 0.78, pitch: 1.0 },   // Korean needs slower speech
    'es': { locale: 'es-ES', rate: 0.90, pitch: 1.0 },
    'fr': { locale: 'fr-FR', rate: 0.88, pitch: 1.0 },
    'it': { locale: 'it-IT', rate: 0.90, pitch: 1.0 },
    'de': { locale: 'de-DE', rate: 0.85, pitch: 0.95 },  // Lower pitch for German
    'hi': { locale: 'hi-IN', rate: 0.78, pitch: 1.05 }   // Slower for Hindi clarity
  };
  
  // Further slow down for easy mode (single words)
  if (difficulty === 'easy') {
    Object.keys(languageConfig).forEach(key => {
      const config = languageConfig[key as keyof typeof languageConfig];
      config.rate = Math.max(0.7, config.rate - 0.08);
    });
  }
  
  // Get config for current language or use default
  const config = languageConfig[userLanguage as keyof typeof languageConfig] || 
                { locale: userLanguage, rate: 0.9, pitch: 1.0 };
  
  // Enhanced matching patterns for different language codes
  const getLanguageMatches = (lang: string) => {
    const basePatterns = [
      lang.toLowerCase(),                          // Exact match
      lang.split('-')[0].toLowerCase(),            // Base language
      config.locale.toLowerCase(),                 // Config locale
      config.locale.split('-')[0].toLowerCase()    // Base config locale
    ];
    
    // Special case for Chinese variants
    if (lang === 'zh-CN') {
      return [...basePatterns, 'zh', 'cmn', 'chinese', 'mandarin'];
    }
    if (lang === 'zh-TW') {
      return [...basePatterns, 'zh', 'cmn', 'chinese', 'mandarin'];
    }
    
    return [...new Set(basePatterns)];
  };
  
  const langPatterns = getLanguageMatches(userLanguage);
  console.log("Looking for voices matching patterns:", langPatterns);
  
  // Find voices that match our language using more flexible pattern matching
  const matchingVoices = voices.filter(v => {
    // Check if the voice's language matches any of our patterns
    const voiceLang = v.lang.toLowerCase();
    const voiceBaseLang = voiceLang.split('-')[0];
    
    return langPatterns.some(pattern => 
      voiceLang.includes(pattern) || 
      voiceBaseLang === pattern ||
      v.name.toLowerCase().includes(pattern)
    );
  });
  
  console.log(`Found ${matchingVoices.length} matching voices for language: ${userLanguage}`);
  
  // Debug: log all matching voices with more details
  matchingVoices.forEach((v, i) => {
    console.log(`${i+1}. ${v.name} (${v.lang}) - ${v.localService ? 'Local' : 'Network'}`);
  });
  
  // Also log all available voices for debugging
  if (matchingVoices.length === 0) {
    console.log("No matching voices found. All available voices:");
    voices.forEach((v, i) => {
      console.log(`${i+1}. ${v.name} (${v.lang}) - ${v.localService ? 'Local' : 'Network'}`);
    });
  }
  
  // Choose the best voice based on preferred voices list - prioritizing neural voices
  let selectedVoice = null;
  const preferredVoices = preferredVoiceMap[userLanguage as keyof typeof preferredVoiceMap] || [];
  
  // First try to find one of the preferred voices for this language (in order of preference)
  for (const preferredVoiceName of preferredVoices) {
    const preferredVoiceMatch = matchingVoices.find(v => 
      v.name.includes(preferredVoiceName) || 
      v.lang.includes(preferredVoiceName)
    );
    
    if (preferredVoiceMatch) {
      selectedVoice = preferredVoiceMatch;
      console.log(`Selected preferred voice: ${preferredVoiceMatch.name}`);
      break;
    }
  }
  
  // If no preferred voices found, try to find any neural voice (usually best quality)
  if (!selectedVoice) {
    selectedVoice = matchingVoices.find(v => v.name.toLowerCase().includes('neural'));
    if (selectedVoice) {
      console.log(`Selected neural voice: ${selectedVoice.name}`);
    }
  }
  
  // If no neural voice, try Google voices
  if (!selectedVoice) {
    selectedVoice = matchingVoices.find(v => v.name.includes('Google'));
    if (selectedVoice) {
      console.log(`Selected Google voice: ${selectedVoice.name}`);
    }
  }
  
  // Then try Microsoft voices
  if (!selectedVoice) {
    selectedVoice = matchingVoices.find(v => v.name.includes('Microsoft'));
    if (selectedVoice) {
      console.log(`Selected Microsoft voice: ${selectedVoice.name}`);
    }
  }
  
  // If still no match, try any female voice (often better quality)
  if (!selectedVoice) {
    selectedVoice = matchingVoices.find(v => 
      v.name.includes('Female') || 
      v.name.includes('Samantha') || 
      v.name.includes('Kyoko') ||
      v.name.includes('Mei-Jia')
    );
    if (selectedVoice) {
      console.log(`Selected female voice: ${selectedVoice.name}`);
    }
  }
  
  // Fall back to any matching voice
  if (!selectedVoice && matchingVoices.length > 0) {
    selectedVoice = matchingVoices[0];
    console.log(`Selected fallback voice: ${selectedVoice.name}`);
  }
  
  // If we STILL don't have a matching voice, try to find any voice that might work
  if (!selectedVoice) {
    console.log("No matching voices at all! Trying desperate fallbacks...");
    
    // Try to find voices with the base language code
    const baseCode = config.locale.split('-')[0];
    selectedVoice = voices.find(v => v.lang.startsWith(baseCode));
    
    if (!selectedVoice) {
      // For Chinese, check multiple possible codes
      if (userLanguage.startsWith('zh')) {
        selectedVoice = voices.find(v => 
          v.lang.startsWith('zh') || 
          v.lang.startsWith('cmn') || 
          v.name.toLowerCase().includes('chinese')
        );
      }
      // For Japanese, accept anything with ja
      else if (userLanguage === 'ja') {
        selectedVoice = voices.find(v => 
          v.lang.includes('ja') || 
          v.name.toLowerCase().includes('japan')
        );
      }
    }
    
    if (selectedVoice) {
      console.log(`Selected desperate fallback voice: ${selectedVoice.name}`);
    } else {
      console.warn("Could not find ANY suitable voice. Will use default voice.");
    }
  }
  
  // If we found a voice, use it
  if (selectedVoice) {
    utterance.voice = selectedVoice;
    utterance.lang = selectedVoice.lang;
    console.log(`Using voice: ${selectedVoice.name} (${selectedVoice.lang})`);
  } else {
    // Last resort - force the lang and hope browser picks something suitable
    utterance.lang = config.locale;
    console.log(`No specific voice found, using language: ${config.locale}`);
  }
  
  // Apply language-specific speech configuration
  utterance.rate = config.rate;
  utterance.pitch = config.pitch;
  utterance.volume = 1.0;
  
  // Language-specific text processing to improve naturalness
  let processedText = text;
  
  // Enhanced language-specific text processing
  if (['zh-CN', 'zh-TW'].includes(userLanguage)) {
    if (text.length <= 3) {
      // For very short words, add spacing between characters for clearer pronunciation
      processedText = text.split('').join(' ');
      console.log("Applied spacing for short Chinese text:", processedText);
    } 
    else if (text.length <= 10) {
      // For short sentences, slow down the rate further for tonal clarity
      utterance.rate = Math.max(0.7, config.rate - 0.1);
    }
  }
  else if (userLanguage === 'ja') {
    if (text.length <= 2) {
      // Add です for isolated characters if not already present
      if (!text.includes('です')) {
        processedText = text + ' です';
        console.log("Added です for short Japanese text:", processedText);
      } else {
        processedText = text.split('').join(' ');
      }
    }
    else if (text.length <= 8) {
      utterance.rate = Math.max(0.7, config.rate - 0.05);
    }
  }
  else if (userLanguage === 'ko') {
    if (text.length <= 3) {
      if (!text.endsWith('요')) {
        processedText = text + ' 요';
        console.log("Added 요 for short Korean text:", processedText);
      } else {
        processedText = text.split('').join(' ');
      }
    }
    else if (text.length <= 8) {
      utterance.rate = Math.max(0.7, config.rate - 0.05);
    }
  }
  
  // Initialize the Web Speech API better to improve voice loading
  const initializeVoices = () => {
    // Trigger voice loading in browsers that need it
    window.speechSynthesis.cancel();
    
    // In Safari, a silent utterance helps initialize the voice system
    const silentUtterance = new SpeechSynthesisUtterance(' ');
    silentUtterance.volume = 0;
    window.speechSynthesis.speak(silentUtterance);
    
    console.log("Initialized speech synthesis voices");
  };
  
  // Try initializing voices if we didn't find an appropriate one
  if (!selectedVoice && voices.length === 0) {
    initializeVoices();
    await new Promise(resolve => setTimeout(resolve, 100));
    voices = window.speechSynthesis.getVoices();
    console.log(`After initialization, found ${voices.length} voices`);
  }
  
  // Set the processed text
  utterance.text = processedText;
  
  // Set up event handlers
  utterance.onend = () => {
    setIsPlaying(null);
    setIsLoadingAudio(false);
  };
  
  utterance.onerror = (event) => {
    console.error("Browser TTS error:", event);
    setIsPlaying(null);
    setIsLoadingAudio(false);
  };
  
  // Play the speech
  console.log(`Speaking with rate=${utterance.rate}, pitch=${utterance.pitch}`);
  
  // Fix for Chrome issue where utterances can get cut off
  window.speechSynthesis.cancel();
  
  // On iOS/Safari, we need to do this to ensure audio plays
  if (/iPhone|iPad|iPod|Safari/.test(navigator.userAgent) && !(/Chrome/.test(navigator.userAgent))) {
    setTimeout(() => {
      window.speechSynthesis.speak(utterance);
    }, 100);
  } else {
    window.speechSynthesis.speak(utterance);
  }
  
  setIsLoadingAudio(false);
};

const navigateToDashboard = () => {
  router.push('/dashboard');
  setShowProfileMenu(false);
};

const handleBackClick = () => {
  router.push('/choose');
};

const changeDifficulty = async (newDifficulty: 'easy' | 'medium' | 'hard') => {
  if (newDifficulty !== difficulty) {
    resetPracticeState(false); 
    setDifficulty(newDifficulty);
    await generateNewPracticeSentence(userLanguage, newDifficulty);
  }
};

const translateSentence = async () => {
  if (!practiceSentence) {
    console.log("No practice sentence available to translate");
    return;
  }
  
  if (showTranslation) {
    console.log("Toggling translation off");
    setShowTranslation(false);
    return;
  }
  
  try {
    setIsTranslating(true);
    console.log(`Translating: "${practiceSentence.text}" from ${userLanguage} to English`);
    
    const response = await fetch('http://localhost:8000/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: practiceSentence.text,
        source_language: userLanguage,
        target_language: 'en'
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Translation API error (${response.status}):`, errorText);
      throw new Error(`API error: ${response.status}`);
    }
    
    const data = await response.json();
    console.log("Translation API response:", data);
    
    if (data && typeof data.translated_text === 'string' && data.translated_text.trim() !== '') {
      setTranslation(data.translated_text);
      setShowTranslation(true);
    } 
    else if (data && typeof data.translation === 'string' && data.translation.trim() !== '') {
      setTranslation(data.translation);
      setShowTranslation(true);
    } 
    else {
      console.warn("API returned a response without a valid translation field:", data);
      setTranslation("Translation format error. Please try again later.");
      setShowTranslation(true);
    }
  } catch (error) {
    console.error("Translation error:", error);
    setTranslation("Translation service unavailable. Please try again later.");
    setShowTranslation(true);
  } finally {
    setIsTranslating(false);
  }
};

if (loading) {
  return (
    <div className="min-h-screen flex items-center justify-center"
      style={{ backgroundImage: "url('/icons/background1.jpg')", backgroundSize: "cover" }}>
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#48d1cc]"></div>
    </div>
  );
}

return (
  <div className="min-h-screen bg-gray-900 text-white relative"
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
        className="text-white"
      />
    </button>

    {/* Main content */}
    <div className="pt-24 px-4 max-w-6xl mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-black mb-2">Pronunciation Practice</h1>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <button 
          onClick={() => changeDifficulty('easy')}
          className={`py-3 rounded-lg transition-colors ${
            difficulty === 'easy' 
              ? 'bg-[#20b2aa] text-white' 
              : 'bg-white/10 text-black/80 hover:bg-black/20'
          }`}
        >
          Easy
        </button>
        <button 
          onClick={() => changeDifficulty('medium')}
          className={`py-3 rounded-lg transition-colors ${
            difficulty === 'medium' 
              ? 'bg-[#20b2aa] text-white' 
              : 'bg-white/10 text-black/80 hover:bg-black/20'
          }`}
        >
          Medium
        </button>
        <button 
          onClick={() => changeDifficulty('hard')}
          className={`py-3 rounded-lg transition-colors ${
            difficulty === 'hard' 
              ? 'bg-[#20b2aa] text-white' 
              : 'bg-white/10 text-black/80 hover:bg-black/20'
          }`}
        >
          Hard
        </button>
      </div>

      <div className="mb-6 text-center">
        <div className="inline-flex items-center bg-white/20 rounded-full px-4 py-2">
          <span className="text-sm font-medium text-black mr-2">Practicing in:</span>
          <span className="font-semibold text-black/90">
            {userLanguage === 'en' ? 'English' : 
             userLanguage === 'zh-CN' ? 'Chinese (Simplified)' :
             userLanguage === 'zh-TW' ? 'Chinese (Traditional)' :
             userLanguage === 'ja' ? 'Japanese' :
             userLanguage === 'ko' ? 'Korean' :
             userLanguage === 'es' ? 'Spanish' :
             userLanguage === 'fr' ? 'French' :
             userLanguage === 'it' ? 'Italian' :
             userLanguage === 'de' ? 'German' :
             userLanguage === 'hi' ? 'Hindi' :
             userLanguage}
          </span>
        </div>
      </div>
      
      <div className="bg-[#f0f8ff] rounded-xl p-8 shadow-lg mb-6">
        {practiceSentence ? (
          practiceSentence.text === "Loading error. Please try again." ? (
            <div className="text-center py-8">
              <div className="text-red-500 mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <h3 className="text-xl font-semibold mt-2">Connection Error</h3>
              </div>
              <p className="text-gray-700 mb-4">We couldn't load practice sentences. Please check your internet connection.</p>
              <button 
                onClick={() => {
                  resetPracticeState(true); 
                  handleMouseDown();
                }}
                className="bg-[#20b2aa] hover:bg-[#008080] text-white px-4 py-2 rounded-lg transition-colors"
              >
                Try Again
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <div className="flex flex-wrap items-center justify-center mb-4">
                {difficulty === 'easy' ? (
                  <h2 className="text-2xl font-bold text-gray-800 mb-4 text-center w-full">
                    {practiceSentence.text}
                  </h2>
                ) : (
                  <h2 className="text-2xl font-bold text-gray-800 mr-4 mb-2">
                    {practiceSentence.text}
                  </h2>
                )}
                <div className="flex space-x-2">
                  <button
                    onClick={() => playAudio('sentence')}
                    disabled={isLoadingAudio} 
                    className={`w-10 h-10 ${
                      isPlaying === 'sentence' 
                        ? 'bg-blue-400 text-white' 
                        : isLoadingAudio
                          ? 'bg-gray-300 cursor-not-allowed'
                          : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                    } rounded-full flex items-center justify-center transition-colors`}
                    aria-label={isPlaying === 'sentence' ? "Stop audio" : "Play audio"}
                    title={isPlaying === 'sentence' ? "Stop audio" : "Play audio"}
                  >
                    {isLoadingAudio ? (
                      <div className="w-5 h-5 border-2 border-t-transparent border-gray-500 rounded-full animate-spin"></div>
                    ) : isPlaying === 'sentence' ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                      </svg>
                    ) : (
                      <Image 
                        src="/icons/speaker.png" 
                        alt="Play audio" 
                        width={24} 
                        height={24} 
                      />
                    )}
                  </button>
                  {userLanguage !== 'en' && (
                    <button
                      onClick={translateSentence}
                      disabled={isTranslating}
                      className={`flex items-center justify-center px-3 py-2 rounded-lg transition-colors ${
                        showTranslation 
                          ? 'bg-blue-500 text-white' 
                          : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                      }`}
                      aria-label="Translate"
                    >
                      {isTranslating ? (
                        <div className="w-4 h-4 border-2 border-t-transparent border-white rounded-full animate-spin mr-1"></div>
                      ) : showTranslation ? (
                        <span className="text-sm">Hide Translation</span>
                      ) : (
                        <>
                          <Image 
                            src="/icons/translate.png" 
                            alt="Translate" 
                            width={20} 
                            height={20} 
                            className="mr-1"
                          />
                          <span className="text-sm">Translate</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
              {showTranslation && (
                <div className="bg-blue-100 p-3 rounded-lg mb-4 w-full max-w-md border border-blue-300">
                  <p className="text-gray-700 text-sm font-medium">English translation:</p>
                  <p className="text-gray-800 font-medium">{translation || "No translation available"}</p>
                </div>
              )}

              <div className="w-full max-w-md mt-6">
                <div className="flex flex-col items-center justify-center mb-6">
                  <button
                    onMouseDown={handleMouseDown}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onTouchStart={handleTouchStart}
                    onTouchEnd={handleTouchEnd}
                    onTouchCancel={handleMouseUp}
                    disabled={isLoading}
                    className={`${
                      isListening 
                        ? 'bg-red-500 active:bg-red-700' 
                        : 'bg-[#20b2aa] active:bg-[#006d68]'
                    } w-20 h-20 rounded-full transition-colors duration-200 flex items-center justify-center relative select-none touch-none`}
                    aria-label="Push to talk"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="white">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                    {isListening && (
                      <span className="absolute top-0 right-0 flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                      </span>
                    )}
                  </button>
                    
                  <p className="text-sm text-gray-600 mt-2 text-center">
                    {isListening ? "Keep holding to record..." : "Press and hold to record"}
                  </p>
                </div>
                
                {feedback && (
                  <div className="text-center text-gray-700 animate-pulse mb-4">
                    {feedback}
                  </div>
                )}
                
                {userRecording && !isListening && (
                  <div className="bg-gray-100 p-4 rounded-lg mb-4">
                    <p className="text-gray-700"><strong>You said:</strong> {userRecording}</p>
                  </div>
                )}
                
                {pronunciationScore && (
                  <div className="bg-white p-6 rounded-lg shadow-md">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-xl font-bold text-gray-800">Your Pronunciation</h3>
                      <div className="relative w-20 h-20">
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className={`text-2xl font-bold ${
                            pronunciationScore.score >= 80 ? 'text-green-500' : 
                            pronunciationScore.score >= 60 ? 'text-[#20b2aa]' : 
                            'text-orange-500'
                          }`}>
                            {pronunciationScore.score}%
                          </span>
                        </div>
                        <svg className="w-full h-full" viewBox="0 0 36 36">
                          <path
                            d="M18 2.0845
                              a 15.9155 15.9155 0 0 1 0 31.831
                              a 15.9155 15.9155 0 0 1 0 -31.831"
                            fill="none"
                            stroke="#eee"
                            strokeWidth="3"
                          />
                          <path
                            d="M18 2.0845
                              a 15.9155 15.9155 0 0 1 0 31.831
                              a 15.9155 15.9155 0 0 1 0 -31.831"
                            fill="none"
                            stroke={
                              pronunciationScore.score >= 80 ? '#22c55e' : 
                              pronunciationScore.score >= 60 ? '#20b2aa' : 
                              '#f97316'
                            }
                            strokeWidth="3"
                            strokeDasharray={`${pronunciationScore.score}, 100`}
                          />
                        </svg>
                      </div>
                    </div>
                    
                    <p className="text-gray-700 mb-3">{pronunciationScore.feedback}</p>
                    
                    <div className="flex justify-between">
                      <button 
                        onMouseDown={handleMouseDown}
                        className="bg-[#20b2aa] hover:bg-[#008080] text-white px-4 py-2 rounded-lg transition-colors"
                      >
                        Try Again
                      </button>
                      <button 
                        onClick={tryAnotherSentence}
                        className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg transition-colors"
                      >
                        Next {difficulty === 'easy' ? 'Word' : 'Sentence'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        ) : (
          <div className="text-center py-10 text-gray-500">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[#48d1cc] mx-auto mb-4"></div>
            <p>Loading practice sentence...</p>
            {feedback && <p className="text-red-500 mt-2">{feedback}</p>}
            <button 
              onClick={() => generateNewPracticeSentence(userLanguage, difficulty)}
              className="mt-4 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg transition-colors"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  </div>
);
};

export default VoicePracticePage;