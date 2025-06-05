"use client"
import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useRouter, useParams } from 'next/navigation';
import { auth } from "../../../../../server/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { getUserProfile, sendChatMessage } from '@/services/api';

interface Message {
  text: string;
  sender: 'user' | 'bot';
  audio_url?: string;
}

const CustomScenarioDetailPage = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [userLanguage, setUserLanguage] = useState<string>('en');
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [scenarioTitle, setScenarioTitle] = useState('');
  const [scenarioDescription, setScenarioDescription] = useState('');
  const [isPlaying, setIsPlaying] = useState<string | null>(null);
  
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const router = useRouter();
  const params = useParams();
  const scenarioId = params.id as string;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      const savedLocale = localStorage.getItem('locale') || 'en';
      setUserLanguage(savedLocale);
      
      if (currentUser) {
        await loadScenarioDetails(currentUser);
      } else {
        router.push('/');
      }
      
      setLoading(false);
    });
    
    return () => unsubscribe();
  }, [scenarioId]);
  
  useEffect(() => {
    scrollToBottom();
  }, [messages]);
  
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const loadScenarioDetails = async (currentUser: User) => {
    try {
      const username = currentUser.displayName || currentUser.email?.split('@')[0] || 'Guest';
      
      const response = await getUserProfile(username);
      
      if (response && response.data && !response.error) {
        const customScenarios = response.data.custom_scenarios || [];
        
        // Find the selected scenario by index
        const scenarioIndex = parseInt(scenarioId);
        const selectedScenario = customScenarios[scenarioIndex];
        
        if (!selectedScenario) {
          throw new Error("Scenario not found");
        }
        
        // Set the scenario details
        setScenarioTitle(selectedScenario.title || `Custom Scenario ${scenarioIndex + 1}`);
        setScenarioDescription(selectedScenario.description || "");
        
        setMessages([
          { 
            text: `Welcome to your "${selectedScenario.title}" scenario! I'll be your conversation partner. How would you like to start?`, 
            sender: 'bot' 
          }
        ]);
      } else {
        throw new Error("Error loading user profile");
      }
    } catch (error) {
      console.error("Error loading scenario:", error);
      alert("There was a problem loading this scenario. Returning to scenario selection.");
      router.push('/scenario');
    }
  };
  // const loadScenarioDetails = async (currentUser: User) => {
  //   try {
  //     const username = currentUser.displayName || currentUser.email?.split('@')[0] || 'Guest';
  
  //     // Fetch user profile from backend
  //     const response = await getUserProfile(username);
      
  //     if (response && response.data && !response.error) {
  //       const customScenarios = response.data.custom_scenarios || [];
        
  //       // Find the selected scenario by index
  //       const scenarioIndex = parseInt(scenarioId);
  //       const selectedScenario = customScenarios[scenarioIndex];
  
  //       if (!selectedScenario) {
  //         throw new Error("Scenario not found");
  //       }
  
  //       setScenarioTitle(selectedScenario.title || `Custom Scenario ${scenarioIndex + 1}`);
  //       setScenarioDescription(selectedScenario.description || "");
  
  //       // Fetch AI-generated response from backend
  //       const aiResponse = await fetch("http://localhost:8000/api/get_scenario_response", {
  //         method: "POST",
  //         headers: { "Content-Type": "application/json" },
  //         body: JSON.stringify({ username }),
  //       });
  
  //       const data = await aiResponse.json();
  
  //       setMessages([{ text: data.response, sender: "bot" }]);
  //     } else {
  //       throw new Error("Error loading user profile");
  //     }
  //   } catch (error) {
  //     console.error("Error loading scenario:", error);
  //     alert("There was a problem loading this scenario. Returning to scenario selection.");
  //     router.push('/scenario');
  //   }
  // };
  
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
    router.push('/scenario');
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

  // Play audio when speaker button is clicked
  const playMessageAudio = (messageId: number, audioUrl?: string) => {
    if (!audioUrl) return;
    
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(null);
    }
    if (isPlaying === `message-${messageId}`) {
      setIsPlaying(null);
      return;
    }
    
    const audio = new Audio(`http://localhost:8000${audioUrl}`);
    audioRef.current = audio;
    
    // Playing message ID
    setIsPlaying(`message-${messageId}`);
    
    audio.addEventListener('ended', () => {
      setIsPlaying(null);
    });
    
    audio.play().catch(e => {
      console.error("Audio playback error:", e);
      setIsPlaying(null);
    });
  };

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;
    
    const userMessage = inputText.trim();
    setMessages(prev => [...prev, { text: userMessage, sender: 'user' }]);
    setInputText('');
    setIsLoading(true);

    try {
      if (!user) {
        throw new Error("User not authenticated");
      }
      
      const username = user.displayName || user.email?.split('@')[0] || 'Guest';
      
      const response = await sendChatMessage(
        username,
        userMessage,
        scenarioTitle,
        undefined,
        userLanguage
      );

      if (response && response.error) {
        throw new Error(response.error);
      }

      if (response && response.data) {
        setMessages(prev => [...prev, { 
          text: response.data.response, 
          sender: 'bot',
          audio_url: response.data.audio_url
        }]);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => [
        ...prev,
        { text: "Sorry, I'm having trouble connecting. Please try again.", sender: 'bot' }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEndScenario = () => {
    router.push('/scenario');
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
    <div className="min-h-screen relative bg-cover bg-center"
      style={{ backgroundImage: "url('/icons/background1.jpg')" }}
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
              <p className="text-xs text-gray-500">Language: {userLanguage === 'en' ? 'English' : userLanguage === 'zh-CN' ? 'Chinese' : 'Japanese'}</p>
            </div>
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
        />
      </button>
      
      <button 
        onClick={handleEndScenario}
        className="absolute top-8 right-8 bg-[#20b2aa] hover:bg-[#008080] px-6 py-2 rounded-lg transition-colors duration-200"
      >
        End Scenario
      </button>
      
      <div className="container mx-auto pt-24 px-4">
        <div className="bg-white bg-opacity-95 rounded-xl shadow-lg p-6 mb-6">
          <h1 className="text-2xl font-bold text-gray-800">{scenarioTitle}</h1>
          {scenarioDescription && (
            <p className="text-gray-600 mt-2">{scenarioDescription}</p>
          )}
        </div>
        
        <div className="bg-white bg-opacity-95 rounded-xl shadow-lg p-6 mb-6 h-[60vh] overflow-y-auto">
          <div className="flex flex-col space-y-4">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {message.sender === 'bot' && (
                  <div className="w-8 h-8 mr-2 flex-shrink-0 rounded-full overflow-hidden">
                    <Image
                      src="/icons/robot.jpg"
                      alt="Robot"
                      width={32}
                      height={32}
                      className="object-cover"
                    />
                  </div>
                )}
                <div
                  className={`max-w-sm rounded-lg px-4 py-2 ${
                    message.sender === 'user' 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-gray-200 text-gray-800'
                  } group relative`}
                >
                  {message.text}
                  
                  {/* Speaker button for bot messages */}
                  {message.sender === 'bot' && message.audio_url && (
                    <button
                      onClick={() => playMessageAudio(index, message.audio_url)}
                      className="absolute -right-10 top-1/2 transform -translate-y-1/2 w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors"
                      aria-label="Play message audio"
                    >
                      {isPlaying === `message-${index}` ? (
                        <div className="animate-pulse">
                          <Image src="/icons/speaker.jpg" alt="Speaker" width={24} height={24} />
                        </div>
                      ) : (
                        <Image src="/icons/speaker.jpg" alt="Speaker" width={24} height={24} />
                      )}
                    </button>
                  )}
                </div>
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
        
        <div className="flex gap-2">
          <input
            type="text"
            value={inputText}
            onChange={handleInputChange}
            onKeyPress={handleKeyPress}
            placeholder="Type your message..."
            className="flex-1 bg-white text-black px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
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
    </div>
  );
};

export default CustomScenarioDetailPage;