"use client"
import { useState, useRef, useEffect } from "react";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { auth } from "../../server/firebase";
import { useRouter } from "next/navigation";
import Image from 'next/image';
import TypewriterEffect from '../components/TypewriterEffect';

export default function AuthPage() {
  const [activeTab, setActiveTab] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [userLanguage, setUserLanguage] = useState<string>('en');
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);
  const [firstLineComplete, setFirstLineComplete] = useState(false);
  const router = useRouter();
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const languageIcons: Record<string, string> = {
    'English': '🇺🇸',
    'Chinese': '🇨🇳',
    'Japanese': '🇯🇵',
    'Korean': '🇰🇷',
    'Spanish': '🇪🇸',
    'French': '🇫🇷',
    'Hindi': '🇮🇳'
  };
  
  const localeMap: Record<string, string> = {
    'English': 'en',
    'Chinese': 'zh-CN',
    'Japanese': 'ja',
    'Korean': 'ko',
    'Spanish': 'es',
    'French': 'fr',
    'Hindi': 'hi'
  };
  
  const getLanguageFromLocale = (locale: string): string => {
    const entry = Object.entries(localeMap).find(([_, value]) => value === locale);
    return entry ? entry[0] : 'English';
  };
  
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsLanguageDropdownOpen(false);
      }
    }
    
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleAuth = async () => {
    try {
      setError("");
      if (activeTab === "login") {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);

        try {
          const username = userCredential.user.displayName || email.split('@')[0];
          const response = await fetch(`http://localhost:8000/api/user_profile?username=${encodeURIComponent(username)}`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            }
          });
          
          if (response.ok) {
            const data = await response.json();
            // Save language preference to localStorage
            if (data.language) {
              localStorage.setItem('language', data.language);
              const localeCode = localeMap[data.language] || 'en';
              localStorage.setItem('locale', localeCode);
            }
          }
        } catch (apiError) {
          console.error("Error fetching user language:", apiError);
        }
        
        router.push("/choose");
      } else {
        if (!username.trim()) {
          setError("Username is required");
          return;
        }
        
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, {
          displayName: username
        });
        
        const languageName = getLanguageFromLocale(userLanguage);
        localStorage.setItem('locale', userLanguage);
        localStorage.setItem('language', languageName);
        
        try {
          await fetch(`http://localhost:8000/api/set_user_profile`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              username: username,
              language: languageName,
              locale: userLanguage
            })
          });
        } catch (apiError) {
          console.error("Error saving language preference to backend:", apiError);
        }
        
        router.push("/choose");
      }
    } catch (err) {
      setError("Authentication failed. Check credentials.");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAuth();
    }
  };

  const switchTab = (tab: string) => {
    setActiveTab(tab);
    setError("");
  };
  
  const handleLanguageChange = (languageName: string) => {
    const locale = localeMap[languageName];
    setUserLanguage(locale);
    setIsLanguageDropdownOpen(false);
  };

  return (
    <div 
      className="min-h-screen flex items-center justify-center p-6"
      style={{
        backgroundImage: "url('/icons/background1.jpg')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundAttachment: "fixed"
      }}
    >
      <div className="w-full max-w-2xl flex flex-col items-center">
        {/* Greeting */}
        <div className="w-full mb-8 bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="p-6">
            <div className="flex items-center space-x-6">
              <div className="w-20 h-20 relative flex-shrink-0">
                <Image src="/icons/chatbot.png" alt="Chatbot Icon" fill className="rounded-full" priority />
              </div>
              <div className="flex flex-col">
                <h1 className="text-xl font-bold text-gray-800">
                  <TypewriterEffect 
                    text={"Hello, I am Chatty! Welcome!"}
                    delay={30}
                    startTyping={true}
                    onComplete={() => setFirstLineComplete(true)}
                  />
                </h1>
              </div>
            </div>
          </div>
        </div>

        {/* Auth Form - Now same width as greeting */}
        <div className="w-full bg-white rounded-xl shadow-2xl overflow-hidden">
          <div className="flex border-b border-gray-200">
            <button
              className={`flex-1 py-4 px-6 text-center font-medium text-sm transition-colors duration-200 ${
                activeTab === "login" 
                  ? "text-[#48d1cc] border-b-2 border-[#48d1cc]" 
                  : "text-gray-500 hover:text-gray-700"
              }`}
              onClick={() => switchTab("login")}
            >
              LOGIN
            </button>
            <button
              className={`flex-1 py-4 px-6 text-center font-medium text-sm transition-colors duration-200 ${
                activeTab === "signup" 
                  ? "text-[#48d1cc] border-b-2 border-[#48d1cc]" 
                  : "text-gray-500 hover:text-gray-700"
              }`}
              onClick={() => switchTab("signup")}
            >
              SIGN UP
            </button>
          </div>
          
          <div className="p-8">
            {error && (
              <div className="bg-red-50 text-red-600 rounded-lg p-3 mb-4 text-sm flex items-center">
                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}         
            <div className="space-y-4">
              {activeTab === "signup" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                    <div className="relative rounded-md">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                      <input
                        type="text"
                        className="w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#48d1cc] focus:border-transparent text-gray-900"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Enter your username"
                      />
                    </div>
                  </div>
                  
                  <div className="rounded-lg" ref={dropdownRef}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Language you want to practice
                    </label>
                    <div className="relative">
                      <button 
                        className="w-full flex items-center justify-between px-4 py-3 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#48d1cc] text-gray-900"
                        onClick={() => setIsLanguageDropdownOpen(!isLanguageDropdownOpen)}
                        type="button"
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
                        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                          {Object.entries(languageIcons).map(([language, icon]) => (
                            <div 
                              key={language}
                              className={`flex items-center px-4 py-2 hover:bg-gray-100 cursor-pointer ${
                                getLanguageFromLocale(userLanguage) === language ? 'bg-[#48d1cc] bg-opacity-20' : ''
                              }`}
                              onClick={() => handleLanguageChange(language)}
                            >
                              <span className="text-xl mr-2">{icon}</span>
                              <span>{language}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <div className="relative rounded-md">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                    </svg>
                  </div>
                  <input
                    type="email"
                    className="w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#48d1cc] focus:border-transparent text-gray-900"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Enter your email"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <div className="relative rounded-md">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <input
                    type="password"
                    className="w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#48d1cc] focus:border-transparent text-gray-900"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Enter your password (6 characters)"
                  />
                </div>
              </div>
              
              <button
                onClick={handleAuth}
                className="w-full bg-[#48d1cc] hover:bg-[#008080] text-white py-3 rounded-lg transition-colors duration-200 flex items-center justify-center font-medium mt-6"
              >
                {activeTab === "login" ? "Login" : "Sign Up"}
                <svg className="ml-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
              
              <div className="text-center mt-6"> 
                <button
                  onClick={() => router.push("/guest")}
                  className="text-[#008080] hover:text-green-800 font-medium transition-colors duration-200"
                >
                  Proceed as Guest
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}