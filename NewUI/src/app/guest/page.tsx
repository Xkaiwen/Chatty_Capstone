"use client"
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import TypewriterEffect from '../../components/TypewriterEffect';
import { auth } from '../../../server/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { getUserProfile, setScenario } from '@/services/api';

const GuestPage = () => {
  const [firstLineComplete, setFirstLineComplete] = useState(false);
  const [userName, setUserName] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const router = useRouter();
  
  // Default to English
  const selectedLanguage = 'English';
  const localeMap: Record<string, string> = {
    'English': 'en',
    'Chinese': 'zh-CN',
    'Japanese': 'ja',
    'Korean': 'ko',
    'Spanish': 'es',
    'French': 'fr',
    'Hindi': 'hi'
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setIsLoggedIn(true);
        const displayName = user.displayName || user.email?.split('@')[0] || '';
        setUserName(displayName);
        localStorage.setItem('userName', displayName);
      } else {
        setIsLoggedIn(false);
        localStorage.removeItem('userName');
        localStorage.removeItem('userId');
      }
      setLoading(false);
    });
    
    return () => unsubscribe();
  }, []);
  
  const handleClick = async () => {
    if (userName.trim()) {
      setInitializing(true);
      
      try {
        localStorage.setItem('userName', userName);
        localStorage.setItem('language', selectedLanguage);
        localStorage.setItem('locale', localeMap[selectedLanguage]);
        
        if (isLoggedIn) {
          try {
            await setScenario(userName, "Default conversation", selectedLanguage);
          } catch (apiError) {
            console.error("API error:", apiError);
          }
        } else {
          localStorage.setItem('isGuest', 'true');
          localStorage.setItem('userId', `guest-${Date.now()}`);
        }

        window.location.href = '/choose';
      } catch (error) {
        console.error("Error initializing user:", error);
        alert("There was a problem connecting to the service. Please try again.");
      } finally {
        setInitializing(false);
      }
    }
  };

  if (loading) {
    return (
      <div 
        className="min-h-screen flex items-center justify-center" 
        style={{ backgroundImage: "url('/icons/background1.jpg')", backgroundSize: "cover" }}
      >
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#48d1cc]"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black p-8" style={{
      backgroundImage: "url('/icons/background1.jpg')",
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
      backgroundAttachment: "fixed"
    }}>
      <div className="flex flex-col items-center justify-center max-w-2xl mx-auto">
        <div className="w-full mt-12 mb-8 bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="p-8">
            <div className="flex items-center space-x-6">
              <div className="w-24 h-24 relative flex-shrink-0">
                <Image src="/icons/chatbot.png" alt="Chatbot Icon" fill className="rounded-full" priority />
              </div>
              <div className="flex flex-col">
                <h1 className="text-xl font-bold text-gray-800">
                  <TypewriterEffect 
                    text="Hi there! It's me, Chatty! Nice to meet you!" 
                    delay={30}
                    startTyping={true}
                    onComplete={() => setFirstLineComplete(true)}
                  />
                </h1>
                <p className="mt-2 text-l text-gray-600">
                  <TypewriterEffect 
                    text="Please enter your username to start practicing with me. The default language is English."
                    delay={30}
                    startTyping={firstLineComplete}
                  />
                </p>
              </div>
            </div>
          </div>
        </div>

        {/*Username Input*/}
        <div className="w-full bg-white rounded-xl shadow-lg overflow-hidden p-6">
          <div className="flex items-center space-x-4 mb-4">
            <div className="w-10 h-10 relative bg-green-100 rounded-full flex-shrink-0">
              <Image src="/icons/profile.png" alt="Profile Icon" fill className="p-2" />
            </div>
            <h2 className="text-xl font-semibold text-black">Username</h2>
          </div>
          
          <div className="relative">
            <input
              type="text"
              id="userName"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className={`w-full px-6 py-4 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent text-lg text-black ${isLoggedIn ? 'bg-gray-100' : ''}`}
              required
              readOnly={isLoggedIn}
            />
            {userName && (
              <div className="absolute top-0 left-0 bg-[#87cefa] text-white px-2 py-0.5 text-xs rounded-tl-lg rounded-br-lg">
                Profile Name
              </div>
            )}
            {!isLoggedIn && (
              <div className="mt-2 text-sm text-indigo-600">
                <a href="/" className="hover:underline">Login or Sign Up</a>
              </div>
            )}
          </div>
        </div>
        
        {/* Continue Button - Jump to the choose page*/}
        <div className="flex justify-center mt-6 w-full">
          <button 
            onClick={handleClick}
            disabled={!userName.trim() || initializing}
            className={`transition-all duration-200 rounded-lg px-6 py-3 shadow-md flex items-center justify-center ${
              userName.trim() && !initializing
                ? 'bg-[#48d1cc] text-white hover:bg-[#008080]' 
                : 'bg-gray-200 text-gray-500 cursor-not-allowed'
            } w-1/3`}
          >
            {initializing ? (
              <>
                <span className="animate-spin mr-2 h-5 w-5 border-t-2 border-b-2 border-white rounded-full"></span>
                <span className="font-medium">Initializing...</span>
              </>
            ) : (
              <>
                <span className="font-medium mr-2">Continue</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default GuestPage;