"use client"
import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { usePathname } from 'next/navigation';
import { auth } from "../../../server/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import Dictionary from '@/components/Dictionary';
import { sendChatMessage, getSuggestions, setScenario, saveConversationToDatabase, getConversationHistory } from '@/services/api';

interface ChatResponse {
  data: ChatResponseData | null;
  error: string | null;
}

interface ChatResponseData {
  response?: string;
  audio_url?: string;
}

export interface ChatRequest {
    username: string;
    message: string;
    scenario?: string;
    language?: string;
    user_locale?: string;
    response_locale?: string;
    voice_locale?: string;
    reset_language_context?: boolean;
    force_language?: boolean;
    save_to_history?: boolean;
    is_discarded?: boolean;
    conversation_id?: string;
}

interface ApiResult<T> {
  data: T | null;
  error: string | null;
}

type ApiResponse<T> = {
  data: T | null;
  error: string | null;
};

interface ApiResult<T> {
  data: T | null;
  error: string | null;
}

const ConversationPage = () => {
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Array<{text: string, sender: 'user' | 'bot', audio_url?: string, english?: string}>>([]);
  const [localMessages, setLocalMessages] = useState<Array<{text: string, sender: 'user' | 'bot', audio_url?: string, english?: string}>>([]);
  const [showModal, setShowModal] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [suggestionList, setSuggestionList] = useState<string[]>([]);
  const [isPlaying, setIsPlaying] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [username, setUsername] = useState<string>('');
  const [locale, setLocale] = useState<string>('en');
  const [userLanguage, setUserLanguage] = useState<string>('en');
  const inputRef = useRef<HTMLInputElement>(null);
  const [messageTranslations, setMessageTranslations] = useState<Record<number, string>>({});
  const [suggestionTranslations, setSuggestionTranslations] = useState<Record<number, string>>({});
  const [showExitReminder, setShowExitReminder] = useState(false);
  const [exitDestination, setExitDestination] = useState('');
  const [isSessionSaved, setIsSessionSaved] = useState(false);
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null);
  const [languageSwitchInProgress, setLanguageSwitchInProgress] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const [pronunciationLoading, setPronunciationLoading] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);
  const [discardConversation, setDiscardConversation] = useState(false);
  const [shouldSave, setShouldSave] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const sessionIdRef = useRef<string>(
  typeof window !== 'undefined' 
      ? sessionStorage.getItem('current_conversation_session') || `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
      : `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  );
  const localeMap: Record<string, string> = {
    'english': 'en',
    'English': 'en',
    'chinese': 'zh-CN',
    'Chinese': 'zh-CN',
    'chinese traditional': 'zh-TW',
    'Chinese Traditional': 'zh-TW',
    'traditional chinese': 'zh-TW',
    'Traditional Chinese': 'zh-TW',
    'japanese': 'ja',
    'Japanese': 'ja',
    'JAPANESE': 'ja',
    'ja-JP': 'ja',
    'ja_JP': 'ja',
    'korean': 'ko',
    'Korean': 'ko',
    'spanish': 'es',
    'Spanish': 'es',
    'french': 'fr',
    'French': 'fr',
    'italian': 'it',
    'Italian': 'it',
    'german': 'de',
    'German': 'de',
    'deutsch': 'de',
    'Deutsch': 'de',
    'hindi': 'hi',
    'Hindi': 'hi',
  };
  
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const resetConversation = async (languageCode: string) => {
    try {
      setIsLoading(true);
      let normalizedLanguageCode = normalizeLanguageCode(languageCode);
      
      console.log(`Resetting conversation to language: ${normalizedLanguageCode}`);
      
      setMessageTranslations({});
      setSuggestionTranslations({});
      setSuggestionList([]);
      setCurrentConversationId(null);
      
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      
      setLocale(normalizedLanguageCode);
      setUserLanguage(normalizedLanguageCode);
      localStorage.setItem('locale', normalizedLanguageCode);
      
      const currentUsername = username || user?.displayName || user?.email?.split('@')[0] || 'Guest';
      
      try {
        const clearResponse = await fetch('http://localhost:8000/api/clear_conversation', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username: currentUsername
          }),
        });
        
        if (!clearResponse.ok) {
          console.warn("Failed to clear conversation history on server");
        }
      } catch (error) {
        console.error("Error clearing conversation history:", error);
      }
      
      const profileUpdateResponse = await fetch('http://localhost:8000/api/set_user_profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: currentUsername,
          language: normalizedLanguageCode,
          force_update: true
        }),
      });
      
      if (!profileUpdateResponse.ok) {
        console.warn("Failed to update language preference on server");
      }
      
      const initialBotMessage = await getLocalizedWelcomeMessage(normalizedLanguageCode);
      
      setMessages([initialBotMessage]);
      setLocalMessages([initialBotMessage]);
      
      await initializeConversation(currentUsername, normalizedLanguageCode);
      
      if (normalizedLanguageCode !== 'en') {
        translateToEnglish(initialBotMessage.text, 'message', 0);
      }
      
      fetchSuggestionsOnce(currentUsername, normalizedLanguageCode);

      sessionIdRef.current = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('current_conversation_session', sessionIdRef.current);
      }
      
    } catch (error) {
      console.error("Error resetting conversation:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const getCurrentLanguage = (): string => {
    const savedLocale = localStorage.getItem('locale');
    
    if (savedLocale && savedLocale !== locale && !languageSwitchInProgress) {
      console.warn("Language mismatch detected", { 
        state: locale,
        storage: savedLocale
      });
    }
    return locale || savedLocale || 'en';
  };

  const ensureCorrectLanguage = async () => {
    console.log("Simple language consistency check");
    
    const savedLocale = localStorage.getItem('locale') || 'en';
    
    if (locale !== savedLocale) {
      console.log(`Language mismatch: ${locale} -> ${savedLocale}`);
      setLocale(savedLocale);
      setUserLanguage(savedLocale);
      return true;
    }
    
    return false;
  };

  useEffect(() => {
    localStorage.removeItem('discardedConversation');
    
    return () => {
      if (localStorage.getItem('discardedConversation') === 'true') {
        console.log("Component unmounting with discard flag set - preventing any save");
      }
    };
  }, []);

  useEffect(() => {
    ensureCorrectLanguage().then(async (wasChanged) => {
      if (wasChanged) {
        console.log("Language settings were updated on component mount");
      }
      
      const savedLocale = localStorage.getItem('locale') || 'en';
      console.log("Component mounted - setting locale from localStorage:", savedLocale);
      
      setLocale(savedLocale);
      setUserLanguage(savedLocale);
      
      setMessageTranslations({});
      setSuggestionTranslations({});
      
      if (messages.length === 0) {
        const initialBotMessage = await getLocalizedWelcomeMessage(savedLocale);
        setMessages([initialBotMessage]);
        setLocalMessages([initialBotMessage]);
      }
      
      checkBackendHealth().then(isHealthy => {
        if (!isHealthy) {
          console.warn("Backend health check failed on startup - service may be unavailable");
          setMessages(prev => [...prev, { 
            text: "Warning: The conversation service appears to be unavailable. Some features may not work correctly.", 
            sender: 'bot' 
          }]);
        } else {
          console.log("Backend health check passed - service is available");
          
          checkBackendAudioSystem().then(result => {
            if (result) {
              console.log("Audio system is correctly configured.");
            } else {
              console.warn("Audio system may have configuration issues.");
            }
          });
        }
      });
    });
  }, []);

  const normalizeLanguageCode = (langCode: string): string => {
    if (!langCode) return 'en';
    
    const lowerCode = langCode.toLowerCase();
    
    if (lowerCode === 'japanese' || lowerCode === 'ja' || lowerCode === 'ja-jp' || lowerCode === 'ja_jp') {
      return 'ja';
    }
    
    if (lowerCode === 'chinese' || lowerCode === 'zh' || lowerCode === 'zh-cn' || lowerCode === 'zh_cn') {
      return 'zh-CN';
    }
    
    if (lowerCode === 'chinese traditional' || lowerCode === 'traditional chinese' || 
        lowerCode === 'zh-tw' || lowerCode === 'zh_tw') {
      return 'zh-TW';
    }
    
    if (lowerCode === 'korean' || lowerCode === 'ko' || lowerCode === 'ko-kr' || lowerCode === 'ko_kr') {
      return 'ko';
    }
    
    if (lowerCode === 'spanish' || lowerCode === 'es' || lowerCode === 'es-es' || lowerCode === 'es_es') {
      return 'es';
    }
    
    if (lowerCode === 'french' || lowerCode === 'fr' || lowerCode === 'fr-fr' || lowerCode === 'fr_fr') {
      return 'fr';
    }
    
    if (lowerCode === 'italian' || lowerCode === 'it' || lowerCode === 'it-it' || lowerCode === 'it_it') {
      return 'it';
    }
    
    if (lowerCode === 'german' || lowerCode === 'deutsch' || lowerCode === 'de' || 
        lowerCode === 'de-de' || lowerCode === 'de_de') {
      return 'de';
    }
    
    if (lowerCode === 'hindi' || lowerCode === 'hi' || lowerCode === 'hi-in' || lowerCode === 'hi_in') {
      return 'hi';
    }
    
    if (lowerCode === 'english' || lowerCode === 'en' || lowerCode === 'en-us' || lowerCode === 'en_us') {
      return 'en';
    }
    
    return localeMap[langCode] || localeMap[lowerCode] || langCode;
  };

  const getAndCheckCurrentLanguage = (): string => {
    const savedLocale = localStorage.getItem('locale');
    
    if (savedLocale && savedLocale !== locale && !languageSwitchInProgress) {
      console.warn("Language mismatch detected", { 
        state: locale,
        storage: savedLocale
      });
    }
    
    return normalizeLanguageCode(locale || savedLocale || 'en');
  };

  const initializeConversation = async (username: string, specificLocale?: string) => {
    try {
      let currentLocale = specificLocale || getCurrentLanguage();
      
      if (currentLocale.toLowerCase() === 'japanese' || 
          currentLocale === 'ja' || 
          currentLocale === 'ja-JP') {
        console.log("Normalizing Japanese locale for initialization");
        currentLocale = 'ja';
      } else if (currentLocale.toLowerCase().includes('chinese traditional') || 
                 currentLocale === 'zh-TW') {
        console.log("Normalizing Traditional Chinese locale for initialization");
        currentLocale = 'zh-TW';
      } else if (currentLocale.toLowerCase().includes('chinese') || 
                 currentLocale === 'zh-CN') {
        console.log("Normalizing Simplified Chinese locale for initialization");
        currentLocale = 'zh-CN';
      } else if (currentLocale.toLowerCase().includes('korean') || 
                 currentLocale === 'ko') {
        console.log("Normalizing Korean locale for initialization");
        currentLocale = 'ko';
      } else if (currentLocale.toLowerCase().includes('spanish') || 
                 currentLocale === 'es') {
        console.log("Normalizing Spanish locale for initialization");
        currentLocale = 'es';
      } else if (currentLocale.toLowerCase().includes('french') || 
                 currentLocale === 'fr') {
        console.log("Normalizing French locale for initialization");
        currentLocale = 'fr';
      } else if (currentLocale.toLowerCase().includes('italian') || 
                 currentLocale === 'it') {
        console.log("Normalizing Italian locale for initialization");
        currentLocale = 'it';
      } else if (currentLocale.toLowerCase().includes('german') || 
                 currentLocale === 'de') {
        console.log("Normalizing German locale for initialization");
        currentLocale = 'de';
      } else if (currentLocale.toLowerCase().includes('hindi') || 
                 currentLocale === 'hi') {
        console.log("Normalizing Hindi locale for initialization");
        currentLocale = 'hi';
      } else if (currentLocale.toLowerCase().includes('english') || 
                 currentLocale === 'en') {
        console.log("Normalizing English locale for initialization");
        currentLocale = 'en';
      }
      
      console.log(`Initializing conversation for: ${username} with NORMALIZED language: ${currentLocale}`);
      
      setIsLoading(true);
      
      let languagePrompt = `General language practice conversation in ${currentLocale}.`;
      
      if (currentLocale === 'ja') {
        languagePrompt += " Always respond in Japanese regardless of the input language.";
      } else if (currentLocale === 'zh-CN') {
        languagePrompt += " Always respond in Simplified Chinese regardless of the input language.";
      } else if (currentLocale === 'zh-TW') {
        languagePrompt += " Always respond in Traditional Chinese regardless of the input language.";
      } else if (currentLocale === 'ko') {
        languagePrompt += " Always respond in Korean regardless of the input language.";
      } else if (currentLocale === 'es') {
        languagePrompt += " Always respond in Spanish regardless of the input language.";
      } else if (currentLocale === 'fr') {
        languagePrompt += " Always respond in French regardless of the input language.";
      } else if (currentLocale === 'it') {
        languagePrompt += " Always respond in Italian regardless of the input language.";
      } else if (currentLocale === 'de') {
        languagePrompt += " Always respond in German regardless of the input language.";
      } else if (currentLocale === 'hi') {
        languagePrompt += " Always respond in Hindi regardless of the input language.";
      } else if (currentLocale === 'en') {
        languagePrompt += " Always respond in English regardless of the input language.";
      }
      
      const scenarioResponse = await setScenario(
        username, 
        "Language Practice",  
        currentLocale,
        languagePrompt
      );
      
      console.log("Scenario response:", scenarioResponse);
      
      if (scenarioResponse.error) {
        console.error("Error setting scenario:", scenarioResponse.error);
        return false;
      }
      
      console.log("Scenario set successfully with locale:", currentLocale);
      
      if (locale !== currentLocale) {
        console.log("Updating locale state from:", locale, "to:", currentLocale);
        setLocale(currentLocale);
        setUserLanguage(currentLocale);
        localStorage.setItem('locale', currentLocale);
      }
      if (messages.length > 1) {
        fetchSuggestionsOnce(username, currentLocale);
      }
      
      return true;
    } catch (error) {
      console.error("Error initializing conversation:", error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (isInitializing) {
        console.log("Initialization already in progress, skipping");
        return;
      }
      
      const isGuest = localStorage.getItem('isGuest') === 'true';
      
      if (!currentUser && !isGuest) {
        router.push('/');
        return;
      }

      setIsInitializing(true);
      setUser(currentUser);
      
      let username;
      if (currentUser) {
        username = currentUser.displayName || currentUser.email?.split('@')[0] || 'Guest';
      } else {
        username = localStorage.getItem('userName') || 'Guest';
      }
      setUsername(username);

      try {
        let savedLocale = localStorage.getItem('locale') || 'en';
        
        console.log("Raw saved locale:", savedLocale);
        
        if (savedLocale === 'ja' || savedLocale.includes('japanese')) {
          savedLocale = 'ja';
        } else if (savedLocale === 'zh-TW' || savedLocale.includes('traditional')) {
          savedLocale = 'zh-TW';
        } else if (savedLocale === 'zh-CN' || savedLocale.includes('chinese')) {
          savedLocale = 'zh-CN';
        } else if (savedLocale === 'ko' || savedLocale.includes('korean')) {
          savedLocale = 'ko';
        } else if (savedLocale === 'es' || savedLocale.includes('spanish')) {
          savedLocale = 'es';
        } else if (savedLocale === 'fr' || savedLocale.includes('french')) {
          savedLocale = 'fr';
        } else if (savedLocale === 'it' || savedLocale.includes('italian')) {
          savedLocale = 'it';
        } else if (savedLocale === 'de' || savedLocale.includes('german')) {
          savedLocale = 'de';
        } else if (savedLocale === 'hi' || savedLocale.includes('hindi')) {
          savedLocale = 'hi';
        } else {
          savedLocale = 'en';
        }        
        setUserLanguage(savedLocale);
        setLocale(savedLocale);
        localStorage.setItem('locale', savedLocale);
        
        setIsInitialized(true);
        setLoading(false);
      } catch (error) {
        console.error('Error in initialization:', error);
        setIsInitialized(true);
        setLoading(false);
      } finally {
        setIsInitializing(false);
      }
    });
    return () => unsubscribe();
  }, [isInitializing]); 

  useEffect(() => {
    if (username && !isInitialized) {
      loadConversationHistory();
      setIsInitialized(true);
    }
  }, [username, isInitialized]);

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
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const loadVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
          console.log(`Loaded ${voices.length} speech synthesis voices`);
          
          const currentLangVoices = voices.filter(v => v.lang.startsWith(locale.split('-')[0]));
          console.log(`Available ${locale} voices:`, currentLangVoices.map(v => `${v.name} (${v.lang})`));
        } else {
          setTimeout(loadVoices, 100);
        }
      };
      
      loadVoices();
      
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
      }
    }
  }, [locale]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('current_conversation_session', sessionIdRef.current);
    }
    
    return () => {
      if (typeof window !== 'undefined' && !shouldSave) {
        sessionStorage.removeItem('current_conversation_session');
      }
    };
  }, [shouldSave]);
  
  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(event.target.value);
  }; 

  const fetchSuggestionsOnce = async (username: string, targetLocale?: string) => {
    if (isFetchingSuggestions || !username) {
      return;
    }
    const userMessageCount = messages.filter(msg => msg.sender === 'user').length;
    if (userMessageCount === 0) {
      console.log("No user messages yet, skipping suggestion fetch");
      setIsFetchingSuggestions(false);
      return;
    }
    
    try {
      setIsFetchingSuggestions(true);
      
      let normalizedLocale = normalizeLanguageCode(targetLocale || locale);
      const languageNameMap: Record<string, string> = {
        'en': 'English',
        'zh-CN': 'Chinese',
        'zh-TW': 'Chinese Traditional',
        'ja': 'Japanese',
        'ko': 'Korean',
        'es': 'Spanish',
        'fr': 'French',
        'it': 'Italian',
        'de': 'German',
        'hi': 'Hindi', 
      };

      console.log(`Fetching suggestions for ${username} in ${normalizedLocale}`);

      try {
        const profileUpdateResponse = await fetch('http://localhost:8000/api/set_user_profile', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username: username.trim(),
            language: normalizedLocale,
            locale: normalizedLocale,
            language_name: getLanguageName(normalizedLocale)
          }),
        });
          
        if (!profileUpdateResponse.ok) {
          console.warn("Failed to update language preference before fetching suggestions");
        }
      } catch (error) {
        console.error("Error updating language before suggestions:", error);
      }

      if (normalizedLocale === 'hi' || normalizedLocale === 'it') {
        console.log(`Using special handling for ${normalizedLocale === 'hi' ? 'Hindi' : 'Italian'}`);
      }

      const response = await fetch('http://localhost:8000/api/get_suggestions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: username.trim(),
          language: normalizedLocale,
          language_name: languageNameMap[normalizedLocale] || normalizedLocale
        }),
      });
      
      if (response.ok) {
        const responseText = await response.text();
        console.log(`Raw suggestion response: ${responseText}`);
        
        try {
          const data = JSON.parse(responseText);
          if (data && data.suggestions && Array.isArray(data.suggestions)) {
            console.log(`Got ${data.suggestions.length} suggestions in ${normalizedLocale}`);
            setSuggestionList(data.suggestions);
            
            setSuggestionTranslations({});
          } else {
            console.log("Invalid suggestions response");
            setSuggestionList([]);
          }
        } catch (e) {
          console.error("Failed to parse JSON response:", e);
          setSuggestionList([]);
        }
      } else {
        console.error(`Failed to fetch suggestions: ${response.status}`);
        setSuggestionList([]);
      }
    } catch (error) {
      console.error("Error fetching suggestions:", error);
      setSuggestionList([]);
    } finally {
      setIsFetchingSuggestions(false);
    }
  };

  const getLocalizedWelcomeMessage = async (locale: string) => {
    const defaultEnglishMessage = "Hello! I'm your conversation partner. What would you like to talk about today?";
    let welcomeMessage = defaultEnglishMessage;
    let originalEnglish: string | undefined = undefined;
    
    const localizedMessages: Record<string, string> = {
      'ja': 'こんにちは！私はあなたの会話パートナーです。今日は何について話したいですか？',
      'zh-CN': '你好！我是你的对话伙伴。今天想聊些什么呢？',
      'zh-TW': '你好！我是你的對話夥伴。今天想聊些什麼呢？',
      'ko': '안녕하세요! 저는 당신의 대화 파트너입니다. 오늘은 무엇에 대해 이야기하고 싶으세요?',
      'es': '¡Hola! Soy tu compañero de conversación. ¿De qué te gustaría hablar hoy?',
      'fr': 'Bonjour ! Je suis votre partenaire de conversation. De quoi aimeriez-vous parler aujourd\'hui ?',
      'it': 'Ciao! Sono il tuo partner di conversazione. Di cosa vorresti parlare oggi?',
      'de': 'Hallo! Ich bin dein Gesprächspartner. Worüber möchtest du heute sprechen?',
      'hi': 'नमस्ते! मैं आपका वार्तालाप साथी हूँ। आज आप किस बारे में बात करना चाहेंगे?'
    };
    
    if (locale !== 'en' && locale in localizedMessages) {
      welcomeMessage = localizedMessages[locale];
      originalEnglish = defaultEnglishMessage;
    } 
    else if (locale !== 'en') {
      try {
        const response = await fetch('http://localhost:8000/api/translate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: defaultEnglishMessage,
            source: 'en',
            target: locale
          }),
        });
        
        if (response.ok) {
          const data = await response.json();
          welcomeMessage = data.translated_text;
          originalEnglish = defaultEnglishMessage;
        }
      } catch (error) {
        console.error("Failed to translate welcome message:", error);
        welcomeMessage = defaultEnglishMessage;
      }
    }
    
    return { 
      text: welcomeMessage,
      sender: 'bot' as const,
      english: originalEnglish !== null ? originalEnglish : undefined
    };
  };

  const playEnhancedMessageAudio = async (messageId: number, audioUrl?: string) => {
    console.log(`Audio button clicked for message ${messageId}`);
    console.log(`Current playing state: ${isPlaying}`);
    console.log(`Audio URL provided: ${audioUrl}`);

    if (isPlaying === `message-${messageId}`) {
      console.log(`Stopping audio for message ${messageId}`);
      setIsPlaying(null);
      
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      return; 
    }
    
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    
    const message = messages[messageId];
    if (!message) {
      console.error(`Message not found at index ${messageId}`);
      return;
    }

    setIsPlaying(`message-${messageId}`);
    
    try {
      console.log(`Playing audio for message ${messageId}: "${message.text.substring(0, 30)}..."`);
      
      if (audioUrl) {
        const fullAudioUrl = audioUrl.startsWith('http') 
          ? audioUrl 
          : `http://localhost:8000${audioUrl}`;
        
        console.log(`Attempting to play audio from URL: ${fullAudioUrl}`);
        
        try {
          const checkResponse = await fetch(fullAudioUrl, { method: 'HEAD' });
          if (checkResponse.ok) {
            console.log("Audio file exists at URL");
            
            const audio = new Audio();
            
            audio.addEventListener('ended', () => {
              console.log('Audio playback ended');
              setIsPlaying(null);
              audioRef.current = null;
            });
            
            audio.addEventListener('error', (e) => {
              console.log('Audio playback error:', e);
              audioRef.current = null;
              setIsPlaying(null);
              console.log("Falling back to browser TTS due to audio error");
              playOptimizedBrowserTTS(message.text, locale);
            });
            
            audioRef.current = audio;
            audio.src = fullAudioUrl;
            audio.load();
            
            try {
              await audio.play();
              console.log("Audio playing successfully from URL");
              return;
            } catch (playError) {
              console.error("Error playing audio from URL:", playError);
              setIsPlaying(null);
              audioRef.current = null;
              console.log("Falling back to browser TTS due to play error");
            }
          } else {
            console.error(`Audio file not accessible (${checkResponse.status})`);
            console.log("Falling back to generating new audio");
          }
        } catch (checkError) {
          console.error("Error checking audio file:", checkError);
        }
      }
      
      try {
        console.log(`Generating new audio via backend for message ${messageId}`);
        await playBackendTTS(message.text, messageId);
        return;
      } catch (backendError) {
        console.error("Backend TTS generation failed:", backendError);
      }
      
      console.log("Using browser TTS as fallback");
      await playOptimizedBrowserTTS(message.text, locale);
      
    } catch (error) {
      console.error('All audio methods failed:', error);
      setIsPlaying(null);
    }
  };

  const playOptimizedBrowserTTS = async (text: string, language: string): Promise<boolean> => {
    return new Promise((resolve) => {
      try {
        if (!window.speechSynthesis) {
          console.log("Speech synthesis not available");
          setIsPlaying(null);
          resolve(false);
          return;
        }
        
        console.log(`Playing browser TTS: "${text.substring(0, 30)}..."`);
        
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
              rate: 0.95,
              pitch: 1.0
            },
            'ja': {
              locale: 'ja-JP',
              preferredVoices: [
                'Google 日本語', 'Microsoft Haruka', 'Kyoko'
              ],
              rate: 0.85,
              pitch: 1.05
            },
            'zh-CN': {
              locale: 'zh-CN',
              preferredVoices: [
                'Google 普通话（中国大陆）', 'Microsoft Yaoyao', 'Tingting'
              ],
              rate: 0.85,
              pitch: 1.0
            },
            'zh-TW': {
              locale: 'zh-TW',
              preferredVoices: [
                'Google 國語（臺灣）', 'Microsoft Hanhan', 'Meijia'
              ],
              rate: 0.85,
              pitch: 1.0
            },
            'ko': {
              locale: 'ko-KR',
              preferredVoices: [
                'Google 한국의', 'Microsoft Heami', 'Yuna'
              ],
              rate: 0.82,
              pitch: 1.0
            },
            'es': {
              locale: 'es-ES',
              preferredVoices: [
                'Google español', 'Microsoft Helena', 'Monica'
              ],
              rate: 0.92,
              pitch: 1.0
            },
            'fr': {
              locale: 'fr-FR',
              preferredVoices: [
                'Google français', 'Microsoft Julie', 'Amelie'
              ],
              rate: 0.9,
              pitch: 1.0
            },
            'it': {
              locale: 'it-IT',
              preferredVoices: [
                'Google italiano', 'Microsoft Elsa', 'Alice'
              ],
              rate: 0.9,
              pitch: 1.0
            },
            'de': {
              locale: 'de-DE',
              preferredVoices: [
                'Google Deutsch', 'Microsoft Hedda', 'Anna'
              ],
              rate: 0.85,
              pitch: 1.0
            },
            'hi': {
              locale: 'hi-IN',
              preferredVoices: [
                'Google हिन्दी', 'Microsoft Heera', 'Lekha'
              ],
              rate: 0.85,
              pitch: 1.05
            }
          };
          
          const config = languageConfig[language as keyof typeof languageConfig] || {
            locale: language,
            preferredVoices: [],
            rate: 0.9,
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
            resolve(false);
            return;
          }
          
          console.log(`Selected voice: ${selectedVoice.name} (${selectedVoice.lang})`);
          utterance.voice = selectedVoice;
          utterance.lang = selectedVoice.lang;
          utterance.rate = config.rate;
          utterance.pitch = config.pitch;
          utterance.volume = 1.0;
          
          utterance.onend = () => {
            console.log(`TTS playback ended for ${language}`);
            setIsPlaying(null);
            resolve(true);
          };
          
          utterance.onerror = (event) => {
            console.error('Browser TTS error:', event);
            setIsPlaying(null);
            resolve(false);
          };
          
          window.speechSynthesis.speak(utterance);
        }
        
      } catch (error) {
        console.error('Browser TTS error:', error);
        setIsPlaying(null);
        resolve(false);
      }
    });
  };

  const checkBackendAudioSystem = async () => {
    try {
      console.log("Testing backend audio system configuration...");
      
      try {
        const response = await fetch('http://localhost:8000/api/check_audio_system', {
          method: 'GET',
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log("Backend audio system check results:", data);
          return data;
        } else {
          console.log(`Backend doesn't have a dedicated audio system check endpoint (${response.status})`);
        }
      } catch (e) {
        console.log("No dedicated audio system check endpoint available");
      }
      
      console.log("Testing audio generation capability instead...");
      
      const testResponse = await fetch('http://localhost:8000/api/generate_audio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: "This is a test.",
          language: "en",
          use_optimized: true,
        }),
      });
      
      if (testResponse.ok) {
        const testData = await testResponse.json();
        console.log("Audio generation test successful:", testData);
        return {
          status: "operational",
          audio_generation: "working",
          message: "Audio system appears to be working correctly"
        };
      } else {
        console.error(`Audio generation test failed: ${testResponse.status}`);
        return null;
      }
    } catch (error) {
      console.error("Error checking backend audio system:", error);
      return null;
    }
  };

  const playBackendTTS = async (text: string, messageId: number) => {
    try {
      console.log(`Generating audio via backend for: "${text.substring(0, 30)}..."`);
      
      const voiceParams: Record<string, { voice_type: string, model?: string, voice_id?: string }> = {
        'en': { voice_type: 'neural', model: 'en-US-Neural2-F' },
        'ja': { voice_type: 'neural', model: 'ja-JP-Neural2-B' },
        'zh-CN': { voice_type: 'neural', model: 'cmn-CN-Neural2-A' },
        'zh-TW': { voice_type: 'neural', model: 'cmn-TW-Neural2-A' },
        'ko': { voice_type: 'neural', model: 'ko-KR-Neural2-A' },
        'es': { voice_type: 'neural', model: 'es-ES-Neural2-A' },
        'fr': { voice_type: 'neural', model: 'fr-FR-Neural2-A' },
        'it': { voice_type: 'neural', model: 'it-IT-Neural2-A' },
        'de': { voice_type: 'neural', model: 'de-DE-Neural2-B' },
        'hi': { voice_type: 'neural', model: 'hi-IN-Neural2-A' }
      };
      
      const voiceConfig = voiceParams[locale] || { voice_type: 'neural' };
      
      const response = await fetch('http://localhost:8000/api/generate_audio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          language: locale,
          use_optimized: true,
          debug: true, 
          ...voiceConfig
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
          
          audio.addEventListener('ended', () => {
            console.log('Backend TTS playback completed');
            setIsPlaying(null);
            audioRef.current = null;
          });
          
          audio.addEventListener('error', (e) => {
            console.error('Backend TTS playback failed:', e);
            setIsPlaying(null);
            audioRef.current = null;
            playOptimizedBrowserTTS(text, locale);
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
            setIsPlaying(null);
            await playOptimizedBrowserTTS(text, locale);
          }
        } else {
          console.error("Backend TTS response missing audio_url:", data);
          await playOptimizedBrowserTTS(text, locale);
        }
      } else {
        try {
          const errorData = await response.text();
          console.error(`Backend TTS failed (${response.status}):`, errorData);
        } catch (e) {
          console.error(`Backend TTS failed with status: ${response.status}`);
        }
        await playOptimizedBrowserTTS(text, locale);
      }
    } catch (error) {
      console.error('Backend TTS error:', error);
      await playOptimizedBrowserTTS(text, locale);
    }
  };

  const getLanguageName = (localeCode: string): string => {
    const mapping: Record<string, string> = {
      'en': 'English',
      'zh-CN': 'Chinese',
      'zh-TW': 'Chinese Traditional',
      'ja': 'Japanese',
      'ko': 'Korean',
      'es': 'Spanish',
      'fr': 'French',
      'it': 'Italian',
      'de': 'German',
      'hi': 'Hindi',
    };
    
    return mapping[localeCode] || 'English';
  };

  const playMessageAudio = (messageId: number, audioUrl?: string) => {
    if (isPlaying === `message-${messageId}`) {
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
    
    // If any other audio is playing, stop it first
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    
    if (window.speechSynthesis && isPlaying && isPlaying.startsWith('browser-tts')) {
      window.speechSynthesis.cancel();
    }
    
    setIsPlaying(null);
    
    // Now play the new audio
    try {
      // Use the enhanced message audio player
      playEnhancedMessageAudio(messageId, audioUrl);
    } catch (error) {
      console.error("Error playing audio:", error);
      setIsPlaying(null);
    }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;
    const isDiscarded = discardConversation || localStorage.getItem('discardedConversation') === 'true';
    if (isDiscarded) {
      console.log("Cannot send messages - conversation was discarded");
      alert("This conversation was discarded. Please start a new conversation.");
      setInputText('');
      return;
    }
    
    const userMessage = { text: inputText, sender: 'user' as const };
    setMessages(prev => [...prev, userMessage]);
    setLocalMessages(prev => [...prev, userMessage]);
    setSuggestionList([]);
    const userMessageText = inputText;
    setInputText('');
    setTimeout(scrollToBottom, 10);
        
    try {
      setIsLoading(true);
      let currentUsername = username;
      
      if (!currentUsername) {
        currentUsername = localStorage.getItem('userName') || 'Guest';
      }
        
      let userPreferredLanguage = normalizeLanguageCode(locale);
      
      console.log(`Sending message to API with language: ${userPreferredLanguage}`);
      
      const isDiscarded = discardConversation || localStorage.getItem('discardedConversation') === 'true';
      console.log(`Message send - Discard state: isDiscarded=${isDiscarded}, discardConversation=${discardConversation}, localStorage=${localStorage.getItem('discardedConversation')}`);

      try {
        const response = await fetch('http://localhost:8000/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username: currentUsername,
            message: userMessageText,
            user_locale: 'auto',
            response_locale: userPreferredLanguage,
            voice_locale: userPreferredLanguage,
            reset_language_context: true,
            conversation_id: currentConversationId,
            is_discarded: isDiscarded,
            save_to_history: !isDiscarded,
            batch_id: sessionIdRef.current
          }),
        });
      } catch (error) {
        console.error("Error updating language preference:", error);
      }
          
      const response = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: currentUsername,
          message: userMessageText,
          user_locale: 'auto',
          response_locale: userPreferredLanguage,
          voice_locale: userPreferredLanguage,
          reset_language_context: true,
          conversation_id: currentConversationId,
          is_discarded: isDiscarded,
          save_to_history: !isDiscarded
        }),
      });
            
      if (!response.ok) {
        console.error(`Chat API error: ${response.status}`);
        throw new Error(`API error: ${response.status}`);
      }
      
      const responseData = await response.json();
      if (responseData.conversation_id) {
        setCurrentConversationId(responseData.conversation_id);
        console.log(`Using conversation ID: ${responseData.conversation_id}`);
      }
      
      let botResponseText = "Sorry, I couldn't generate a response.";
      let botAudioUrl = undefined;
      
      if (responseData && typeof responseData === 'object') {
        if ('response' in responseData && responseData.response) {
          botResponseText = String(responseData.response);
        }
        
        if ('audio_url' in responseData && responseData.audio_url) {
          botAudioUrl = String(responseData.audio_url);
        }
      }
      
      const botMessage = {
        text: botResponseText,
        sender: 'bot' as const,
        audio_url: botAudioUrl,
        conversation_id: responseData.conversation_id
      };
      
      setMessages(prev => [...prev, botMessage]);
      setLocalMessages(prev => [...prev, botMessage]);
      
      setSuggestionList([]);
      await fetchSuggestionsOnce(currentUsername, userPreferredLanguage);
      
      if (userPreferredLanguage !== 'en') {
        translateToEnglish(botResponseText, 'message', messages.length);
      }
      setTimeout(scrollToBottom, 10);
      
    } catch (error) {
      console.error("Exception in send message:", error);
      setMessages(prev => [...prev, {
        text: "An error occurred connecting to the conversation service. Please check your connection and try again.",
        sender: 'bot'
      }]);
      setTimeout(scrollToBottom, 10);
    } finally {
      setIsLoading(false);
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
        scrollToBottom();
      }, 100);
    }
  };

  const saveConversationToServer = async () => {
    // First explicitly check for discard flags
    const isDiscarded = discardConversation || localStorage.getItem('discardedConversation') === 'true';
    
    if (isDiscarded) {
      console.log("Conversation marked for discard - not saving");
      // Remove any stale flags
      localStorage.removeItem('discardedConversation'); 
      return true;
    }
    
    // Only proceed if explicitly requested to save
    if (!shouldSave) {
      console.log("Save not explicitly requested - not saving");
      return true;
    }
    
    // Actual save logic below
    let currentUsername;
    if (user) {
      currentUsername = user.displayName || user.email?.split('@')[0] || 'Guest';
    } else {
      currentUsername = localStorage.getItem('userName') || 'Guest';
    }
    
    try {
      console.log(`Starting conversation save for user: ${currentUsername}`);
      
      // First check if backend is responsive
      const isBackendHealthy = await checkBackendHealth();
      if (!isBackendHealthy) {
        console.error("Backend is not responding - cannot save conversation");
        return false;
      }
      
      // No need to save empty conversations
      if (messages.length <= 1) {
        console.log("No conversation to save");
        return true;
      }
      
      // First verify user hasn't flagged this for discard on the server
      try {
        const profileCheck = await fetch('http://localhost:8000/api/user_profile?username=' + encodeURIComponent(currentUsername));
        const profileData = await profileCheck.json();
        
        if (profileData?.preferences?.discard_conversation) {
          console.log("User profile has discard flag set - not saving");
          return true;
        }
      } catch (e) {
        console.error("Error checking user discard preferences:", e);
        // Continue anyway
      }
      
      // Format the conversation messages
      const formattedConversation = messages.map((msg, index) => {
        const timestamp = new Date().toISOString();
        
        if (msg.sender === 'user') {
          return {
            user: msg.text,
            timestamp: timestamp,
            batch_id: sessionIdRef.current,
            is_discarded: false
          };
        } else {
          return {
            ai: msg.text,
            timestamp: timestamp,
            audio_url: msg.audio_url,
            batch_id: sessionIdRef.current,
            is_discarded: false
          };
        }
      });
      
      console.log('Saving conversation with format:', {
        username: currentUsername,
        messageCount: formattedConversation.length,
        is_discarded: false
      });

      // Final save call
      const response = await fetch('http://localhost:8000/api/save_conversation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: currentUsername,
          conversation: formattedConversation,
          is_discarded: false
        }),
      });
      
      const responseText = await response.text();
      console.log(`Backend save response status: ${response.status}, text:`, responseText);
      
      if (!response.ok) {
        console.error('Failed to save conversation:', responseText);
        return false;
      }
      
      console.log('Conversation saved successfully');
      setIsSessionSaved(true);
      return true;
    } catch (error) {
      console.error('Error saving conversation:', error);
      return false;
    }
  };

  const loadConversationHistory = async () => {
    if (!username) return;
    
    setIsLoading(true);
    try {
      const result = await getConversationHistory(username);
      if (result.error) {
        console.error("Failed to load conversation history:", result.error);
      } else if (result.data?.chat_history) {
        const formattedMessages = result.data.chat_history.flatMap(entry => [
          { text: entry.user, sender: 'user' as const },
          { 
            text: entry.ai, 
            sender: 'bot' as const, 
            audio_url: 'audio_url' in entry ? (entry.audio_url as string) : undefined 
          }
        ]);
        
        setMessages(formattedMessages);
      }
    } catch (error) {
      console.error("Error loading conversation history:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const checkBackendHealth = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/health_check', {
        method: 'GET',
      });
      
      const isHealthy = response.ok;
      setBackendConnected(isHealthy);
      
      if (isHealthy) {
        console.log('Backend is healthy and responding');
        return true;
      } else {
        console.error('Backend health check failed:', await response.text());
        return false;
      }
    } catch (error) {
      console.error('Error reaching backend:', error);
      setBackendConnected(false);
      return false;
    }
  };

  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleSendMessage();
    }
  };

  const handleBackClick = () => {
    const currentLocale = locale;
    localStorage.setItem('persistentLocale', currentLocale);
    localStorage.setItem('language', getLanguageName(currentLocale));
    console.log(`Persisting language ${currentLocale} (${getLanguageName(currentLocale)}) before navigation`);
    setShowExitReminder(true);
    setExitDestination('/choose');
  };

  const handleEndConvo = () => {
    setShowModal(true);
  };

  const handleExitWithoutSaving = () => {
    console.log("**** EXITING WITHOUT SAVING CONVERSATION ****");
    
    // Set flags first to prevent race conditions
    localStorage.setItem('discardedConversation', 'true');
    setDiscardConversation(true);
    setShouldSave(false);
    setIsSessionSaved(false);
    
    // First, clear state to ensure no pending operations use this data
    const savedUsername = username || localStorage.getItem('userName') || 'Guest';
    
    // Now explicitly tell the server to clear this conversation
    fetch('http://localhost:8000/api/clear_conversation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: savedUsername,
        force_clear: true,
        is_discarded: true,
        batch_id: sessionIdRef.current
      }),
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }
      return response.json();
    })
    .then(() => {
      setShowExitReminder(false);
      
      // Create a fresh session ID
      sessionIdRef.current = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('current_conversation_session');
      }
      
      // Navigate away after a short delay
      setTimeout(() => {
        setMessages([]);
        setLocalMessages([]);
        router.push(exitDestination);
      }, 100);
    })
    .catch(e => {
      console.error("Error clearing conversation:", e);
      setShowExitReminder(false);
      router.push(exitDestination);
    });
  };

  useEffect(() => {
    if (discardConversation) {
      console.log("Conversation marked as discarded");
      setShouldSave(false);
    }
  }, [discardConversation]);

  useEffect(() => {
    return () => {
      // Check if we need to save on unmount
      if (!discardConversation && shouldSave && !isSessionSaved && messages.length > 1) {
        console.log("Component unmounting - saving conversation");
        
        const currentUser = username || user?.displayName || user?.email?.split('@')[0] || 'Guest';
        
        // Format and save
        const formattedConversation = messages.map((msg, index) => {
          const timestamp = new Date().toISOString();
          
          if (msg.sender === 'user') {
            return {
              user: msg.text,
              timestamp: timestamp,
              batch_id: sessionIdRef.current,
              is_discarded: false
            };
          } else {
            return {
              ai: msg.text,
              timestamp: timestamp,
              audio_url: msg.audio_url,
              batch_id: sessionIdRef.current,
              is_discarded: false
            };
          }
        });
        fetch('http://localhost:8000/api/save_conversation', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username: currentUser,
            conversation: formattedConversation,
            is_discarded: false,
            batch_id: sessionIdRef.current
          })
        })
        .then(response => {
          if (response.ok) {
            console.log("Conversation saved successfully on unmount");
          } else {
            console.error("Failed to save conversation on unmount");
          }
        })
        .catch(err => {
          console.error("Error during unmount save:", err);
        });
      } else {
        console.log(`Not saving on unmount: discardConversation=${discardConversation}, shouldSave=${shouldSave}, isSessionSaved=${isSessionSaved}`);
      }
    };
  }, [discardConversation, shouldSave, isSessionSaved, messages, username, user]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    // On component mount, check if there's a discard flag
    const hasDiscardFlag = localStorage.getItem('discardedConversation') === 'true';
    
    if (hasDiscardFlag) {
      console.log("Found discard flag on mount - ensuring conversation won't be saved");
      setDiscardConversation(true);
      setShouldSave(false);
    } else {
      // Default to not saving unless explicitly requested
      setShouldSave(false);
    }
  }, []);

  const handleSaveConversation = async () => {
    try {
      setIsLoading(true);
      
      const currentUsername = user?.displayName || user?.email?.split('@')[0] || username || localStorage.getItem('userName') || 'Guest';
      
      // Make sure we have a consistent batch ID for the entire conversation
      if (!sessionIdRef.current) {
        sessionIdRef.current = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      }
      
      console.log(`Using session ID: ${sessionIdRef.current} for conversation`);
      
      // Format the messages properly for the API
      const formattedConversation = messages.map((msg, index) => {
        const timestamp = new Date().toISOString();
        
        // Create a consistent message structure
        const baseMessage = {
          timestamp,
          batch_id: sessionIdRef.current,
          is_discarded: false, // Explicitly mark as NOT discarded
          index
        };
        
        if (msg.sender === 'user') {
          return {
            ...baseMessage,
            user: msg.text
          };
        } else {
          return {
            ...baseMessage,
            ai: msg.text,
            audio_url: msg.audio_url
          };
        }
      });
      
      console.log(`Saving ${formattedConversation.length} messages for user ${currentUsername}`);
      console.log("First message:", formattedConversation[0]);
      
      const response = await fetch('http://localhost:8000/api/save_conversation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: currentUsername,
          conversation: formattedConversation,
          is_discarded: false, // Explicitly mark as NOT discarded
          batch_id: sessionIdRef.current // Use consistent property name
        })
      });
      
      let responseText = '';
      try {
        responseText = await response.text();
        console.log("Save response:", responseText);
      } catch (e) {
        console.error("Failed to get response text:", e);
      }
      
      if (!response.ok) {
        console.error(`Save failed with status: ${response.status}`);
        console.error(`Response body: ${responseText}`);
        throw new Error(`Save failed: ${response.status} - ${responseText}`);
      }
      
      console.log("Conversation saved successfully!");
      setIsSessionSaved(true);
      setShowModal(false);
      router.push('/choose');
    } catch (error: any) {
      console.error("Error saving conversation:", error);
      alert(`Failed to save conversation: ${error?.message || "Unknown error"}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveAndExit = async () => {
    try {
      setIsLoading(true);
      
      if (messages.length <= 1) {
        console.log("No significant conversation to save");
        setShowExitReminder(false);
        router.push(exitDestination);
        return;
      }
      
      // Mark for saving explicitly before saving
      setShouldSave(true);
      setDiscardConversation(false);
      localStorage.removeItem('discardedConversation');
      
      const currentUser = username || user?.displayName || user?.email?.split('@')[0] || 'Guest';
      
      // Generate a batch ID if we don't have one
      if (!sessionIdRef.current) {
        sessionIdRef.current = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      }
      
      // Format the messages properly for the API - critical fix
      const formattedConversation = [];
      
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const timestamp = new Date().toISOString();
        
        if (msg.sender === 'user') {
          formattedConversation.push({
            user: msg.text,
            timestamp: timestamp,
            batch_id: sessionIdRef.current,
            is_discarded: false
          });
        } else if (msg.sender === 'bot') {
          formattedConversation.push({
            ai: msg.text,
            timestamp: timestamp,
            audio_url: msg.audio_url || null,
            batch_id: sessionIdRef.current,
            is_discarded: false
          });
        }
      }
      
      console.log(`Saving ${formattedConversation.length} messages with batch ID: ${sessionIdRef.current}`);
      console.log("First message sample:", formattedConversation[0]);
      
      // Call the debug endpoint first to check current state
      try {
        const debugBefore = await fetch(
          `http://localhost:8000/api/debug_conversations?username=${encodeURIComponent(currentUser)}`
        );
        const debugBeforeData = await debugBefore.json();
        console.log("User state before save:", debugBeforeData);
      } catch (e) {
        console.log("Debug endpoint not available:", e);
      }
      
      // Make direct API call to save_conversation endpoint
      const response = await fetch('http://localhost:8000/api/save_conversation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: currentUser,
          conversation: formattedConversation,
          is_discarded: false,
          batch_id: sessionIdRef.current
        })
      });
      
      // For debug - get full response text
      let responseText = '';
      try {
        responseText = await response.text();
        console.log(`Save response: ${responseText}`);
      } catch (e) {
        console.error("Failed to get response text:", e);
      }
      
      if (!response.ok) {
        console.error(`Server error: ${response.status}`);
        console.error(`Response body: ${responseText}`);
        throw new Error(`Server error: ${response.status} - ${responseText}`);
      }
      
      // Check if save was successful by calling debug again
      try {
        const debugAfter = await fetch(
          `http://localhost:8000/api/debug_conversations?username=${encodeURIComponent(currentUser)}`
        );
        const debugAfterData = await debugAfter.json();
        console.log("User state after save:", debugAfterData);
      } catch (e) {
        console.log("Debug endpoint not available:", e);
      }
      
      console.log("Conversation saved successfully before exit!");
      setIsSessionSaved(true);
      setShowExitReminder(false);
      router.push(exitDestination);
      
    } catch (error) {
      console.error("Error saving conversation:", error);
      alert("Failed to save conversation. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDiscardConversation = () => {
    console.log("**** DISCARDING CONVERSATION WITHOUT SAVING ****");
    
    // Set flags in localStorage and state to ensure consistent behavior
    localStorage.setItem('discardedConversation', 'true');
    setDiscardConversation(true);
    setShouldSave(false);
    
    // Get current username
    const currentUser = username || user?.displayName || user?.email?.split('@')[0] || 'Guest';
    
    // First, mark all messages as discarded in the backend
    fetch('http://localhost:8000/api/clear_conversation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: currentUser,
        batch_id: sessionIdRef.current,
        conversation_id: currentConversationId,
        force_clear: false // Don't force clear everything, just mark current conversation
      }),
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      console.log("Clear response:", data);
      
      // Save discarded flag to user profile preferences
      return fetch('http://localhost:8000/api/set_user_profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: currentUser,
          preferences: {
            discard_conversation: true
          }
        })
      });
    })
    .then(() => {
      console.log("Successfully marked conversation as discarded");
      setShowModal(false);
      router.push('/choose');
    })
    .catch(error => {
      console.error("Error marking conversation as discarded:", error);
      setShowModal(false);
      router.push('/choose');
    });
  };

  const markForSaving = () => {
    console.log("Marking conversation for saving");
    setDiscardConversation(false);
    setShouldSave(true);
    localStorage.removeItem('discardedConversation');
  };

  const markForDiscard = () => {
    console.log("Marking conversation for discard");
    setDiscardConversation(true);
    setShouldSave(false);
    localStorage.setItem('discardedConversation', 'true');
  };

  const navigateToDashboard = () => {
    const currentLocale = locale;
    localStorage.setItem('persistentLocale', currentLocale);
    localStorage.setItem('language', getLanguageName(currentLocale));
    console.log(`Persisting language ${currentLocale} (${getLanguageName(currentLocale)}) before navigating to dashboard`);
    setShowExitReminder(true);
    setExitDestination('/dashboard');
    setShowProfileMenu(false);
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInputText(suggestion);
  };

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const startListening = () => {
    try {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      
      if (!SpeechRecognition) {
        console.error("Speech Recognition API not supported in this browser");
        alert("Speech recognition is not supported in your browser. Please try using Chrome or Edge.");
        return;
      }
      
      recognitionRef.current = new SpeechRecognition();
      const recognition = recognitionRef.current;
      
      let speechLocale = locale;

      if (locale === 'en') speechLocale = 'en-US';
      else if (locale === 'zh-CN') speechLocale = 'zh-CN';
      else if (locale === 'zh-TW') speechLocale = 'zh-TW';
      else if (locale === 'ja') speechLocale = 'ja-JP';
      else if (locale === 'ko') speechLocale = 'ko-KR';
      else if (locale === 'es') speechLocale = 'es-ES';
      else if (locale === 'fr') speechLocale = 'fr-FR';
      else if (locale === 'it') speechLocale = 'it-IT';
      else if (locale === 'de') speechLocale = 'de-DE';
      else if (locale === 'hi') speechLocale = 'hi-IN';
      
      console.log(`Starting speech recognition with locale: ${speechLocale}`);
      recognition.lang = speechLocale;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
            
      recognition.onstart = () => {
        console.log("Voice recognition started");
        setIsListening(true);
      };
      
      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        console.log("Recognized:", transcript);
        setInputText(transcript);
      };
      
      recognition.onerror = (event: any) => {
        console.error("Recognition error:", event.error);
        stopListening();
        
        if (event.error === 'not-allowed') {
          alert("Microphone access denied. Please allow microphone access to use voice input.");
        }
      };
      recognition.onend = () => {
        console.log("Voice recognition ended");
        setIsListening(false);
      };
      
      recognition.start();
    } catch (error) {
      console.error("Error starting speech recognition:", error);
      setIsListening(false);
      alert("Something went wrong with the microphone. Please try again.");
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  };

  const translateToEnglish = async (text: string, type: 'message' | 'suggestion', index: number) => {
    if (locale === 'en') return;
    
    try {
      console.log(`Translating ${type} at index ${index} from ${locale} to English: "${text.substring(0, 30)}..."`);
      
      const response = await fetch('http://localhost:8000/api/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          source: locale,
          target: 'en'
        }),
      });
      
      if (!response.ok) {
        console.error(`Translation API error for ${type} at index ${index}: ${response.status}`);
        return;
      }
      
      const responseText = await response.text();
      console.log(`Raw translation response for ${type} ${index}:`, responseText);
      
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        console.error(`Failed to parse ${type} translation response:`, e);
        return;
      }
      
      if (data && data.translated_text) {
        if (type === 'message') {
          setMessageTranslations(prev => {
            const updated = {...prev, [index]: data.translated_text};
            console.log("Updated message translations:", updated);
            return updated;
          });
        } else {
          setSuggestionTranslations(prev => {
            const updated = {...prev, [index]: data.translated_text};
            console.log(`Updated suggestion translations for index ${index}:`, updated);
            return updated;
          });
        }
      } else {
        console.error(`Translation API returned unexpected format for ${type} at index ${index}:`, data);
      }
    } catch (error) {
      console.error(`Translation error for ${type} at index ${index}:`, error);
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
                <p className="text-xs text-gray-500">Language:
                  {locale === 'en' ? ' English' : 
                  locale === 'zh-CN' ? ' Chinese (Simplified)' :
                  locale === 'zh-TW' ? ' Chinese (Traditional)' :
                  locale === 'ja' ? ' Japanese' :
                  locale === 'ko' ? ' Korean' :
                  locale === 'es' ? ' Spanish' :
                  locale === 'fr' ? ' French' :
                  locale === 'it' ? ' Italian' :
                  locale === 'de' ? ' German' :
                  locale === 'hi' ? ' Hindi' :
                  locale}
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
      {backendConnected === false && (
        <div className="absolute top-8 right-24 bg-red-500 text-white px-3 py-1 rounded-full text-xs">
          Backend disconnected
        </div>
      )}
      <button 
        onClick={handleEndConvo}
        className="absolute top-8 right-8 bg-[#20b2aa] hover:bg-[#008080] px-6 py-2 rounded-lg transition-colors duration-200"
      >
        End Convo
      </button>

      <div className="pt-24 px-4 max-w-6xl mx-auto">
        <div className="flex gap-4">
          <div className="w-[65%]">
            <div className="h-[70vh] bg-[#f0f8ff] rounded-xl p-6 overflow-y-auto mb-4">
              <div className="flex flex-col space-y-4">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {message.sender === 'bot' && (
                    <div className="w-8 h-8 mr-2 flex-shrink-0 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center">
                      <Image
                        src="/icons/robot.png"
                        alt="AI Assistant"
                        width={20}
                        height={20}
                        className="object-contain"
                      />
                    </div>
                  )}
                  
                  <div className="relative">
                    {/* Speaker button */}
                    {message.sender === 'bot' && (
                      <div className="absolute -right-10 top-1/2 transform -translate-y-1/2">
                        <button
                          onClick={() => playEnhancedMessageAudio(index, message.audio_url)}
                          className={`w-8 h-8 rounded-full flex items-center justify-center ${
                            isPlaying === `message-${index}` ? 'bg-blue-400' : 'bg-blue-100'
                          } hover:bg-blue-300 transition-colors`}
                          aria-label={isPlaying === `message-${index}` ? "Stop audio" : "Play audio"}
                          title={isPlaying === `message-${index}` ? "Stop audio" : "Play audio"}
                          disabled={isLoading}
                        >
                          <Image 
                            src={isPlaying === `message-${index}` ? "/icons/pause.png" : "/icons/speaker.png"} 
                            alt={isPlaying === `message-${index}` ? "Stop" : "Speaker"} 
                            width={15} 
                            height={15} 
                            className="filter brightness-0 saturate-100 hue-rotate-180" 
                          />
                        </button>
                      </div>
                    )}
                    {/* Message bubble */}
                    <div
                      className={`max-w-sm rounded-lg px-4 py-2 ${
                        message.sender === 'user' 
                          ? 'bg-blue-500 text-white' 
                          : 'bg-gray-200 text-gray-800'
                      } group relative`}
                    >
                      <div>{message.text}</div>
                      
                      {message.sender === 'bot' && locale !== 'en' && (
                        <div className="mt-2 pt-1 border-t border-gray-300 text-xs text-gray-600">
                          {index === 0 && message.english ? (
                            <div>
                              <span className="font-medium">English:</span> {message.english}
                            </div>
                          ) : messageTranslations[index] ? (
                            <div>
                              <span className="font-medium">English:</span> {messageTranslations[index]}
                              <div className="hidden">{JSON.stringify({index, hasTranslation: !!messageTranslations[index]})}</div>
                            </div>
                          ) : (
                            <div className="italic text-gray-500">
                              Click to see the translation
                              <button 
                                onClick={() => translateToEnglish(message.text, 'message', index)}
                                className="ml-2 text-blue-500 hover:underline"
                              >
                                Translate
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* User Avatar */}
                  {message.sender === 'user' && (
                    <div className="w-8 h-8 ml-2 flex-shrink-0 rounded-full overflow-hidden bg-blue-100 flex items-center justify-center">
                      {user?.photoURL ? (
                        <Image
                          src={user.photoURL}
                          alt="User"
                          width={32}
                          height={32}
                          className="object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-[#48d1cc] flex items-center justify-center text-white font-semibold text-xs">
                          {user?.displayName ? user.displayName.charAt(0).toUpperCase() : 
                          user?.email ? user.email.charAt(0).toUpperCase() : "U"}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="flex items-center space-x-2 bg-gray-100 rounded-lg px-4 py-2">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Voice Input Area */}
            <div className="flex gap-2">
            <button
              onClick={toggleListening}
              className={`${
                isListening 
                  ? 'bg-red-500 hover:bg-red-600' 
                  : 'bg-gray-200 hover:bg-gray-300'
              } px-3 py-3 rounded-lg transition-colors duration-200 flex items-center justify-center relative`}
              aria-label={isListening ? "Stop listening" : "Start voice recognition"}
              disabled={isLoading}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke={isListening ? "white" : "black"}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              {isListening && (
                <span className="absolute top-0 right-0 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                </span>
              )}
            </button>

            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={handleInputChange}
              onKeyPress={handleKeyPress}
              placeholder={isListening ? "Listening..." : "Type your message..."}
              className={`flex-1 bg-white text-black px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                isListening ? 'animate-pulse border-2 border-red-400' : ''
              }`}
              disabled={isListening || isLoading}
            />
              
              <button 
                onClick={handleSendMessage}
                disabled={isRecording || isLoading || !inputText.trim()}
                className="bg-[#20b2aa] hover:bg-[#008080] px-4 py-2 rounded-lg transition-colors duration-200 flex items-center justify-center disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white"></div>
                ) : (
                  <Image src="/icons/send.png" alt="Send" width={24} height={24} />
                )}
              </button>
            </div>
          </div>
          
          <div className="w-[35%] flex flex-col gap-4">
            {/* Suggestions panel */}
            <div className="h-[48vh] bg-[#f0f8ff] rounded-xl p-6 overflow-y-auto">
              <h3 className="text-m font-medium text-gray-800 mb-3">
                Suggestions
                {locale !== 'en' && suggestionList.length > 0 && (
                  <span className="text-xs ml-2 text-gray-500">
                    (in {
                      locale === 'zh-CN' ? 'Chinese (Simplified)' : 
                      locale === 'zh-TW' ? 'Chinese (Traditional)' :
                      locale === 'ja' ? 'Japanese' :
                      locale === 'ko' ? 'Korean' :
                      locale === 'es' ? 'Spanish' :
                      locale === 'fr' ? 'French' :
                      locale === 'it' ? 'Italian' :
                      locale === 'de' ? 'German' :
                      locale === 'hi' ? 'Hindi' :
                      locale
                    })
                  </span>
                )}
              </h3>
              {isLoading && messages.length <= 1 ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[#20b2aa]"></div>
                </div>
              ) : suggestionList.length > 0 ? (
                <div className="space-y-3">
                  {suggestionList.map((suggestion, index) => (
                    <div
                      key={index}
                      className="w-full bg-white rounded-lg p-3 shadow-sm hover:bg-gray-50 transition-colors text-left"
                    >
                      <div 
                        className="w-full flex items-center cursor-pointer"
                        onClick={() => handleSuggestionClick(suggestion)}
                      >
                        <span className="flex-shrink-0 w-6 h-6 bg-[#20b2aa] rounded-full flex items-center justify-center text-white text-xs mr-3">
                          {index + 1}
                        </span>
                        <p className="text-gray-700">{suggestion}</p>
                      </div>
                      
                      {locale !== 'en' && (
                        <div className="mt-1 text-xs text-gray-500 w-full pl-9">
                          {suggestionTranslations[index] ? (
                            <div className="italic">
                              <span className="font-medium">English:</span> {suggestionTranslations[index]}
                              <button
                                onClick={() => {
                                  setSuggestionTranslations(prev => {
                                    const updated = {...prev};
                                    delete updated[index];
                                    return updated;
                                  });
                                }}
                                className="ml-2 text-blue-500 hover:text-blue-700 transition-colors text-xs"
                              >
                                Hide
                              </button>
                            </div>
                          ) : (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                translateToEnglish(suggestion, 'suggestion', index);
                              }}
                              className="text-blue-500 hover:text-blue-700 italic flex items-center transition-colors"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                              </svg>
                              Translate to English
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : messages.length <= 1 ? (
                <div className="bg-gray-50 rounded-lg p-4 text-center">
                  <p className="text-gray-600 mb-2">No suggestions yet</p>
                  <p className="text-gray-500 text-sm">Start a conversation to see relevant suggestions</p>
                </div>
              ) : (
                <div className="bg-gray-50 rounded-lg p-4 text-center">
                  <p className="text-gray-500">Conversation started. Suggestions will appear soon.</p>
                </div>
              )}
            </div>
            
            {/* Dictionary panel */}
            <div className="h-[28vh] bg-[#f0f8ff] rounded-xl p-6 overflow-y-auto mb-2">
              <h3 className="text-m font-medium text-gray-800 mb-3">Dictionary</h3>
              <Dictionary />
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full relative">
            <button 
              onClick={() => setShowModal(false)}
              className="absolute top-3 right-3 text-gray-500 hover:text-gray-700 transition-colors"
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            
            <h2 className="text-xl font-bold text-gray-800 mb-4">Save Conversation?</h2>
            <p className="text-gray-600 mb-6">Do you want to save this conversation?</p>
            
            <div className="flex space-x-3 justify-end">
              <button 
                onClick={handleDiscardConversation}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-800 hover:bg-gray-100 transition-colors"
              >
                Discard
              </button>
              <button 
                onClick={handleSaveConversation}
                className="px-4 py-2 bg-[#20b2aa] text-white rounded-lg hover:bg-[#008080] transition-colors"
              >
                Save & Exit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exit Reminder Modal */}
      {showExitReminder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full relative">
            <button 
              onClick={() => setShowExitReminder(false)}
              className="absolute top-3 right-3 text-gray-500 hover:text-gray-700 transition-colors"
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            
            <h2 className="text-xl font-bold text-gray-800 mb-4">Save Conversation?</h2>
            <p className="text-gray-600 mb-6">
              Do you want to save this conversation?
            </p>
            
            <div className="flex space-x-3 justify-end">
              <button 
                onClick={handleExitWithoutSaving}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-800 hover:bg-gray-100 transition-colors"
              >
                Discard
              </button>
              <button 
                onClick={handleSaveAndExit}
                className="px-4 py-2 bg-[#20b2aa] text-white rounded-lg hover:bg-[#008080] transition-colors"
              >
                Save & Exit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConversationPage;