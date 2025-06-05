"use client"
import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { auth } from "../../../server/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import Dictionary from '@/components/Dictionary';
import { sendChatMessage, getSuggestions } from '@/services/api';

// Add type declarations for Web Speech API
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: (event: any) => void;
  onerror: (event: any) => void;
  onend: () => void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

interface Message {
  text: string;
  sender: 'user' | 'bot';
  audio_url?: string;
}

const ConversationPage = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [userLanguage, setUserLanguage] = useState<string>('en');
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [suggestionList, setSuggestionList] = useState<string[]>([]);
  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const initialSuggestionsFetched = useRef(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const [messageTranslations, setMessageTranslations] = useState<Record<number, string>>({});
  const [suggestionTranslations, setSuggestionTranslations] = useState<Record<number, string>>({});
  const [showExitReminder, setShowExitReminder] = useState(false);
  const [exitDestination, setExitDestination] = useState('');
  const [isSessionSaved, setIsSessionSaved] = useState(false);
  const [discardConversation, setDiscardConversation] = useState(false);
  const [shouldSave, setShouldSave] = useState(false);
  const sessionIdRef = useRef<string>(
    typeof window !== 'undefined' 
      ? sessionStorage.getItem('current_conversation_session') || `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
      : `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  );

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.sender === 'bot' && !isLoading) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [messages, isLoading]);

  useEffect(() => {
    if (!loading && !isLoading) {
      inputRef.current?.focus();
    }
  }, [loading, isLoading]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);
  
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const hasInitialized = useRef(false);

  useEffect(() => {
    if (hasInitialized.current) return; 
    
    setLoading(true);

    const fetchUserInfo = async () => {
      const savedLocale = localStorage.getItem("locale") || "en";
        
      setUserLanguage(savedLocale);
      console.log(`Setting user language to: ${savedLocale}`);

      const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
        setUser(currentUser);

        if (currentUser) {
          try {
            const username = currentUser.displayName || 
                            currentUser.email?.split('@')[0] || 
                            "Guest";
            
            const profileResponse = await fetch(`http://localhost:8000/api/get_user_profile?username=${encodeURIComponent(username)}`);
            
            if (profileResponse.ok) {
              const profileData = await profileResponse.json();
              
              if (profileData.data && (profileData.data.language || profileData.data.locale)) {
                const serverLanguage = profileData.data.language || profileData.data.locale;
                console.log(`Found server language preference: ${serverLanguage}`);
                setUserLanguage(serverLanguage);
                
                localStorage.setItem("locale", serverLanguage);
              }
            }
          } catch (profileError) {
            console.error("Error fetching user profile:", profileError);
          }

          const username = currentUser.displayName || 
                          currentUser.email?.split('@')[0] || 
                          "Guest";

          console.log("User authenticated:", username);
          
          if (!hasInitialized.current) {
            hasInitialized.current = true;
            await initializeConversation(username, savedLocale);
            setIsInitialized(true);
          }
        }

        setLoading(false);
      });

      return () => unsubscribe();
    };

    fetchUserInfo();
  }, []);

  const initializeConversation = async (username: string, language?: string) => {
    try {
      setIsLoading(true);
      console.log("Initializing conversation for:", username);
      
      const languageToUse = language || userLanguage;
      console.log("Language:", languageToUse);
      
      // Initialize with welcome message
      const welcomeMessage = {
        text: getWelcomeMessage(languageToUse),
        sender: "bot" as const,
      };
      
      setMessages([welcomeMessage]);
      
      // Fetch initial suggestions
      const fetchInitialSuggestions = async () => {
        if (initialSuggestionsFetched.current) {
          console.log("Skipping initial suggestions fetch - already fetched");
          return;
        }
        
        console.log("Fetching initial suggestions");
        initialSuggestionsFetched.current = true;
        
        try {
          setIsFetchingSuggestions(true);
          
          const response = await fetch('http://localhost:8000/api/get_suggestions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              username: username.trim(),
              language: languageToUse
            }),
          });
          
          if (response.ok) {
            const data = await response.json();
            if (data && data.suggestions && Array.isArray(data.suggestions)) {
              console.log("Initial suggestions:", data.suggestions);
              setSuggestionList(data.suggestions);
            }
          }
        } catch (suggestError) {
          console.error("Error fetching initial suggestions:", suggestError);
        } finally {
          setIsFetchingSuggestions(false);
        }
      };

      setTimeout(fetchInitialSuggestions, 500);
      
    } catch (error) {
      console.error("Error initializing conversation:", error);
      setMessages([{ 
        text: "I'm having trouble starting our conversation. Please try refreshing the page.", 
        sender: "bot" 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const getWelcomeMessage = (language: string): string => {
    switch (language) {
      case 'ja':
        return 'こんにちは！私はあなたの会話パートナーです。今日は何について話したいですか？';
      case 'zh-CN':
        return '你好！我是你的对话伙伴。今天想聊些什么呢？';
      case 'zh-TW':
        return '你好！我是你的對話夥伴。今天想聊些什麼呢？';
      case 'ko':
        return '안녕하세요! 저는 당신의 대화 파트너입니다. 오늘은 무엇에 대해 이야기하고 싶으세요?';
      case 'es':
        return '¡Hola! Soy tu compañero de conversación. ¿De qué te gustaría hablar hoy?';
      case 'fr':
        return 'Bonjour ! Je suis votre partenaire de conversation. De quoi aimeriez-vous parler aujourd\'hui ?';
      case 'it':
        return 'Ciao! Sono il tuo partner di conversazione. Di cosa vorresti parlare oggi?';
      case 'de':
        return 'Hallo! Ich bin dein Gesprächspartner. Worüber möchtest du heute sprechen?';
      case 'hi':
        return 'नमस्ते! मैं आपका वार्तालाप साथी हूँ। आज आप किस बारे में बात करना चाहेंगे?';
      default:
        return "Hello! I'm your conversation partner. What would you like to talk about today?";
    }
  };

  const lastFetchTime = useRef(0);

  const arraysEqual = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setShowProfileMenu(false);
      }
    }
    
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleBackClick = () => {
    setShowExitReminder(true);
    setExitDestination('/choose');
  };
  
  const navigateToDashboard = () => {
    router.push('/dashboard');
    setShowProfileMenu(false);
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(event.target.value);
  };

  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleSendMessage();
    }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;
    
    const userMessage = inputText.trim();
    setMessages(prev => [...prev, { text: userMessage, sender: 'user' }]);
    setInputText('');
    setIsLoading(true);
    setSuggestionList([]);
    
    try {
      const username = user ? (user.displayName || user.email?.split('@')[0] || 'Guest') : 'Guest';
      
      if (!username || !userMessage) {
        console.error("Missing username or message:", { username, message: userMessage });
        throw new Error("Username and message are required");
      }
      
      const currentLanguage = userLanguage;
      console.log(`Sending message in language: ${currentLanguage}`);
      
      try {
        const profileUpdateResponse = await fetch('http://localhost:8000/api/set_user_profile', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username: username.trim(),
            language: currentLanguage,
            locale: currentLanguage
          }),
        });
          
        if (!profileUpdateResponse.ok) {
          console.warn("Failed to update language preference on server");
        } else {
          console.log(`Successfully synchronized language to ${currentLanguage} before sending message`);
        }
      } catch (error) {
        console.error("Error updating language preference:", error);
      }
      
      // Call API to get response
      const response = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username,
          message: userMessage,
          user_locale: currentLanguage,
          response_locale: currentLanguage,
          voice_locale: currentLanguage,
          reset_language_context: false,
          force_language: false,
          save_to_history: true,
          is_discarded: false,
          conversation_id: null,
          batch_id: sessionIdRef.current
        }),
      });
      
      if (!response.ok) {
        console.error("Error from API:", response.status);
        setMessages(prev => [
          ...prev,
          { text: `Connection error: ${response.status}. Please try again.`, sender: 'bot' }
        ]);
        return;
      }

      const responseData = await response.json();
      
      if (responseData) {
        console.log("Received response data:", responseData);
        
        const botResponse = 
          responseData.message || 
          responseData.response ||
          responseData.ai_response || 
          "I'm sorry, I couldn't generate a response.";
        
        const botMessage = { 
          text: botResponse, 
          sender: 'bot' as const,
          audio_url: responseData.audio_url
        };
        
        setMessages(prev => [...prev, botMessage]);
          
        if (currentLanguage !== 'en') {
          const botMessageIndex = messages.length; 
          translateToEnglish(botResponse, 'message', botMessageIndex);
        }
        
        console.log("Scheduling suggestion fetch after message");
        setTimeout(() => {
          if (!isFetchingSuggestions) {
            console.log("Executing post-message suggestion fetch");
            fetchSuggestions(username, currentLanguage); 
          } else {
            console.log("Skipping post-message suggestion fetch - already fetching");
          }
        }, 1500);
      } else {
        console.error("Empty response data");
        setMessages(prev => [
          ...prev,
          { text: "I received an empty response. Please try again.", sender: 'bot' }
        ]);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => [
        ...prev,
        { text: "Sorry, I'm having trouble connecting. Please try again.", sender: 'bot' }
      ]);
    } finally {
      setIsLoading(false);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  };

  useEffect(() => {
    setSuggestionTranslations({});
  }, [suggestionList]);

  const fetchSuggestions = async (username: string, language?: string) => {
    if (isFetchingSuggestions) {
      console.log("Skipping suggestion fetch - already in progress");
      return;
    }
    
    const now = Date.now();
    if (now - lastFetchTime.current < 3000) {
      console.log("Debouncing suggestion fetch - too soon since last fetch");
      return;
    }
      
    try {
      setIsFetchingSuggestions(true);
      lastFetchTime.current = now;
      
      const currentLanguage = language || userLanguage;
      console.log(`Fetching suggestions for: ${username} in language: ${currentLanguage}`);
      
      const response = await fetch('http://localhost:8000/api/get_suggestions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: username.trim(),
          language: currentLanguage
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data && data.suggestions && Array.isArray(data.suggestions)) {
          const newSuggestions = data.suggestions;
          console.log("Received suggestions:", newSuggestions);
          
          if (!arraysEqual(suggestionList, newSuggestions)) {
            console.log("Updating suggestions state");
            setSuggestionList(newSuggestions);
            setSuggestionTranslations({});
          } else {
            console.log("Suggestions unchanged, not updating state");
          }
        }
      } else {
        console.error("Error fetching suggestions:", await response.text());
      }
    } catch (error) {
      console.error("Error fetching suggestions:", error);
    } finally {
      setIsFetchingSuggestions(false);
    }
  };

  const handleEndConvo = () => {
    setShowModal(true);
  };

  const handleSaveConversation = async () => {
    try {
      setIsLoading(true);
      
      const currentUsername = user?.displayName || user?.email?.split('@')[0] || 'Guest';
      
      if (!sessionIdRef.current) {
        sessionIdRef.current = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      }
      
      console.log(`Using session ID: ${sessionIdRef.current} for conversation`);
      
      const formattedConversation = messages.map((msg, index) => {
        const timestamp = new Date().toISOString();
        
        const baseMessage = {
          timestamp,
          batch_id: sessionIdRef.current,
          is_discarded: false,
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
      
      // Add debug info to track the actual data being sent
      console.log("Sending payload:", JSON.stringify({
        username: currentUsername,
        conversation: formattedConversation,
        is_discarded: false,
        batch_id: sessionIdRef.current
      }));
      
      const response = await fetch('http://localhost:8000/api/save_conversation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: currentUsername,
          conversation: formattedConversation,
          is_discarded: false,
          batch_id: sessionIdRef.current
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
      
      const currentUser = user?.displayName || user?.email?.split('@')[0] || 'Guest';
      
      // Generate a batch ID if we don't have one
      if (!sessionIdRef.current) {
        sessionIdRef.current = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      }
      
      // Format the messages properly for the API
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
    const currentUser = user?.displayName || user?.email?.split('@')[0] || 'Guest';
    
    // First, mark all messages as discarded in the backend
    fetch('http://localhost:8000/api/clear_conversation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: currentUser,
        batch_id: sessionIdRef.current,
        force_clear: false 
      }),
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }
      return response.json();
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

  const handleExitWithoutSaving = () => {
    console.log("**** EXITING WITHOUT SAVING CONVERSATION ****");
    
    // Set flags
    localStorage.setItem('discardedConversation', 'true');
    setDiscardConversation(true);
    setShouldSave(false);
    setIsSessionSaved(false);
    
    // Get current username
    const savedUsername = user?.displayName || user?.email?.split('@')[0] || 'Guest';
    
    // Clear this conversation on server
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
      
      // Navigate away
      router.push(exitDestination);
    })
    .catch(e => {
      console.error("Error clearing conversation:", e);
      setShowExitReminder(false);
      router.push(exitDestination);
    });
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
    if (!isListening) {
      setIsListening(true);
      
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      
      if (!SpeechRecognition) {
        alert("Speech recognition is not supported in your browser. Please try Chrome, Edge or Safari.");
        setIsListening(false);
        return;
      }
      
      try {
        const recognition = new SpeechRecognition();
        recognitionRef.current = recognition;
        
        recognition.continuous = false;
        recognition.interimResults = false;
        
        recognition.lang = userLanguage === 'en' ? 'en-US' : 
                            userLanguage === 'zh-CN' ? 'zh-CN' :
                            userLanguage === 'zh-TW' ? 'zh-TW' :
                            userLanguage === 'ja' ? 'ja-JP' :
                            userLanguage === 'ko' ? 'ko-KR' :
                            userLanguage === 'es' ? 'es-ES' :
                            userLanguage === 'fr' ? 'fr-FR' :
                            userLanguage === 'it' ? 'it-IT' :
                            userLanguage === 'de' ? 'de-DE' :
                            userLanguage === 'hi' ? 'hi-IN' : 'en-US';
        
        recognition.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          setInputText(prev => prev + transcript + " ");
        };
        
        recognition.onerror = (event: any) => {
          console.error('Speech recognition error', event);
          setIsListening(false);
        };
        
        recognition.onend = () => {
          setIsListening(false);
        };
        
        recognition.start();
        
      } catch (error) {
        console.error("Error initializing speech recognition:", error);
        setIsListening(false);
        alert("There was a problem starting speech recognition. Please try again.");
      }
    } else {
      stopListening();
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (error) {
        console.error("Error stopping recognition:", error);
      }
    }
    setIsListening(false);
  };

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          console.error("Error cleaning up speech recognition:", e);
        }
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const loadVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
          console.log(`Loaded ${voices.length} speech synthesis voices`);
          
          const currentLangVoices = voices.filter(v => v.lang.startsWith(userLanguage.split('-')[0]));
          console.log(`Available ${userLanguage} voices:`, currentLangVoices.map(v => `${v.name} (${v.lang})`));
        } else {
          setTimeout(loadVoices, 100);
        }
      };
      
      loadVoices();
      
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
      }
    }
  }, [userLanguage]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const translateToEnglish = async (text: string, type: 'message' | 'suggestion', index: number) => {
    if (userLanguage === 'en') return;
    
    try {
      console.log(`Translating ${type} at index ${index} from ${userLanguage} to English: "${text.substring(0, 30)}..."`);
      
      const response = await fetch('http://localhost:8000/api/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          source: userLanguage,
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
          setMessageTranslations(prev => ({...prev, [index]: data.translated_text}));
        } else {
          setSuggestionTranslations(prev => ({...prev, [index]: data.translated_text}));
        }
      } else {
        console.error(`Translation API returned unexpected format for ${type} at index ${index}:`, data);
      }
    } catch (error) {
      console.error(`Translation error for ${type} at index ${index}:`, error);
    }
  };

  const getLanguageName = (langCode: string): string => {
    const langMap: Record<string, string> = {
      'en': 'English',
      'zh-CN': 'Chinese (Simplified)',
      'zh-TW': 'Chinese (Traditional)',
      'ja': 'Japanese',
      'ko': 'Korean',
      'es': 'Spanish',
      'fr': 'French',
      'it': 'Italian',
      'de': 'German',
      'hi': 'Hindi'
    };
    
    return langMap[langCode] || langCode;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ backgroundImage: "url('/icons/background1.jpg')", backgroundSize: "cover" }}>
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#48d1cc]"></div>
      </div>
    );
  }

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
              playOptimizedBrowserTTS(message.text, userLanguage);
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
      await playOptimizedBrowserTTS(message.text, userLanguage);
      
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
      
      const voiceConfig = voiceParams[userLanguage] || { voice_type: 'neural' };
      
      const response = await fetch('http://localhost:8000/api/generate_audio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          language: userLanguage,
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
            playOptimizedBrowserTTS(text, userLanguage);
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
            await playOptimizedBrowserTTS(text, userLanguage);
          }
        } else {
          console.error("Backend TTS response missing audio_url:", data);
          await playOptimizedBrowserTTS(text, userLanguage);
        }
      } else {
        try {
          const errorData = await response.text();
          console.error(`Backend TTS failed (${response.status}):`, errorData);
        } catch (e) {
          console.error(`Backend TTS failed with status: ${response.status}`);
        }
        await playOptimizedBrowserTTS(text, userLanguage);
      }
    } catch (error) {
      console.error('Backend TTS error:', error);
      await playOptimizedBrowserTTS(text, userLanguage);
    }
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

  return (
    <div className="min-h-screen bg-gray-900 text-white relative"
      style={{
        backgroundImage: "url('/icons/background1.jpg')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundAttachment: "fixed"
      }}
    >
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
              <p className="text-xs text-gray-500">Language: {
                userLanguage === 'en' ? 'English' : 
                userLanguage === 'zh-CN' ? 'Chinese (Simplified)' :
                userLanguage === 'zh-TW' ? 'Chinese (Traditional)' :
                userLanguage === 'ja' ? 'Japanese' :
                userLanguage === 'ko' ? 'Korean' :
                userLanguage === 'es' ? 'Spanish' :
                userLanguage === 'fr' ? 'French' :
                userLanguage === 'it' ? 'Italian' :
                userLanguage === 'de' ? 'German' :
                userLanguage === 'hi' ? 'Hindi' : userLanguage
              }</p>
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
              <button 
                onClick={navigateToDashboard}
                className="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors flex items-center"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                Profile Dashboard
              </button>
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
      
      <button 
        onClick={handleEndConvo}
        className="absolute top-8 right-8 bg-[#20b2aa] hover:bg-[#008080] px-6 py-2 rounded-lg transition-colors duration-200"
      >
        End Convo
      </button>
      
      <div className="pt-24 px-4 max-w-6xl mx-auto">
        <div className="flex gap-4">
          {/* Conversation area - left side */}
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
                        
                        {message.sender === 'bot' && userLanguage !== 'en' && (
                          <div className="mt-2 pt-1 border-t border-gray-300 text-xs">
                            {!messageTranslations[index] ? (
                              <div className="italic text-gray-500">
                                <button 
                                  onClick={() => translateToEnglish(message.text, 'message', index)}
                                  className="text-blue-500 hover:underline"
                                >
                                  Translate to English
                                </button>
                              </div>
                            ) : (
                              <div className="text-gray-600">
                                <span className="font-medium">English:</span> {messageTranslations[index]}
                                <button
                                  onClick={() => {
                                    setMessageTranslations(prev => {
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

            {/* Input area */}
            <div className="flex gap-2">
              <button
                onClick={toggleListening}
                className={`${
                  isListening 
                    ? 'bg-red-500 hover:bg-red-600' 
                    : 'bg-gray-200 hover:bg-gray-300'
                } px-3 py-3 rounded-lg transition-colors duration-200 flex items-center justify-center relative`}
                aria-label={isListening ? "Stop recording" : "Start recording"}
                title={isListening ? "Stop recording" : `Start recording in ${getLanguageName(userLanguage)}`}
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
                disabled={isLoading || !inputText.trim()}
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

          {/* Right side - suggestions and dictionary */}
          <div className="w-[35%] flex flex-col gap-4">
            <div className="h-[48vh] bg-[#f0f8ff] rounded-xl p-6 overflow-y-auto">
              <h3 className="text-m font-medium text-gray-800 mb-3">
                Suggestions
                {userLanguage !== 'en' && suggestionList.length > 0 && (
                  <span className="text-xs ml-2 text-gray-500">
                    (in {
                      userLanguage === 'zh-CN' ? 'Chinese (Simplified)' : 
                      userLanguage === 'zh-TW' ? 'Chinese (Traditional)' :
                      userLanguage === 'ja' ? 'Japanese' :
                      userLanguage === 'ko' ? 'Korean' :
                      userLanguage === 'es' ? 'Spanish' :
                      userLanguage === 'fr' ? 'French' :
                      userLanguage === 'it' ? 'Italian' :
                      userLanguage === 'de' ? 'German' :
                      userLanguage === 'hi' ? 'Hindi' :
                      userLanguage
                    })
                  </span>
                )}
              </h3>
              
              {isFetchingSuggestions ? (
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
                      
                      {userLanguage !== 'en' && (
                        <div className="mt-1 text-xs w-full pl-9">
                          {!suggestionTranslations[index] && (
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
                          
                          {suggestionTranslations[index] && (
                            <div className="italic text-gray-500">
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
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-gray-50 rounded-lg p-4 text-center">
                  <p className="text-gray-500">Waiting for suggestions...</p>
                </div>
              )}
            </div>
            
            {/* Dictionary panel */}
            <div className="h-[28vh] bg-[#f0f8ff] rounded-xl p-6 overflow-y-auto mb-2">
              <h3 className="text-m font-medium text-gray-800 mb-3">Dictionary</h3>
              <Dictionary/>
            </div>
          </div>
        </div>
      </div>
      
      {showModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 relative">
            <button 
              onClick={() => setShowModal(false)}
              className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close modal"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            
            <h3 className="text-xl font-bold text-gray-800 mb-4">Save Conversation?</h3>
            <p className="text-gray-600 mb-6">Do you want to save this conversation?</p>
            
            <div className="flex gap-4 justify-end">
              <button 
                onClick={handleDiscardConversation}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg transition-colors"
              >
                Discard
              </button>
              <button 
                onClick={handleSaveConversation}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
              >
                Save & Exit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exit Reminder Modal */}
      {showExitReminder && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 relative">
            <button 
              onClick={() => setShowExitReminder(false)}
              className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close modal"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            
            <h3 className="text-xl font-bold text-gray-800 mb-4">Save Conversation?</h3>
            <p className="text-gray-600 mb-6">Do you want to save this conversation?</p>
            
            <div className="flex gap-4 justify-end">
              <button 
                onClick={handleExitWithoutSaving}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg transition-colors"
              >
                Discard
              </button>
              <button 
                onClick={handleSaveAndExit}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
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