"use client"
import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { auth } from "../../../server/firebase";
import { onAuthStateChanged, User } from "firebase/auth";

const HelpPage = () => {
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
      setUser(currentUser);
      
      const storedLanguage = localStorage.getItem('language');
      const storedLocale = localStorage.getItem('locale');
      
      if (storedLocale) {
        setUserLanguage(storedLocale);
      }
      
      setLoading(false);
    });
  
    return () => unsubscribe();
  }, []);

  const handleBackClick = () => {
    router.push('/choose');
  };

  const handleProfileMenuClick = () => {
    if (!showProfileMenu) {
      const currentLocale = localStorage.getItem('locale') || 'en';
      setUserLanguage(currentLocale);
    }
    setShowProfileMenu(!showProfileMenu);
  };

  const navigateToDashboard = () => {
    router.push('/dashboard');
    setShowProfileMenu(false);
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
    <div className="min-h-screen bg-gray-900 text-white p-8 relative"
      style={{
        backgroundImage: "url('/icons/background1.jpg')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundAttachment: "fixed"
      }}>
      
      {/* Profile menu and back button container */}
      <div className="flex items-center gap-4 absolute top-8 left-8 z-10">
        {/* Profile menu */}
        <div className="relative">
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
          className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 transition-colors duration-200 flex items-center justify-center"
        >
          <Image
            src="/icons/back.png"
            alt="Back"
            width={24}
            height={24}
            className="text-white"
          />
        </button>
      </div>

        <div className="mt-16 max-w-5xl mx-auto bg-white rounded-xl shadow-lg overflow-hidden">
        <div className="p-8 text-gray-800">
            <h1 className="text-2xl font-bold mb-6 text-center">Help & Tips</h1>
            
            <div className="space-y-8">
            {/* Video Tutorial Section */}
            <div className="mb-8">
                <div className="relative pb-[36%] h-0 overflow-hidden rounded-lg shadow-md max-w-3xl mx-auto">
                <iframe 
                    className="absolute top-0 left-0 w-full h-full"
                    src="" 
                    title="Tutorial Video"
                    frameBorder="0" 
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                    allowFullScreen>
                </iframe>
                </div>
            </div>

            {/* Dashboard Page */}
            <div className="bg-gray-50 p-5 rounded-lg border-l-4 border-blue-500">
                <h2 className="text-lg font-semibold mb-3">Dashboard</h2>
                <p className="text-gray-600 mb-3">
                View your personal profile for accessing the past conversations and get suggestions for your next practice sessions.
                </p>
                <ul className="list-disc pl-5 text-gray-600 space-y-2">
                <li><span className="font-medium">Recent Activities:</span> See your recent conversations and practice sessions.</li>
                <li><span className="font-medium">Language Selection:</span> Change your learning language preference.</li>
                </ul>
            </div>

            {/* Choose Page */}
            <div className="bg-gray-50 p-5 rounded-lg border-l-4 border-green-500">
                <h2 className="text-lg font-semibold mb-3">Choose Page</h2>
                <p className="text-gray-600 mb-3">
                Select your preferred practice mode from the available options.
                </p>
                <ul className="list-disc pl-5 text-gray-600 space-y-2">
                <li><span className="font-medium">Free Conversation:</span> Chat about any topic to improve general language skills.</li>
                <li><span className="font-medium">Roleplay:</span> Practice conversation in specific scenarios like ordering food, booking hotels, etc.</li>
                <li><span className="font-medium">Voice Chat:</span> Focus on practicing pronunciation.</li>
                </ul>
            </div>

            {/* Conversation Page */}
            <div className="bg-gray-50 p-5 rounded-lg border-l-4 border-purple-500">
                <h2 className="text-lg font-semibold mb-3">Free Conversation</h2>
                <p className="text-gray-600 mb-3">
                Chat with our AI language assistant about any topic in your target language. You can also type any other languages to communicate.
                </p>
                <ul className="list-disc pl-5 text-gray-600 space-y-2">
                <li><span className="font-medium">Typing:</span> Enter your message in the text field and press enter to send.</li>
                <li><span className="font-medium">Voice Input:</span> Click the microphone icon to speak your message instead of typing.</li>
                <li><span className="font-medium">Response Audio:</span> Click the play button on any AI response to hear it spoken aloud.</li>
                <li><span className="font-medium">Suggestions:</span> Use the suggestion chips to quickly respond with common phrases.</li>
                <li><span className="font-medium">Dictionary:</span> Check any word in the conversation to see its definition and examples.</li>
                </ul>
            </div>

            {/* Roleplay Page */}
            <div className="bg-gray-50 p-5 rounded-lg border-l-4 border-yellow-500">
                <h2 className="text-lg font-semibold mb-3">Roleplay Scenarios</h2>
                <p className="text-gray-600 mb-3">
                Practice specific real-life scenarios to build situational language skills.
                </p>
                <ul className="list-disc pl-5 text-gray-600 space-y-2">
                <li><span className="font-medium">Scenario Selection:</span> Choose from various scenarios like restaurants, travel, shopping, or create a new one.</li>
                <li><span className="font-medium">Character Interaction:</span> The AI assumes a role based on different Scenarios (waiter, hotel staff, etc.).</li>
                <li><span className="font-medium">Custom Scenarios:</span> Create your own custom scenarios for personalized practice.</li>
                </ul>
            </div>

            {/* Talk Voice Page */}
            <div className="bg-gray-50 p-5 rounded-lg border-l-4 border-red-500">
                <h2 className="text-lg font-semibold mb-3">Voice Training</h2>
                <p className="text-gray-600 mb-3">
                Focus specifically on pronunciation and speaking skills with immediate feedback and scores.
                </p>
                <ul className="list-disc pl-5 text-gray-600 space-y-2">
                <li><span className="font-medium">Speaking Exercises:</span> Practice saying specific phrases provided by the AI.</li>
                <li><span className="font-medium">Pronunciation Feedback:</span> Get detailed feedback on your pronunciation accuracy.</li>
                <li><span className="font-medium">Difficulty Levels:</span> Progress from basic phrases to more complex sentences.</li>
                </ul>
            </div>

            {/* General Tips */}
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-5 rounded-lg border border-blue-100">
                <h2 className="text-lg font-semibold mb-3">General Tips for Effective Practice</h2>
                <ul className="list-disc pl-5 text-gray-600 space-y-3">
                <li><span className="font-medium">Regular Practice:</span> Short, frequent sessions (15-20 minutes daily) are more effective than occasional long sessions.</li>
                <li><span className="font-medium">Mix Approaches:</span> Combine roleplay, conversation, and voice training for well-rounded skills.</li>
                </ul>
            </div>
            <div>
                <h2 className="text-lg font-semibold mb-2">Need More Help or Want to Provide Feedback?</h2>
                <p className="text-gray-600">
                Contact us at kaiwenxue0718@gmail.com for additional assistance or to provide feedback.
                </p>
            </div>
            </div>
        </div>
        </div>
    </div>
  );
};

export default HelpPage;