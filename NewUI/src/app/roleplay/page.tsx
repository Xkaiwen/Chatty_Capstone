"use client"
import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { auth } from "../../../server/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import Dictionary from '@/components/Dictionary';
import { sendChatMessage, getSuggestions, setScenario as setScenarioAPI, getScenarioResponse, saveScenarioConversation } from '@/services/api';

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


interface Scenario {
  id: string;
  title: string;
  description: string;
  created_at: string;
  custom: boolean;
}

interface Message {
  text: string;
  sender: 'user' | 'bot';
  audio_url?: string;
}

const RoleplayPage = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [userLanguage, setUserLanguage] = useState<string>('en');
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [scenario, setScenario] = useState<Scenario | null>(null);
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
  const [preparingAudio, setPreparingAudio] = useState<string | null>(null);

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

    const fetchUserAndScenario = async () => {
      try {
        const savedScenario = localStorage.getItem("currentScenario");

        if (!savedScenario) {
          alert("No scenario selected. Please select a scenario first.");
          router.push("/scenario");
          return;
        }

        const parsedScenario = JSON.parse(savedScenario);
        setScenario(parsedScenario);

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
            console.log("Using scenario:", parsedScenario.title);
            console.log("Final language being used:", userLanguage);

            if (!hasInitialized.current) {
            hasInitialized.current = true;
            await initializeRoleplayConversation(username, parsedScenario, savedLocale);
              setIsInitialized(true);
            }
          }

          setLoading(false);
        });

        return () => unsubscribe();
      } catch (error) {
        console.error("Error loading user scenario:", error);
        alert("There was a problem loading the scenario. Please try again.");
        router.push("/scenario");
      }
    };

    fetchUserAndScenario();
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const loadVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
          console.log(`Loaded ${voices.length} speech synthesis voices`);
          
          const currentLangVoices = voices.filter(v => v.lang.startsWith(userLanguage.split('-')[0]));
          console.log(`Available ${userLanguage} voices:`, currentLangVoices.map(v => `${v.name} (${v.lang})`));
        }
      };
      
      loadVoices();
      
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
      }
    }
    
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const initializeRoleplayConversation = async (
    username: string, 
    scenario: Scenario,
    language?: string
  ) => {
    try {
      setIsLoading(true);
      console.log("Initializing roleplay conversation for:", username);
      console.log("Current scenario:", scenario);
      
      // Get raw language and normalize it
      const rawLanguage = language || userLanguage;
      const languageToUse = 
        rawLanguage === 'ko' ? 'ko-KR' : 
        rawLanguage === 'ja' ? 'ja-JP' : 
        rawLanguage;
      
      console.log(`Raw language: ${rawLanguage}, Normalized language: ${languageToUse}`);
      
      setMessages([]);
      
      console.log("Setting scenario:", {
        username,
        title: scenario.title,
        language: languageToUse,
        description: scenario.description
      });
      
      const scenarioResponse = await setScenarioAPI(
        username,
        scenario.title,
        languageToUse,
        scenario.description || "No description provided" 
      );
      
      console.log("Scenario API response:", scenarioResponse);
      
      if (scenarioResponse.error) {
        console.error("Error setting scenario:", scenarioResponse.error);
        setMessages([{ 
          text: "I'm having trouble setting up the scenario. Please try again.", 
          sender: "bot" 
        }]);
        return;
      }
      
      const fallbackMessage = {
        text: `Welcome to the ${scenario.title} scenario! How can I help you today?`,
        sender: "bot" as const
      };
      
      let initialMessageSet = false;
      
      try {
        console.log("Getting initial AI response for:", username);
        console.log("Using language for initial response:", languageToUse);
        
        const response = await getScenarioResponse(username, languageToUse);
        
        console.log("Get scenario response result:", response);
        
        if (response.error) {
          console.error("Error getting scenario response:", response.error);
          setMessages([fallbackMessage]);
        } else if (response.data && response.data.response) {
          setMessages([{ 
            text: response.data.response, 
            sender: "bot",
            audio_url: response.data.audio_url || undefined
          }]);
          initialMessageSet = true;
        } else {
          console.warn("No response data from AI, using fallback");
          setMessages([fallbackMessage]);
        }
      } catch (error) {
        console.error("Error in getScenarioResponse:", error);
        setMessages([fallbackMessage]);
      }
      const fetchInitialSuggestions = async () => {
        if (!initialMessageSet || initialSuggestionsFetched.current) {
          console.log("Skipping initial suggestions fetch - already fetched or no initial message");
          return;
        }
        
        console.log("Fetching initial suggestions");
        initialSuggestionsFetched.current = true;
        
        try {
          setIsFetchingSuggestions(true);
          
          const suggestionsResponse = await getSuggestions(
            username, 
            languageToUse, 
            false, 
            scenario.title
          );
          
          if (suggestionsResponse && suggestionsResponse.data && !suggestionsResponse.error) {
            console.log("Initial suggestions:", suggestionsResponse.data.suggestions);
            setSuggestionList(suggestionsResponse.data.suggestions);
          }
        } catch (suggestError) {
          console.error("Error fetching initial suggestions:", suggestError);
        } finally {
          setIsFetchingSuggestions(false);
          lastFetchTime.current = Date.now();
        }
      };

      setTimeout(fetchInitialSuggestions, 500);
      
    } catch (error) {
      console.error("Error initializing roleplay conversation:", error);
      setMessages([{ 
        text: "I'm having trouble starting our conversation. Please try refreshing the page.", 
        sender: "bot" 
      }]);
    } finally {
      setIsLoading(false);
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
    setShowModal(true);
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

  const playMessageAudio = (messageId: number, audioUrl?: string) => {
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
        setPreparingAudio(`message-${messageId}`);
        
        try {
          const checkResponse = fetch(fullAudioUrl, { method: 'HEAD' })
            .then(response => {
              if (response.ok) {
                console.log("Audio file exists at URL");
                
                const audio = new Audio();
                
                audio.addEventListener('canplaythrough', () => {
                  setPreparingAudio(null);
                });
                
                audio.addEventListener('ended', () => {
                  console.log('Audio playback ended');
                  setIsPlaying(null);
                  audioRef.current = null;
                });
                
                audio.addEventListener('error', (e) => {
                  console.log('Audio playback error:', e);
                  audioRef.current = null;
                  setIsPlaying(null);
                  setPreparingAudio(null);
                  console.log("Falling back to browser TTS due to audio error");
                  playOptimizedBrowserTTS(message.text, userLanguage);
                });
                
                audioRef.current = audio;
                audio.src = fullAudioUrl;
                audio.load();
                
                audio.play().then(() => {
                  console.log("Audio playing successfully from URL");
                }).catch(playError => {
                  console.error("Error playing audio from URL:", playError);
                  setIsPlaying(null);
                  audioRef.current = null;
                  setPreparingAudio(null);
                  console.log("Falling back to browser TTS due to play error");
                  playOptimizedBrowserTTS(message.text, userLanguage);
                });
                
              } else {
                console.error(`Audio file not accessible (${response.status})`);
                setPreparingAudio(null);
                console.log("Falling back to generating new audio");
                playBackendTTS(message.text, messageId);
              }
            })
            .catch(checkError => {
              console.error("Error checking audio file:", checkError);
              setPreparingAudio(null);
              playBackendTTS(message.text, messageId);
            });
        } catch (error) {
          console.error("Error setting up audio playback:", error);
          setPreparingAudio(null);
          playBackendTTS(message.text, messageId);
        }
      } else {
        playBackendTTS(message.text, messageId);
      }
      
    } catch (error) {
      console.error('All audio methods failed:', error);
      setIsPlaying(null);
      setPreparingAudio(null);
    }
  };

  const playBackendTTS = async (text: string, messageId: number) => {
    try {
      console.log(`Generating audio via backend for: "${text.substring(0, 30)}..."`);
      setPreparingAudio(`message-${messageId}`);

      const rawLanguage = userLanguage;
      const normalizedLanguage = 
        rawLanguage === 'ko' ? 'ko-KR' : 
        rawLanguage === 'ja' ? 'ja-JP' : 
        rawLanguage;
      
    const voiceParams: Record<string, { voice_type: string, model?: string, voice_id?: string }> = {
      'en': { voice_type: 'neural', model: 'en-US-Neural2-F' },
      'ja': { voice_type: 'neural', model: 'ja-JP-Neural2-B' },
      'ja-JP': { voice_type: 'neural', model: 'ja-JP-Neural2-B' }, 
      'zh-CN': { voice_type: 'neural', model: 'cmn-CN-Neural2-A' },
      'zh-TW': { voice_type: 'neural', model: 'cmn-TW-Neural2-A' },
      'ko': { voice_type: 'neural', model: 'ko-KR-Neural2-A' },
      'ko-KR': { voice_type: 'neural', model: 'ko-KR-Neural2-A' }, 
      'es': { voice_type: 'neural', model: 'es-ES-Neural2-A' },
      'fr': { voice_type: 'neural', model: 'fr-FR-Neural2-A' },
      'it': { voice_type: 'neural', model: 'it-IT-Neural2-A' },
      'de': { voice_type: 'neural', model: 'de-DE-Neural2-B' },
      'hi': { voice_type: 'neural', model: 'hi-IN-Neural2-A' }
    };
      
      const voiceConfig = voiceParams[normalizedLanguage] || voiceParams[rawLanguage] || { voice_type: 'neural' };
      
      console.log(`Using TTS language: ${normalizedLanguage} (from ${rawLanguage})`);
      console.log(`Voice config:`, voiceConfig);
      
      const response = await fetch('http://localhost:8000/api/generate_audio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          language: normalizedLanguage,
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
          
          audio.addEventListener('canplaythrough', () => {
            setPreparingAudio(null);
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
            setPreparingAudio(null);
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
            setPreparingAudio(null);
            await playOptimizedBrowserTTS(text, userLanguage);
          }
        } else {
          console.error("Backend TTS response missing audio_url:", data);
          setPreparingAudio(null);
          await playOptimizedBrowserTTS(text, userLanguage);
        }
      } else {
        try {
          const errorData = await response.text();
          console.error(`Backend TTS failed (${response.status}):`, errorData);
        } catch (e) {
          console.error(`Backend TTS failed with status: ${response.status}`);
        }
        setPreparingAudio(null);
        await playOptimizedBrowserTTS(text, userLanguage);
      }
    } catch (error) {
      console.error('Backend TTS error:', error);
      setPreparingAudio(null);
      await playOptimizedBrowserTTS(text, userLanguage);
    }
  };

  const playOptimizedBrowserTTS = async (text: string, language: string): Promise<boolean> => {
    return new Promise((resolve) => {
      try {
        if (!window.speechSynthesis) {
          console.log("Speech synthesis not available");
          setIsPlaying(null);
          setPreparingAudio(null);
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
                'Google 한국어', 'Microsoft Heami', 'Yuna'
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
            setPreparingAudio(null);
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
            setPreparingAudio(null);
          };
          
          utterance.onend = () => {
            console.log(`TTS playback ended for ${language}`);
            setIsPlaying(null);
            resolve(true);
          };
          
          utterance.onerror = (event) => {
            console.error('Browser TTS error:', event);
            setIsPlaying(null);
            setPreparingAudio(null);
            resolve(false);
          };
          
          window.speechSynthesis.speak(utterance);
        }
        
      } catch (error) {
        console.error('Browser TTS error:', error);
        setIsPlaying(null);
        setPreparingAudio(null);
        resolve(false);
      }
    });
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || !scenario) return;
    
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
      
      const rawLanguage = userLanguage;
      const currentLanguage = 
        rawLanguage === 'ko' ? 'ko-KR' : 
        rawLanguage === 'ja' ? 'ja-JP' : 
        rawLanguage;
      
      console.log(`Sending message in raw language: ${rawLanguage}`);
      console.log(`Normalized to: ${currentLanguage}`);
      
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
      
      const response = await sendChatMessage(
        username,
        userMessage,
        currentLanguage, 
        scenario.title, 
        currentLanguage,
        null
      );
      
      if (response.error) {
        console.error("Error from API:", response.error);
        setMessages(prev => [
          ...prev,
          { text: `Connection error: ${response.error}. Please try again.`, sender: 'bot' }
        ]);
        return;
      }

      if (response.data) {
        console.log("Received response data:", response.data);
        
        const botResponse = 
          response.data.message || 
          (response.data as any).response ||
          (response.data as any).ai_response || 
          "I'm sorry, I couldn't generate a response.";
        
        const botMessage = { 
          text: botResponse, 
          sender: 'bot' as const,
          audio_url: (response.data as any).audio_url || undefined
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
      
      const rawLanguage = language || userLanguage;
      
      // Normalize language code to ensure consistency for Korean and Japanese
      const normalizedLanguage = 
        rawLanguage === 'ko' ? 'ko-KR' : 
        rawLanguage === 'ja' ? 'ja-JP' : 
        rawLanguage;
      console.log(`Fetching suggestions for: ${username} in language: ${normalizedLanguage}`);
      console.log(`Using scenario: ${scenario?.title || 'undefined'}`);
      
      const response = await getSuggestions(
        username, 
        normalizedLanguage, 
        false,
        scenario?.title
      );
      
      if (response && response.data && !response.error) {
        const newSuggestions = response.data.suggestions;
        console.log("Received suggestions:", newSuggestions);
        
        if (!arraysEqual(suggestionList, newSuggestions)) {
          console.log("Updating suggestions state");
          setSuggestionList(newSuggestions);
          setSuggestionTranslations({});
        } else {
          console.log("Suggestions unchanged, not updating state");
        }
      } else if (response && response.error) {
        console.error("Error fetching suggestions:", response.error);
      }
    } catch (error) {
      console.error("Error fetching suggestions:", error);
    } finally {
      setIsFetchingSuggestions(false);
    }
  };

  const handleEndScenario = () => {
    setShowModal(true);
  };

  const handleSaveConversation = async () => {
    try {
      if (!scenario || !user) {
        console.warn("Missing scenario or user information");
        return;
      }
      
      const username = user.displayName || user.email?.split('@')[0] || 'Guest';
      console.log(`Saving conversation for user: ${username}`);
      
      // Format the conversation data for the backend API
      const formattedMessages = messages.map(msg => ({
        text: msg.text,
        sender: msg.sender,
        audio_url: msg.audio_url || null,
        timestamp: new Date().toISOString()
      }));
      
      // Use the /api/save_scenario_messages endpoint instead
      const response = await fetch('http://localhost:8000/api/save_scenario_messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: username,
          scenario_title: scenario.title,
          messages: formattedMessages,
          is_custom_scenario: !!scenario.custom,
          language: userLanguage,
          created_at: new Date().toISOString()
        })
      });
      
      const responseText = await response.text();
      console.log(`API response (${response.status}):`, responseText);
      
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch (e) {
        console.error("Response is not valid JSON:", e);
        if (!response.ok) {
          throw new Error(`Server error: ${response.status} - ${responseText}`);
        }
      }
      
      if (!response.ok) {
        throw new Error(responseData?.detail || `Server error: ${response.status}`);
      }
      
      console.log("Conversation saved successfully:", responseData);
      
      // Also save to local storage as backup
      const newConversationEntry = {
        id: responseData?.conversation_id || Date.now().toString(),
        date: new Date().toISOString(),
        scenario: scenario.title,
        messages: messages,
        userName: username,
        language: userLanguage
      };
      
      const STORAGE_KEY = "allRoleplayConversations";
      
      // Load existing conversations
      let allConversations: Record<string, Array<typeof newConversationEntry>> = {};
      try {
        const existingData = localStorage.getItem(STORAGE_KEY);
        if (existingData) {
          allConversations = JSON.parse(existingData);
        }
      } catch (parseError) {
        console.error("Error parsing existing conversations:", parseError);
      }
      
      // Add new conversation to appropriate scenario group
      const scenarioType = scenario.title.toLowerCase().replace(/\s+/g, '_');
      if (!allConversations[scenarioType]) {
        allConversations[scenarioType] = [];
      }
      allConversations[scenarioType].push(newConversationEntry);
      
      // Save to localStorage with error handling
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(allConversations));
      } catch (storageError) {
        console.error("Error saving to localStorage:", storageError);
        try {
          // Try a smaller version without audio URLs if storage limit is reached
          const smallerPayload = {...allConversations};
          Object.keys(smallerPayload).forEach(key => {
            smallerPayload[key] = smallerPayload[key].map(conv => ({
              ...conv,
              messages: conv.messages.map(m => ({...m, audio_url: undefined}))
            }));
          });
          localStorage.setItem(STORAGE_KEY, JSON.stringify(smallerPayload));
        } catch (fallbackError) {
          console.error("Failed to save even smaller version:", fallbackError);
        }
      }
      
      // Navigate back to scenario page
      router.push('/scenario');
    } catch (error) {
      console.error("Error saving conversation:", error);
      alert("There was an error saving your conversation. Please try again.");
    }
  };

  const handleDiscardConversation = () => {
    router.push('/scenario');
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInputText(suggestion);
  };

  const toggleRecording = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  useEffect(() => {
    console.log("Language changed to:", userLanguage);
    
    if (hasInitialized.current && user) {
      const username = user.displayName || user.email?.split('@')[0] || 'Guest';
      
      const normalizedLanguage = 
        userLanguage === 'ko' ? 'ko-KR' : 
        userLanguage === 'ja' ? 'ja-JP' : 
        userLanguage;
      
      console.log(`Using normalized language: ${normalizedLanguage} for profile update`);
      
      try {
        fetch('http://localhost:8000/api/set_user_profile', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              username: username.trim(),
              language: normalizedLanguage,
              locale: normalizedLanguage
            }),
          });
          
        localStorage.setItem("locale", normalizedLanguage);
      } catch (error) {
        console.error("Error updating language preference:", error);
      }
      
      setSuggestionTranslations({});
      setMessageTranslations({});
      
      fetchSuggestions(username, normalizedLanguage);
    }
  }, [userLanguage]);

  const [messageTranslations, setMessageTranslations] = useState<Record<number, string>>({});
  const [suggestionTranslations, setSuggestionTranslations] = useState<Record<number, string>>({});

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
        
        recognition.lang = 
          userLanguage === 'en' ? 'en-US' : 
          userLanguage === 'zh-CN' ? 'zh-CN' :
          userLanguage === 'zh-TW' ? 'zh-TW' :
          userLanguage === 'ja' ? 'ja-JP' :
          userLanguage === 'ko' ? 'ko-KR' :
          userLanguage === 'es' ? 'es-ES' :
          userLanguage === 'fr' ? 'fr-FR' :
          userLanguage === 'it' ? 'it-IT' :
          userLanguage === 'de' ? 'de-DE' :
          userLanguage === 'hi' ? 'hi-IN' : 'en-US';
        
        console.log(`Speech recognition using language: ${recognition.lang} (from ${userLanguage})`);
        
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
        onClick={handleEndScenario}
        className="absolute top-8 right-8 bg-[#20b2aa] hover:bg-[#008080] px-6 py-2 rounded-lg transition-colors duration-200"
      >
        End Scenario
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
                            onClick={() => playMessageAudio(index, message.audio_url)}
                            className={`w-8 h-8 rounded-full flex items-center justify-center ${
                              isPlaying === `message-${index}` ? 'bg-blue-400' : 
                              preparingAudio === `message-${index}` ? 'bg-yellow-200' : 'bg-blue-100'
                            } hover:bg-blue-300 transition-colors`}
                            aria-label={isPlaying === `message-${index}` ? "Stop pronunciation" : "Play pronunciation"}
                            title={isPlaying === `message-${index}` ? "Stop pronunciation" : "Play high-quality pronunciation"}
                            disabled={preparingAudio === `message-${index}`}
                          >
                            {preparingAudio === `message-${index}` ? (
                              <div className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin"></div>
                            ) : (
                              <Image 
                                src={isPlaying === `message-${index}` ? "/icons/pause.png" : "/icons/speaker.png"} 
                                alt={isPlaying === `message-${index}` ? "Stop" : "Speaker"} 
                                width={15} 
                                height={15} 
                                className="filter brightness-0 saturate-100 hue-rotate-180" 
                              />
                            )}
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
                onClick={toggleRecording}
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
                placeholder={isListening ? `` : ``}
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
    </div>
  );
};

export default RoleplayPage;
