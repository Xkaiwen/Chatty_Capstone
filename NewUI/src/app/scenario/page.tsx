"use client"
import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { auth } from "../../../server/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { getUserProfile, setScenario, deleteCustomScenario } from '@/services/api';

interface Scenario {
  id: string;
  title: string;
  description: string;
  created_at?: string;
  custom?: boolean;
}

const defaultScenarios: Scenario[] = [
  {
    id: "restaurant",
    title: "Restaurant",
    description: "Practice ordering food and having conversations in a restaurant setting.",
    created_at: new Date().toISOString()
  },
  {
    id: "travel",
    title: "Travel",
    description: "Engage in conversations related to travel, booking tickets, and asking for directions.",
    created_at: new Date().toISOString()
  },
  {
    id: "shopping",
    title: "Shopping",
    description: "Practice dialogues for shopping, asking about prices, and making purchases.",
    created_at: new Date().toISOString()
  }
];

const ScenarioPage = () => {
  const [userLanguage, setUserLanguage] = useState<string>('en');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [scenarios, setScenarios] = useState<Scenario[]>(defaultScenarios);
  const [filteredScenarios, setFilteredScenarios] = useState<Scenario[]>(defaultScenarios);
  const [searchQuery, setSearchQuery] = useState('');
  
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    console.log("ScenarioPage mounted");
    
    return () => {
      console.log("ScenarioPage unmounted");
    };
  }, []);

  useEffect(() => {
    console.log("Setting up auth state listener");
    setLoading(true);
    
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      console.log("Auth state changed:", currentUser?.email);
      setUser(currentUser);
      
      const savedLocale = localStorage.getItem('locale') || 'en';
      setUserLanguage(savedLocale);
      
      if (currentUser) {
        await loadScenarios(currentUser);
      } else {
        setScenarios(defaultScenarios);
        setFilteredScenarios(defaultScenarios);
      }
      
      setLoading(false);
    });
    
    return () => {
      console.log("Cleaning up auth state listener");
      unsubscribe();
    };
  }, []);

  const loadScenarios = async (currentUser: User | null) => {
    try {
      console.log("Loading scenarios...");
      let allScenarios = [...defaultScenarios];
      
      if (currentUser) {
        const username = currentUser.displayName || currentUser.email?.split('@')[0] || 'Guest';
        console.log("Fetching custom scenarios for user:", username);
        
        try {
          const response = await getUserProfile(username);
          
          console.log("User profile response:", response);
          
          if (response.error) {
            console.error("Error fetching user profile:", response.error);
          } else if (response.data && response.data.custom_scenarios) {
            console.log("Found custom scenarios:", response.data.custom_scenarios.length);
            
            const customScenarios = response.data.custom_scenarios.map((scenario: any) => ({
              id: scenario.id,
              title: scenario.title,
              description: scenario.description,
              created_at: scenario.created_at,
              custom: true
            }));
            
            allScenarios = [...defaultScenarios, ...customScenarios];
            console.log("Combined scenarios:", allScenarios.length, "total");
          }
        } catch (fetchError) {
          console.error("Error during fetch operation:", fetchError);
        }
      }
      
      console.log("Setting scenarios state:", allScenarios.length, "scenarios");
      setScenarios(allScenarios);
      setFilteredScenarios(allScenarios);
      return allScenarios;
    } catch (error) {
      console.error("Error loading scenarios:", error instanceof Error ? error.message : String(error));
      setScenarios(defaultScenarios);
      setFilteredScenarios(defaultScenarios);
      return defaultScenarios;
    }
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

  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredScenarios(scenarios);
    } else {
      const filtered = scenarios.filter(scenario => 
        scenario.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        scenario.description.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredScenarios(filtered);
    }
  }, [searchQuery, scenarios]);

  const handleBackClick = () => {
    router.push('/choose');
  };
  
  const navigateToDashboard = () => {
    router.push('/dashboard');
    setShowProfileMenu(false);
  };

  const handleAddCustomScenario = () => {
    router.push('/scenario/custom');
  };

  const handleDeleteScenario = async (e: React.MouseEvent, scenario: Scenario) => {
    e.stopPropagation();
    
    if (!scenario.custom) {
      alert("Default scenarios cannot be deleted.");
      return;
    }
    
    if (!window.confirm(`Are you sure you want to delete the "${scenario.title}" scenario?`)) {
      return;
    }
    
    try {
      if (user) {
        const username = user.displayName || user.email?.split('@')[0] || 'Guest';
        
        console.log(`Attempting to delete scenario: ${scenario.id} for user: ${username}`);
        
        // Update local UI first (optimistic update)
        const updatedScenarios = scenarios.filter(s => s.id !== scenario.id);
        setScenarios(updatedScenarios);
        setFilteredScenarios(
          searchQuery ? 
            updatedScenarios.filter(s => 
              s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
              s.description.toLowerCase().includes(searchQuery.toLowerCase())
            ) : 
            updatedScenarios
        );
        
        try {
          // Make API call to delete from database
          console.log("Sending delete request to API...");
          const response = await deleteCustomScenario(username, scenario.id);
          console.log("Delete API response:", response);
          
          if (response.error) {
            console.error("Error from backend:", response.error);
            
            // Show error message but keep the UI updated
            alert(`Warning: ${response.error}. The scenario was removed from view but may still exist in the database.`);
          } else {
            console.log("Successfully deleted scenario from database:", response.data);
            alert(`"${scenario.title}" has been deleted successfully.`);
          }
          
          // Reload scenarios to ensure UI is in sync with database
          await loadScenarios(user);
        } catch (apiError) {
          console.error("API call failed:", apiError);
          alert("Warning: The scenario was removed locally but may not have been deleted from the database. Please try again later.");
          
          // Reload scenarios
          await loadScenarios(user);
        }
      }
    } catch (error) {
      console.error("Error deleting scenario:", error);
      alert("Failed to delete scenario. Please try again.");
      // Reload scenarios to restore state if needed
      if (user) await loadScenarios(user);
    }
  };

  const handleScenarioSelect = async (scenario: Scenario) => {
    try {
      localStorage.setItem('currentScenario', JSON.stringify(scenario));
      
      if (user) {
        const username = user.displayName || user.email?.split('@')[0] || 'Guest';
        const language = localStorage.getItem('locale') || 'en';
        
        console.log(`Setting scenario: ${scenario.title} for user: ${username} in language: ${language}`);
        
        try {
          const response = await setScenario(
            username,
            scenario.title, 
            language,
            scenario.description
          );
          
          console.log("Backend response from setScenario:", response);
          
          if (response && response.error) {
            console.error("Error from backend:", response.error);
          } else {
            console.log("Scenario set successfully:", scenario.title);
          }
        } catch (apiError) {
          console.error("API error setting scenario:", apiError instanceof Error ? apiError.message : String(apiError));
        }
      } else {
        console.warn("No user logged in, scenario only saved locally");
      }
      
      router.push('/roleplay');
    } catch (error) {
      console.error("Error in handleScenarioSelect:", error instanceof Error ? error.message : String(error));
      router.push('/roleplay');
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
    <div 
      className="min-h-screen relative bg-cover bg-center"
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
        />
      </button>
      
      <div className="container mx-auto pt-24 px-4">
        <div className="bg-white bg-opacity-95 rounded-xl shadow-lg p-6 mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Choose a Scenario</h1>
            <p className="text-gray-600">Select a conversation scenario to practice</p>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="relative">
              <input 
                type="text" 
                placeholder="Search scenarios..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#48d1cc] text-black"
              />
              <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
                <Image src="/icons/search.png" alt="Search" width={18} height={18} />
              </div>
            </div>
            
            <button 
              onClick={handleAddCustomScenario}
              className="bg-[#20b2aa] text-white px-4 py-2 rounded-lg flex items-center"
            >
              <Image src="/icons/add.png" alt="Add" width={18} height={18} className="mr-2" />
              Custom Scenario
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredScenarios.map(scenario => (
            <div
              key={scenario.id}
              onClick={() => handleScenarioSelect(scenario)}
              className={`bg-white bg-opacity-90 rounded-xl shadow-lg overflow-hidden cursor-pointer transform transition-all duration-200 hover:scale-105 hover:shadow-xl ${
                scenario.custom ? 'border-2 border-[#20b2aa]' : ''
              }`}
            >
              <div className={`p-5 ${scenario.custom ? 'border-t-4 border-[#20b2aa]' : 'border-t-4 border-blue-500'}`}>
                <div className="flex justify-between items-start mb-3">
                  <h2 className="text-xl font-bold text-gray-800">{scenario.title}</h2>
                  {scenario.custom && (
                    <span className="bg-[#20b2aa] text-white text-xs px-2 py-1 rounded-full">
                      Custom
                    </span>
                  )}
                </div>
                <p className="text-gray-600 mb-4">{scenario.description}</p>
                <div className="flex justify-between items-center">
                  <div>
                    {scenario.custom && (
                      <button 
                        onClick={(e) => handleDeleteScenario(e, scenario)}
                        className="text-sm text-red-600 hover:text-red-800 transition-colors font-medium flex items-center"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Delete
                      </button>
                    )}
                  </div>
                  <button className="text-sm text-blue-600 hover:text-blue-800 transition-colors font-medium flex items-center">
                    Start Practice
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ScenarioPage;