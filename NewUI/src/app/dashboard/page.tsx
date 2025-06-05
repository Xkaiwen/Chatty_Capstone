"use client"
import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from "../../../server/firebase";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { format, isValid, parseISO } from 'date-fns';
import { useMemo as reactUseMemo } from 'react';
import { updateProfile } from "firebase/auth";

interface UserProfile {
  username?: string;
  language?: string;
  created_at?: string;
  locale?: string;
  chat_history?: any[];
  lessons?: string[];
  lesson?: string[];
  critique?: string;
}

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [userLanguage, setUserLanguage] = useState<string>('en');
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'profile' | 'history' | 'scenarios'>('profile');
  const [userProfile, setUserProfile] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [updateError, setUpdateError] = useState(false);
  const [lessonSuggestions, setLessonSuggestions] = useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false); 
  const router = useRouter();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showImageOptions, setShowImageOptions] = useState(false);
  const imageOptionsRef = useRef<HTMLDivElement>(null);
  
  const languageIcons: Record<string, string> = {
    'English': '🇺🇸',
    'Chinese': '🇨🇳',
    'Chinese Traditional': '🇹🇼',
    'Japanese': '🇯🇵',
    'Korean': '🇰🇷',
    'Spanish': '🇪🇸',
    'French': '🇫🇷',
    'German': '🇩🇪',
    'Italian': '🇮🇹',
    'Hindi': '🇮🇳',
  };
  
  const localeMap: Record<string, string> = {
    'English': 'en',
    'Chinese': 'zh-CN',
    'Chinese Traditional': 'zh-TW',
    'Japanese': 'ja',
    'Korean': 'ko',
    'Spanish': 'es',
    'French': 'fr',
    'German': 'de',
    'Italian': 'it',
    'Hindi': 'hi',
  };
  
  const getLanguageFromLocale = (locale: string): string => {
    const entry = Object.entries(localeMap).find(([_, value]) => value === locale);
    return entry ? entry[0] : 'English';
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser) {
        router.push("/login");
      } else {
        setUser(currentUser);
        
        const persistedLocale = localStorage.getItem('persistentLocale');
        if (persistedLocale) {
          console.log(`Found persisted locale: ${persistedLocale}, restoring it`);
          setUserLanguage(persistedLocale);
          localStorage.setItem('locale', persistedLocale);
          
          const language = getLanguageFromLocale(persistedLocale);
          console.log(`Setting language to ${language} based on persisted locale`);
          localStorage.setItem('language', language);
        } else {
          const savedLocale = localStorage.getItem('locale') || 'en';
          setUserLanguage(savedLocale);
        }
        
        fetchUserProfile(currentUser);
      }
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsLanguageDropdownOpen(false);
      }
    }
    
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (imageOptionsRef.current && !imageOptionsRef.current.contains(event.target as Node)) {
        setShowImageOptions(false);
      }
    }
    
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filterNonDiscardedConversations = (chatHistory: any[]): any[] => {
    if (!chatHistory || !Array.isArray(chatHistory)) return [];
    
    console.log("Starting filtering with", chatHistory.length, "total messages");
    
    // Simple filter - only remove messages explicitly marked as discarded
    const filteredMessages = chatHistory.filter(message => {
      // Skip null/undefined messages
      if (!message) return false;
      
      // Keep message if is_discarded is not true
      return message.is_discarded !== true;
    });
    
    console.log(`Filtered to ${filteredMessages.length} non-discarded messages`);
    return filteredMessages;
  };

  const fetchUserProfile = async (currentUser: User) => {
    setIsLoading(true);
    try {
      const username = currentUser.displayName || currentUser.email?.split('@')[0] || 'Guest';
      
      console.log(`Fetching user profile for ${username}`);
      
      const response = await fetch(`http://localhost:8000/api/user_profile?username=${encodeURIComponent(username)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      if (!response.ok) {
        throw new Error(`Error: ${response.status}`);
      }
      
      const data = await response.json();
      if (data && data.chat_history && Array.isArray(data.chat_history)) {
        console.log(`Raw chat history contains ${data.chat_history.length} total messages`);
        
        interface ChatMessage {
          is_discarded?: boolean;
          [key: string]: any;
        }
        
        const discardedCount: number = data.chat_history.filter((msg: ChatMessage) => msg && msg.is_discarded === true).length;
        console.log(`Found ${discardedCount} explicitly discarded messages`);
      }
      
      setUserProfile(data);
      
      const persistentLocale = localStorage.getItem('persistentLocale');
      
      if (persistentLocale) {
        console.log(`Using persistent locale: ${persistentLocale}`);
        setUserLanguage(persistentLocale);
        
        const persistentLanguage = getLanguageFromLocale(persistentLocale);
        
        if (data.language !== persistentLanguage || data.locale !== persistentLocale) {
          console.log(`Updating backend with persisted language: ${persistentLanguage}`);
          
          try {
            await fetch(`http://localhost:8000/api/set_user_profile`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                username: username,
                language: persistentLanguage,
                locale: persistentLocale
              })
            });
          } catch (error) {
            console.error("Failed to update backend with persisted language:", error);
          }
        }
      } 
      else if (data.locale) {
        console.log(`Using profile locale from backend: ${data.locale}`);
        setUserLanguage(data.locale);
        localStorage.setItem('persistentLocale', data.locale);
        localStorage.setItem('locale', data.locale);
        
        const language = getLanguageFromLocale(data.locale);
        localStorage.setItem('language', language);
      } 
      else {
        console.log("No language preference found, using default (en)");
        setUserLanguage('en');
        localStorage.setItem('persistentLocale', 'en');
        localStorage.setItem('locale', 'en');
        localStorage.setItem('language', 'English');
      }
      
      if (activeTab === 'history' && lessonSuggestions.length === 0) {
        await fetchLessonSuggestions(username);
      }
    } catch (error) {
      console.error('Error fetching user profile:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    router.push("/");
  };

  const handlePractice = () => {
    const currentLanguage = getLanguageFromLocale(userLanguage); 
    console.log(`Navigating to choose page with language: ${currentLanguage}, locale: ${userLanguage}`);
    
    localStorage.setItem('locale', userLanguage);
    localStorage.setItem('language', currentLanguage);
    
    router.push("/choose");
  };

  const handleLanguageChange = async (languageName: string) => {
    const locale = localeMap[languageName] || 'en';
    
    console.log(`Changing language to: ${languageName} (locale: ${locale})`);
    
    setIsUpdating(true);
    setUserLanguage(locale);
    
    localStorage.setItem('persistentLocale', locale);
    localStorage.setItem('locale', locale);
    localStorage.setItem('language', languageName);
    
    setUserProfile((prev: UserProfile | null) => ({
      ...prev,
      language: languageName,
      locale: locale
    }));
    
    try {
      if (user) {
        const username = user.displayName || user.email?.split('@')[0] || 'Guest';
        
        const response = await fetch(`http://localhost:8000/api/set_user_profile`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username: username,
            language: languageName,
            locale: locale
          })
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        setLessonSuggestions([]);
        
        if (activeTab === 'history') {
          await fetchLessonSuggestions(username);
        }
        
        setUpdateSuccess(true);
        setTimeout(() => setUpdateSuccess(false), 3000);
      }
    } catch (error) {
      console.error("Error updating language preference:", error);
      setUpdateError(true);
      setTimeout(() => setUpdateError(false), 3000);
    } finally {
      setIsLanguageDropdownOpen(false);
      setIsUpdating(false);
    }
  };

  const formatDate = (dateString: string | undefined): string => {
    if (!dateString) return 'Unknown date';
    
    try {
      const date = typeof dateString === 'string' ? parseISO(dateString) : new Date(dateString);
      
      if (!isValid(date)) {
        return 'Invalid date';
      }
      
      return format(date, 'MMM d, yyyy • h:mm a');
    } catch (error) {
      console.error("Error formatting date:", error);
      return 'Invalid date format';
    }
  };

  const formatTime = (dateString: string | undefined): string => {
    if (!dateString) return 'Unknown time';
    
    try {
      const date = typeof dateString === 'string' ? parseISO(dateString) : new Date(dateString);
      
      if (!isValid(date)) {
        return 'Invalid time';
      }
      
      return format(date, 'h:mm a');
    } catch (error) {
      console.error("Error formatting time:", error);
      return 'Unknown time';
    }
  };

  const groupConversationsByDate = (conversations: any[]): Record<string, any[]> => {
    if (!conversations || !Array.isArray(conversations)) {
      return {};
    }
    
    const grouped: Record<string, any[]> = {};
    
    conversations.forEach(conversation => {
      if (!conversation || !conversation.timestamp) {
        return;
      }
      
      try {
        const date = typeof conversation.timestamp === 'string' 
          ? parseISO(conversation.timestamp) 
          : new Date(conversation.timestamp);
        
        if (!isValid(date)) {
          const dateKey = 'Unknown Date';
          if (!grouped[dateKey]) {
            grouped[dateKey] = [];
          }
          grouped[dateKey].push(conversation);
          return;
        }
        
        const dateKey = format(date, 'MMMM d, yyyy');
        
        if (!grouped[dateKey]) {
          grouped[dateKey] = [];
        }
        
        grouped[dateKey].push(conversation);
      } catch (error) {
        console.error("Error grouping conversation by date:", error);
        const dateKey = 'Unknown Date';
        if (!grouped[dateKey]) {
          grouped[dateKey] = [];
        }
        grouped[dateKey].push(conversation);
      }
    });
    
    return Object.fromEntries(
      Object.entries(grouped).sort(([dateA], [dateB]) => {
        try {
          if (dateA === 'Unknown Date') return 1;
          if (dateB === 'Unknown Date') return -1;
          
          return parseISO(dateB).getTime() - parseISO(dateA).getTime();
        } catch {
          return 0;
        }
      })
    );
  };

  const fetchLessonSuggestions = async (username: string) => {
    if (isLoadingSuggestions || lessonSuggestions.length > 0) {
      return;
    }
    
    setIsLoadingSuggestions(true);
    
    try {
      const language = getLanguageFromLocale(userLanguage);
      
      console.log(`Fetching lesson suggestions for ${username} in language: ${language}`);
      
      const response = await fetch('http://localhost:8000/api/get_lessons', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          username: username,
          language: language 
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }
      
      const data = await response.json();
      console.log("Lesson suggestions received:", data);
      
      if (data && data.lessons && Array.isArray(data.lessons)) {
        setLessonSuggestions(data.lessons);        
        if (data.critique && userProfile) {
          setUserProfile((prev: UserProfile | null) => ({
            ...prev,
            critique: data.critique
          }));
        }
      }
    } catch (error) {
      console.error("Error fetching lesson suggestions:", error);
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'history' && user && lessonSuggestions.length === 0) {
      const username = user.displayName || user.email?.split('@')[0] || 'Guest';
      fetchLessonSuggestions(username);
    }
  }, [activeTab, user, lessonSuggestions.length, userLanguage]);

  const getLocaleFromLanguage = (language: string): string => {
    if (localeMap[language]) {
      return localeMap[language];
    }
    
    const lowerCaseLanguage = language.toLowerCase();
    const entry = Object.entries(localeMap).find(([key]) => 
      key.toLowerCase() === lowerCaseLanguage
    );
    
    return entry ? entry[1] : 'en';
  };

  interface ConversationListProps {
    conversations: any[];
    formatDate: (dateString: string | undefined) => string;
    formatTime: (dateString: string | undefined) => string;
    user: User | null;
    setUserProfile: React.Dispatch<React.SetStateAction<UserProfile | null>>;
    fetchUserProfile: (user: User) => Promise<void>;
  }

  const ConversationList = ({ conversations, formatDate, formatTime, user, setUserProfile, fetchUserProfile }: ConversationListProps) => {
    const [expandedConversations, setExpandedConversations] = useState<Record<string, boolean>>({});
    
    // First, organize conversations by batch_id
    const conversationsByBatchId = useMemo(() => {
      // Create a map to store conversations grouped by batch_id
      const batchMap = new Map<string, Array<any>>();
      
      // Log the total number of conversations received
      console.log(`Processing ${conversations?.length || 0} total conversations`);
      
      // Filter out any null/undefined messages and those explicitly marked as discarded
      const validMessages = (conversations || []).filter(msg => 
        msg && typeof msg === 'object' && msg.is_discarded !== true
      );
      
      console.log(`Found ${validMessages.length} non-discarded messages`);
      
      // Group by batch_id
      validMessages.forEach(message => {
        const batchId = message.batch_id || message.conversation_id || `single-${message.timestamp || new Date().toISOString()}`;
        
        if (!batchMap.has(batchId)) {
          batchMap.set(batchId, []);
        }
        
        batchMap.get(batchId)?.push(message);
      });
      
      // Sort messages within each batch
      batchMap.forEach((messages, batchId) => {
        messages.sort((a, b) => {
          const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
          const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
          return timeA - timeB;
        });
      });
      
      console.log(`Organized into ${batchMap.size} conversation batches`);
      return batchMap;
    }, [conversations]);
    
    // Then, organize these batches by timestamp (newest first)
    const sortedConversations = useMemo(() => {
      const allConversations: Array<{
        id: string, 
        title: string, 
        messages: Array<any>, 
        timestamp: string
      }> = [];
      
      // Process each batch
      conversationsByBatchId.forEach((messages, batchId) => {
        if (messages.length === 0) return;
        
        const firstMsg = messages[0];
        
        // Get a title from the user message
        const userMessage = messages.find(msg => msg.user && msg.user !== 'AI INITIATED');
        const title = userMessage 
          ? (userMessage.user.length > 30 ? userMessage.user.substring(0, 30) + '...' : userMessage.user)
          : `Conversation ${batchId.substring(0, 6)}`;
        
        allConversations.push({
          id: batchId,
          title,
          messages,
          timestamp: firstMsg.timestamp || new Date().toISOString()
        });
      });
      
      // Sort all conversations by timestamp (newest first)
      allConversations.sort((a, b) => {
        const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return timeB - timeA;
      });
      
      return allConversations;
    }, [conversationsByBatchId]);
    
    // Handle UI interactions
    const toggleConversation = (id: string) => {
      setExpandedConversations(prev => ({
        ...prev,
        [id]: !prev[id]
      }));
    };

    const deleteConversation = async (batchId: string) => {
      if (!user) return;
      
      try {
        const username = user.displayName || user.email?.split('@')[0] || 'Guest';
        
        console.log(`Deleting conversation batch: ${batchId} for user: ${username}`);
        
        // Optimistically update the UI first
        setUserProfile((prevProfile: any) => {
          if (!prevProfile || !prevProfile.chat_history) return prevProfile;
          
          const updatedHistory = prevProfile.chat_history.filter((msg: any) => 
            msg.batch_id !== batchId
          );
          
          console.log(`Removed ${prevProfile.chat_history.length - updatedHistory.length} messages from UI`);
          
          return {
            ...prevProfile,
            chat_history: updatedHistory
          };
        });
        
        // Then send the request to the server
        const response = await fetch('http://localhost:8000/api/discard_by_batchid', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username: username,
            batch_id: batchId
          })
        });
        
        if (!response.ok) {
          // If deletion fails on the server, refetch the data to restore state
          const errorText = await response.text();
          console.error(`Delete failed: ${response.status}`, errorText);
          
          if (user) {
            fetchUserProfile(user);
          }
          
          throw new Error(`Failed to delete conversation: ${response.status}`);
        }
        
        console.log(`Successfully deleted conversation batch ${batchId} from database`);
        
      } catch (error) {
        console.error("Error deleting conversation:", error);
        alert("Failed to delete conversation. Please try again.");
      }
    };
    
    // Debug output
    useEffect(() => {
      console.log(`ConversationList rendering with ${sortedConversations.length} total conversations`);
    }, [sortedConversations]);
    
    // If no conversations, show empty state
    if (sortedConversations.length === 0) {
      return (
        <div className="text-center py-8 text-gray-500">
          No conversation history found. Start practicing to see your conversations here.
        </div>
      );
    }
    
    // Render conversation list
    return (
      <div className="divide-y divide-gray-200">
        {sortedConversations.map((conversation) => {
          const isExpanded = expandedConversations[conversation.id];
          const firstMessage = conversation.messages[0];
          
          return (
            <div key={conversation.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
              <div className="flex justify-between items-center p-3">
                <div 
                  className="flex items-center space-x-3 flex-grow cursor-pointer"
                  onClick={() => toggleConversation(conversation.id)}
                >
                  <div className="w-8 h-8 bg-[#48d1cc] rounded-full flex items-center justify-center text-white">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {conversation.title}
                    </p>
                    <p className="text-xs text-gray-400">
                      {firstMessage.timestamp ? formatDate(firstMessage.timestamp) : 'Unknown date/time'}
                    </p>
                  </div>
                  <svg 
                    className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'transform rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("Are you sure you want to delete this conversation?")) {
                      deleteConversation(conversation.id);
                    }
                  }}
                  className="ml-2 p-1 text-gray-400 hover:text-red-500 rounded"
                  title="Delete conversation"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
              
              {isExpanded && (
                <div className="p-3 border-t border-gray-100 bg-white">
                  {conversation.messages.map((message: any, msgIndex: number) => (
                    <div key={msgIndex} className={msgIndex > 0 ? 'mt-3' : ''}>
                      {message.user && message.user !== 'AI INITIATED' && (
                        <div className="mb-3">
                          <p className="text-xs font-medium text-gray-500 mb-1">You</p>
                          <p className="text-gray-700 bg-blue-50 p-2 rounded-lg">{message.user}</p>
                        </div>
                      )}
                      {message.ai && (
                        <div>
                          <p className="text-xs font-medium text-gray-500 mb-1">AI</p>
                          <p className="text-gray-700 bg-gray-50 p-2 rounded-lg">{message.ai}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const [scenarioConversations, setScenarioConversations] = useState<any[]>([]);
  const [isLoadingScenarios, setIsLoadingScenarios] = useState(false);

  const fetchScenarioConversations = async (username: string) => {
    setIsLoadingScenarios(true);
    try {
      console.log(`Fetching scenario conversations for user: ${username}`);
      
      const response = await fetch(`http://localhost:8000/api/get_scenario_conversations?username=${encodeURIComponent(username)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`HTTP error! status: ${response.status}, body:`, errorText);
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log("Received scenario conversations:", data);
      
      if (data && Array.isArray(data.conversations)) {
        interface ScenarioConversation {
          is_deleted?: boolean;
          deleted?: boolean;
          [key: string]: any; // To allow other properties that exist on the conversation objects
        }
        
        const activeConversations: ScenarioConversation[] = data.conversations.filter((conversation: ScenarioConversation) => 
          conversation && 
          !conversation.is_deleted && 
          !conversation.deleted
        );
        
        console.log(`Filtered ${data.conversations.length - activeConversations.length} deleted conversations`);
        setScenarioConversations(activeConversations);
      } else {
        console.log("No conversations found or invalid format:", data);
        setScenarioConversations([]);
      }
    } catch (error) {
      console.error("Error fetching scenario conversations:", error);
      setScenarioConversations([]);
    } finally {
      setIsLoadingScenarios(false);
    }
  };

  const handleProfileImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    
    setIsUploading(true);
    setUploadError(null);
    setUploadSuccess(false);
    
    try {
      const reader = new FileReader();
      
      const base64Data = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            resolve(reader.result);
          } else {
            reject(new Error('Failed to convert image to Base64'));
          }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      
      const username = user.displayName || user.email?.split('@')[0] || 'Guest';
      
        const response = await fetch('http://localhost:8000/api/update_profile_image', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username: username,
            image: base64Data
          })
        });
        
        if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
          const data = await response.json();
      
          if (data.imageUrl) {
            await updateProfile(user, {
              photoURL: data.imageUrl
            });
        
            setUser({ ...user, photoURL: data.imageUrl });
          }
      
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 3000);
      
    } catch (error) {
      console.error("Error uploading profile image:", error);
      setUploadError("Failed to upload image. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const deleteScenarioConversation = async (conversationId: string | undefined) => {
    if (!conversationId || !user) {
      console.error("Missing conversation ID or user");
      return;
    }
    
    try {
      const username = user.displayName || user.email?.split('@')[0] || 'Guest';
      console.log(`Deleting conversation ${conversationId} for user: ${username}`);
      
      setScenarioConversations(prevConversations => 
        prevConversations.filter(conv => conv._id !== conversationId && conv.id !== conversationId)
      );
      
      const response = await fetch('http://localhost:8000/api/delete_scenario_conversation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: username,
          conversation_id: conversationId
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Delete failed: ${response.status}`, errorText);
        
        fetchScenarioConversations(username);
        throw new Error(`Failed to delete conversation: ${response.status}`);
      }
      
      console.log(`Successfully deleted conversation ${conversationId} from database`);
    } catch (error) {
      console.error("Error deleting conversation:", error);
      alert("Failed to delete conversation. Please try again.");
    }
  };
  useEffect(() => {
    if (activeTab === 'scenarios' && user) {
      const username = user.displayName || user.email?.split('@')[0] || 'Guest';
      fetchScenarioConversations(username);
    }
  }, [activeTab, user]);

  const ScenarioConversationsView = ({ 
    scenarioConversations, 
    formatDate, 
    formatTime,
    isLoading 
  }: { 
    scenarioConversations: any[], 
    formatDate: (date: string | undefined) => string,
    formatTime: (date: string | undefined) => string,
    isLoading: boolean
  }) => {
    const [expandedScenarios, setExpandedScenarios] = useState<Record<string, boolean>>({});
    
    const toggleScenario = (id: string) => {
      setExpandedScenarios(prev => ({
        ...prev,
        [id]: !prev[id]
      }));
    };
    
    if (isLoading) {
      return (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-[#20b2aa]"></div>
        </div>
      );
    }
    
    if (!scenarioConversations || scenarioConversations.length === 0) {
      return (
        <div className="text-center py-10">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <h3 className="text-xl font-semibold text-gray-700 mb-2">No Roleplay History</h3>
        </div>
      );
    }
    
    const groupedByScenario: Record<string, any[]> = {};
    
    scenarioConversations.forEach(conversation => {
      const scenarioName = conversation.scenario_title || conversation.scenario_name || 'Unknown Scenario';
      if (!groupedByScenario[scenarioName]) {
        groupedByScenario[scenarioName] = [];
      }
      groupedByScenario[scenarioName].push(conversation);
    });
    
    // Helper function to handle different message formats
    const extractMessages = (conversation: any) => {
      // If messages is already an array of objects with role and content
      if (conversation.messages && Array.isArray(conversation.messages)) {
        return conversation.messages;
      }
      
      // If messages are in a different format (like {text, sender} format)
      if (conversation.messages && Array.isArray(conversation.messages)) {
        return conversation.messages.map((msg: any) => ({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.text || msg.content || ''
        }));
      }
      
      // If we have individual fields for each message
      const messages = [];
      if (conversation.user) {
        messages.push({ role: 'user', content: conversation.user });
      }
      if (conversation.ai || conversation.assistant) {
        messages.push({ role: 'assistant', content: conversation.ai || conversation.assistant });
      }
      
      // If we have a flat list of text messages alternating user/assistant
      if (conversation.text_messages && Array.isArray(conversation.text_messages)) {
        return conversation.text_messages.map((text: string, i: number) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: text
        }));
      }
      
      return messages;
    };
    
    return (
      <div className="divide-y divide-gray-200">
        {Object.entries(groupedByScenario).map(([scenarioName, conversations]) => (
          <div key={scenarioName} className="py-4">
            <div className="space-y-2 px-4 mt-2">
              {conversations.map((conversation, index) => {
                const id = `${scenarioName}-${index}`;
                const isExpanded = expandedScenarios[id];
                const messages = extractMessages(conversation);
                const timestamp = conversation.timestamp || conversation.created_at || '';
                const conversationId = conversation._id || conversation.id;
                
                return (
                  <div key={id} className="border border-gray-100 rounded-lg hover:bg-gray-50 transition-colors">
                    <div className="flex justify-between items-center p-3">
                      <div 
                        className="flex items-center space-x-3 flex-grow cursor-pointer"
                        onClick={() => toggleScenario(id)}
                      >
                        <div className="w-8 h-8 bg-[#48d1cc] rounded-full flex items-center justify-center text-white">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">
                            {conversation.scenario_title || scenarioName}
                          </p>
                          <p className="text-xs text-gray-400">
                            {timestamp ? formatDate(timestamp) : 'Unknown date/time'}
                          </p>
                        </div>
                        <svg 
                          className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'transform rotate-180' : ''}`} 
                          fill="none" 
                          viewBox="0 0 24 24" 
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    
                      {/* Delete button */}
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm("Are you sure you want to delete this conversation?")) {
                            deleteScenarioConversation(conversationId);
                          }
                        }}
                        className="ml-2 p-1 text-gray-400 hover:text-red-500 rounded"
                        title="Delete conversation"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                    
                    {isExpanded && (
                      <div className="p-3 border-t border-gray-100 bg-white">
                        {/* Display messages */}
                        {messages.length > 0 ? (
                          messages.map((message: any, msgIndex: number) => {
                            const role = message.role || (message.sender === 'user' ? 'user' : 'assistant');
                            const content = message.content || message.text || '';
                            
                            return (
                              <div key={msgIndex} className="mb-3">
                                <p className="text-xs font-medium text-gray-500 mb-1">
                                  {role === 'user' ? 'You' : 'AI'}
                                </p>
                                <p className={`text-gray-700 p-2 rounded-lg ${role === 'user' ? 'bg-blue-50' : 'bg-gray-50'}`}>
                                  {content}
                                </p>
                              </div>
                            );
                          })
                        ) : (
                          <div className="text-center py-3 text-gray-500">
                            No messages available for this conversation
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div 
      className="min-h-screen bg-slate-50"
      style={{ backgroundImage: "url('/icons/background1.jpg')", backgroundSize: "cover" }}
    >
      {user ? (
        <div className="container mx-auto py-8 px-4">
          {/* Header with user info */}
          <div className="bg-white rounded-xl shadow-md p-6 mb-6 flex items-center">
            <div className="w-16 h-16 rounded-full flex-shrink-0 border-2 border-[#48d1cc] relative group">
              {user.photoURL ? (
                <img 
                  src={user.photoURL} 
                  alt="Profile" 
                  className="w-full h-full object-cover rounded-full" 
                />
              ) : (
                <div className="w-full h-full bg-[#48d1cc] flex items-center justify-center text-white text-2xl font-bold rounded-full">
                  {user.displayName ? user.displayName.charAt(0).toUpperCase() : user.email?.charAt(0).toUpperCase()}
                </div>
              )}
              
              {/* Camera icon overlay */}
              <div 
                className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                </div>
              </div>
              
              {/* Hidden file input */}
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    onChange={handleProfileImageUpload}
                    accept="image/*"
                    className="hidden" 
                  />
              
              {/* Upload status indicators */}
              {isUploading && (
                <div className="absolute -bottom-2 -right-2 bg-white p-1 rounded-full shadow-md">
                  <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-[#48d1cc] border-r-2"></div>
                </div>
              )}
              
              {uploadSuccess && (
                <div className="absolute -bottom-2 -right-2 bg-green-500 p-1 rounded-full shadow-md text-white">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </div>
            
            <div className="flex-grow ml-6">
              <h1 className="text-xl font-bold text-gray-800">
                Welcome, {user.displayName || "User"}!
              </h1>
              <p className="text-gray-600">{user.email}</p>
              
              {uploadError && (
                <p className="text-xs text-red-500 mt-1">{uploadError}</p>
              )}
            </div>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-[#48d1cc] hover:bg-[#008080] text-white rounded-lg transition-colors duration-200 flex items-center ml-4"
            >
              <svg className="mr-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Logout
            </button>
          </div>
          {/* Main content tabs */}
          <div className="bg-white rounded-xl shadow-md overflow-hidden">
            <div className="flex border-b border-gray-200">
              <button
                className={`flex-1 py-4 px-6 text-center font-medium transition-colors duration-200 ${
                  activeTab === 'profile' 
                    ? "text-[#48d1cc] border-b-2 border-[#48d1cc]" 
                    : "text-gray-500 hover:text-gray-700"
                }`}
                onClick={() => setActiveTab('profile')}
              >
                Profile
              </button>
              <button
                className={`flex-1 py-4 px-6 text-center font-medium transition-colors duration-200 ${
                  activeTab === 'history' 
                    ? "text-[#48d1cc] border-b-2 border-[#48d1cc]" 
                    : "text-gray-500 hover:text-gray-700"
                }`}
                onClick={() => {
                  setActiveTab('history');
                  // Your existing code for fetching lesson suggestions
                }}
              >
                Lesson
              </button>
              <button
                className={`flex-1 py-4 px-6 text-center font-medium transition-colors duration-200 ${
                  activeTab === 'scenarios' 
                    ? "text-[#48d1cc] border-b-2 border-[#48d1cc]" 
                    : "text-gray-500 hover:text-gray-700"
                }`}
                onClick={() => {
                  setActiveTab('scenarios');
                  fetchScenarioConversations(user?.displayName || user?.email?.split('@')[0] || 'Guest');
                }}
              >
                Roleplay
              </button>
            </div>

            {/* Profile Tab Content */}
            {activeTab === 'profile' && (
              <div className="p-6">
                <div className="space-y-4">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-[#20b2aa]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      User Statistics
                    </h2>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <p className="text-sm text-gray-500">Username</p>
                          <p className="font-medium text-gray-800">{userProfile?.username || user.displayName || "Not set"}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500">Language</p>
                          <p className="font-medium text-gray-800">{getLanguageFromLocale(userLanguage)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500">Created</p>
                          <p className="font-medium text-gray-800">{userProfile ? formatDate(userProfile.created_at) : "Unknown"}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Language Selection Dropdown */}
                  <div className="bg-gray-50 rounded-lg p-4" ref={dropdownRef}>
                    <h2 className="text-sm font-medium text-gray-500 mb-2">Language preference for practice</h2>
                    <div className="relative">
                      <button 
                        className="w-full flex items-center justify-between px-4 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#48d1cc]"
                        onClick={() => setIsLanguageDropdownOpen(!isLanguageDropdownOpen)}
                      >
                        <div className="flex items-center">
                          <span className="text-xl mr-2">
                            {languageIcons[getLanguageFromLocale(userLanguage)]}
                          </span>
                          <span>{getLanguageFromLocale(userLanguage)}</span>
                        </div>
                        <svg className={`w-5 h-5 transition-transform ${isLanguageDropdownOpen ? 'transform rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      
                      {isLanguageDropdownOpen && (
                        <div className="fixed z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg overflow-y-auto" 
                            style={{ 
                              maxHeight: '200px', 
                              width: dropdownRef.current ? dropdownRef.current.clientWidth : 'auto',
                              left: dropdownRef.current ? dropdownRef.current.getBoundingClientRect().left : 0,
                              top: dropdownRef.current ? dropdownRef.current.getBoundingClientRect().bottom + window.scrollY + 5 : 0
                            }}>
                          {Object.entries(languageIcons).map(([language, icon]) => (
                            <div 
                              key={language}
                              className={`flex items-center px-4 py-3 hover:bg-gray-100 cursor-pointer ${
                                getLanguageFromLocale(userLanguage) === language ? 'bg-[#48d1cc] bg-opacity-20' : ''
                              }`}
                              onClick={() => handleLanguageChange(language)}
                            >
                              <span className="text-xl mr-2">{icon}</span>
                              <span className="font-medium">{language}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {isUpdating && (
                    <div className="flex items-center mt-2 text-gray-500">
                      <svg className="animate-spin h-4 w-4 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Updating preferences...
                    </div>
                  )}

                  {updateSuccess && (
                    <div className="flex items-center mt-2 text-green-600">
                      <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                      </svg>
                      Language preference updated successfully!
                    </div>
                  )}

                  {updateError && (
                    <div className="flex items-center mt-2 text-red-600">
                      <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                      </svg>
                      Failed to update language preference. Changes saved locally.
                    </div>
                  )}
                </div>
                
                <button
                  onClick={handlePractice}
                  className="w-full mt-6 bg-[#48d1cc] hover:bg-[#008080] text-white py-3 rounded-lg transition-colors duration-200 flex items-center justify-center font-medium"
                >
                  Start Practicing
                </button>
              </div>
            )}
            
            {/* History Tab Content */}
            {activeTab === 'history' && (
              <div className="p-6">              
                {isLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#20b2aa]"></div>
                  </div>
                ) : !userProfile ? (
                  <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <h3 className="text-xl font-semibold text-gray-700 mb-2">No User Data Found</h3>
                    <p className="text-gray-500 mb-4">We couldn't find any user data. Try practicing some conversations first.</p>
                    
                    <button 
                      onClick={handlePractice}
                      className="bg-[#20b2aa] hover:bg-[#008080] px-6 py-2 rounded-lg text-white font-medium transition-colors inline-flex items-center"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      Start Practicing
                    </button>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Chat History Section */}
                    {userProfile?.chat_history && userProfile.chat_history.length > 0 && (
                      <div>
                        <h2 className="text-lg font-semibold text-white-800 mb-3 flex items-center">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-[#20b2aa]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                          </svg>
                          Recent Conversations
                        </h2>
                        <div className="bg-white rounded-lg border border-gray-200 max-h-[500px] overflow-y-auto">
                          <ConversationList 
                            conversations={userProfile.chat_history} 
                            formatDate={formatDate} 
                            formatTime={formatTime}
                            user={user}
                            setUserProfile={setUserProfile}
                            fetchUserProfile={fetchUserProfile}
                          />
                        </div>
                      </div>
                    )}

                    {/* Lesson Section */}
                    {userProfile.lessons && Array.isArray(userProfile.lessons) && userProfile.lessons.length > 0 ? (
                      <div>
                        <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-[#20b2aa]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                          </svg>
                          Completed Lessons
                        </h2>
                        <div className="bg-white rounded-lg border border-gray-200 p-4">
                          <ul className="list-disc pl-5 space-y-1">
                            {userProfile.lessons.map((lesson: string, index: number) => (
                              <li key={index} className="text-gray-700">{lesson}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ) : userProfile.lesson && Array.isArray(userProfile.lesson) && userProfile.lesson.length > 0 ? (
                      <div>
                        <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-[#20b2aa]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                          </svg>
                          Completed Lessons
                        </h2>
                        <div className="bg-white rounded-lg border border-gray-200 p-4">
                          <ul className="list-disc pl-5 space-y-1">
                            {userProfile.lesson.map((lesson: string, index: number) => (
                              <li key={index} className="text-gray-700">{lesson}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ) : null}

                    {/* Suggested Lessons Section */}
                    <div>
                      <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-[#20b2aa]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                        Critique
                      </h2>
                      
                      <div className="space-y-4">
                        {isLoadingSuggestions ? (
                          <div className="flex flex-col items-center justify-center py-10 bg-white border border-gray-200 rounded-lg">
                            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-[#20b2aa] mb-3"></div>
                            <p className="text-gray-500 text-sm">Loading...</p>
                          </div>
                        ) : lessonSuggestions.length > 0 ? (
                          <div className="space-y-4">
                            {lessonSuggestions.map((lesson, index) => {
                              return (
                                <div key={index} className="p-4 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                                  <div className="flex items-start">
                                    <div className="flex-shrink-0 w-8 h-8 bg-[#20b2aa] rounded-full flex items-center justify-center text-white text-lg mr-4">
                                      {index + 1}
                                    </div>
                                    <div>
                                      <p className="text-gray-700">{lesson}</p>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-center py-6 bg-white border border-gray-200 rounded-lg">
                            <p className="text-gray-500">Complete more conversations to receive personalized lesson suggestions.</p>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <button
                      onClick={handlePractice}
                      className="w-full mt-6 bg-[#48d1cc] hover:bg-[#008080] text-white py-3 rounded-lg transition-colors duration-200 flex items-center justify-center font-medium"
                    >
                      Practice More
                    </button>
                  </div>
                )}
              </div>
            )}
            {/* Scenario Conversations Tab Content */}
            {activeTab === 'scenarios' && (
              <div className="p-6">              
                {isLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#20b2aa]"></div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-[#20b2aa]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                      </svg>
                      Roleplay Conversations
                    </h2>
                    <div className="bg-white rounded-lg border border-gray-200">
                      <ScenarioConversationsView 
                        scenarioConversations={scenarioConversations} 
                        formatDate={formatDate}
                        formatTime={formatTime}
                        isLoading={isLoadingScenarios}
                      />
                    </div>
                    
                    <button
                      onClick={() => router.push('/scenario')}
                      className="w-full mt-6 bg-[#48d1cc] hover:bg-[#008080] text-white py-3 rounded-lg transition-colors duration-200 flex items-center justify-center font-medium"
                    >
                      Try New Roleplay Scenarios
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex justify-center items-center min-h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#48d1cc]"></div>
        </div>
      )}
    </div>
  );
  
}
function useMemo<T>(factory: () => T, deps: React.DependencyList): T {
  return reactUseMemo(factory, deps);
}
