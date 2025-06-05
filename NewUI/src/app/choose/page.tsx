"use client"
import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import TypewriterEffect from '../../components/TypewriterEffect';
import { auth } from "../../../server/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { getUserProfile } from '@/services/api';

const ChoosePage = () => {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const [userLanguage, setUserLanguage] = useState<string>('en');
  
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        profileMenuRef.current && 
        !profileMenuRef.current.contains(event.target as Node) &&
        profileButtonRef.current &&
        !profileButtonRef.current.contains(event.target as Node)
      ) {
        setShowProfileMenu(false);
      }
    };
    
    if (showProfileMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showProfileMenu]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      const isGuest = localStorage.getItem('isGuest') === 'true';
      
      if (!currentUser && !isGuest) {
        router.push("/");
        return;
      }
      
      setUser(currentUser);
      
      let username;
      if (currentUser) {
        username = currentUser.displayName || currentUser.email?.split('@')[0] || 'Guest';
      } else {
        username = localStorage.getItem('userName') || 'Guest';
      }
      
      const storedLanguage = localStorage.getItem('language');
      const storedLocale = localStorage.getItem('locale');
      
      if (storedLanguage && storedLocale) {
        console.log(`Using stored language: ${storedLanguage}, locale: ${storedLocale}`);
        setUserLanguage(storedLocale);
      }
      
      if (currentUser) {
        try {
          const response = await fetch(`http://localhost:8000/api/user_profile?username=${encodeURIComponent(username)}`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            }
          });
          
          if (response.ok) {
            const data = await response.json();
            
          if (data.language && (!storedLanguage || !storedLocale)) {
            localStorage.setItem('language', data.language);
            const reverseLocaleMap: Record<string, string> = {
              'English': 'en',
              'Chinese': 'zh-CN',
              'Chinese (Simplified)': 'zh-CN',
              'Chinese Traditional': 'zh-TW',
              'Chinese (Traditional)': 'zh-TW',
              'Japanese': 'ja',
              'Korean': 'ko',
              'Spanish': 'es',
              'French': 'fr',
              'Italian': 'it',
              'German': 'de',
              'Hindi': 'hi'
            };
            const localeCode = reverseLocaleMap[data.language] || 'en';
            localStorage.setItem('locale', localeCode);
            setUserLanguage(localeCode);
          }
          }
        } catch (error) {
          console.error("Error loading user profile:", error);
        }
      }
      
      setLoading(false);
    });
  
    return () => unsubscribe();
  }, [router]);

  const handlePractice = () => {
    const currentLocale = localStorage.getItem('locale') || 'en';
    const currentLanguage = localStorage.getItem('language') || 'English';
    
    console.log(`Navigating to choose page with language: ${currentLanguage}, locale: ${currentLocale}`);
    localStorage.setItem('locale', currentLocale);
    localStorage.setItem('language', currentLanguage);
    
    router.push("/choose");
  };

  const handleBackClick = () => {
    router.push('/');
  };
  
  const handleHelpClick = () => {
    router.push('/help');
  };

  const handleProfileMenuClick = () => {
    if (!showProfileMenu) {
      const currentLocale = localStorage.getItem('locale') || 'en';
      setUserLanguage(currentLocale);
    }
    setShowProfileMenu(!showProfileMenu);
  };
  
  const handleTypingClick2 = () => {
    saveUserState();
    router.push('/scenario');
  };
  
  const handleTypingClick = () => {
    saveUserState();
    router.push('/conversation');
  };

  const handleTypingClick3 = () => {
    saveUserState();
    router.push('/voice');
  };

  const navigateToDashboard = () => {
    router.push('/dashboard');
    setShowProfileMenu(false);
  };
  
  const saveUserState = () => {
    if (user) {
      const username = user.displayName || user.email?.split('@')[0] || 'Guest';
      localStorage.setItem('userName', username);
      localStorage.setItem('locale', userLanguage);
    }
  };

  const localeMap: Record<string, string> = {
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

  const getDisplayLanguage = (locale: string): string => {
    return localeMap[locale] || 'English';
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
    <div 
      className="min-h-screen relative bg-cover bg-center p-8" 
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
        ref={profileButtonRef}
        onClick={handleProfileMenuClick}
        className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 transition-colors duration-200 flex items-center justify-center overflow-hidden"
        aria-label="Profile Menu"
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
          <div 
            ref={profileMenuRef}
            className="absolute top-12 left-0 bg-white rounded-lg shadow-lg py-2 min-w-[180px] text-gray-800 z-20">
            <div className="px-4 py-2 border-b border-gray-200">
              <p className="font-medium">{user?.displayName || "Guest"}</p>
              {user?.email && (
                <p className="text-xs text-gray-500">{user.email}</p>
              )}
            </div>
            <div className="px-4 py-2 border-b border-gray-200">
              <p className="text-xs text-gray-500">Language: {getDisplayLanguage(userLanguage)}</p>
            </div>
            <button 
              onClick={handleHelpClick}
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
      
      <div className="mt-24 max-w-2xl mx-auto mb-8 bg-white rounded-xl shadow-lg overflow-hidden">
        <div className="p-8">
          <div className="flex items-center space-x-6">
            <div className="w-24 h-24 relative flex-shrink-0">
              <Image
                src="/icons/chatbot.png"
                alt="Chatbot Icon"
                fill
                className="rounded-full"
                priority
              />
            </div>
            <div className="flex flex-col">
              <h1 className="text-lg font-bold text-gray-800">
              <TypewriterEffect 
                text={user?.displayName 
                  ? `Welcome, ${user.displayName}! How do you want to practice ${getDisplayLanguage(userLanguage)}?` 
                  : `Welcome! How do you want to practice ${getDisplayLanguage(userLanguage)}?`}
                delay={30}
                startTyping={true}
              />
              </h1>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto flex flex-col gap-6 mt-16">
        <button 
          onClick={handleTypingClick}
          className="w-full bg-pink-200 hover:bg-pink-300 transition-colors duration-200 rounded-lg p-6 shadow-md flex items-center justify-center"
        >
          <span className="text-lg font-semibold text-gray-800">Conversation</span>
        </button>
        
        <button 
          onClick={handleTypingClick2}
          className="w-full bg-indigo-200 hover:bg-indigo-300 transition-colors duration-200 rounded-lg p-6 shadow-md flex items-center justify-center"
        >
          <span className="text-lg font-semibold text-gray-800">Roleplay</span>
        </button>

        <button 
          onClick={handleTypingClick3}
          className="w-full bg-green-200 hover:bg-green-300 transition-colors duration-200 rounded-lg p-6 shadow-md flex items-center justify-center"
        >
          <span className="text-lg font-semibold text-gray-800">Talk</span>
        </button>
      </div>
    </div>
  );
}

export default ChoosePage;