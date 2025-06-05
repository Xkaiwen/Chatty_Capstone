"use client"
import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ScenarioProvider, useScenarios } from '../../context/scenarioContext';
import { auth } from "../../../server/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { createCustomScenario, checkExistingScenario } from '@/services/api';

const CustomScenarioWrapper = () => {
  return (
    <ScenarioProvider>
      <CustomScenario />
    </ScenarioProvider>
  );
};

const CustomScenario = () => {
  const [scenario, setScenario] = useState('');
  const router = useRouter();
  const { addScenario } = useScenarios();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalMessage, setModalMessage] = useState('');
  const [modalType, setModalType] = useState<'success' | 'error' | 'warning'>('success');
  const [shouldRedirect, setShouldRedirect] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    
    return () => unsubscribe();
  }, []);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setScenario(event.target.value);
  };

  const showCustomAlert = (message: string, type: 'success' | 'error' | 'warning', redirect: boolean = false) => {
    setModalMessage(message);
    setModalType(type);
    setShouldRedirect(redirect);
    setShowModal(true);
  };

  const handleModalClose = () => {
    setShowModal(false);
    
    if (shouldRedirect) {
      router.push('/scenario');
    }
  };

  const handleSubmit = async () => {
    if (!scenario.trim()) {
      showCustomAlert("Please enter a scenario title", "warning");
      return;
    }
    
    if (!user) {
      showCustomAlert("You must be logged in to create a custom scenario", "warning", true);
      return;
    }
    
    setIsSaving(true);
    
    try {
      const username = user.displayName || user.email?.split('@')[0] || 'Guest';
      const scenarioTitle = scenario.trim();
      const existingCheck = await checkExistingScenario(username, scenarioTitle);
            
      if (existingCheck.exists) {
        showCustomAlert(
          "You already have a scenario with this title. Please use a different name.", 
          "warning"
        );
        setIsSaving(false);
        return;
      }
      
      console.log("Creating custom scenario:", {
        username,
        title: scenarioTitle,
        description: `Custom scenario: ${scenarioTitle}`
      });
      
      const response = await createCustomScenario(
        username, 
        scenarioTitle, 
        `Custom scenario: ${scenarioTitle}`
      );
      
      console.log("Create scenario response:", response);
      
      if (response.error) {
        throw new Error(response.error);
      }
      
      addScenario(scenarioTitle);
      
      showCustomAlert("Custom scenario created successfully!", "success", true);
    } catch (error: any) {
      console.error("Error creating custom scenario:", error);
      showCustomAlert(
        `There was a problem creating your custom scenario: ${error.message || "Unknown error"}`, 
        "error"
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleBackClick = () => {
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
    <div className="min-h-screen bg-black p-8 relative"
    style={{
      backgroundImage: "url('/icons/background1.jpg')",
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
      backgroundAttachment: "fixed"
    }}>
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
      
      <div className="mt-24 max-w-2xl mx-auto mb-8 bg-white rounded-xl shadow-lg overflow-hidden">
        <div className="p-8">
          <div className="flex items-center space-x-6 mb-6">
            <div className="w-16 h-16 relative flex-shrink-0">
              <Image
                src="/icons/idea.png" 
                alt="Custom Scenario Icon"
                fill
                className="rounded-full"
                priority
              />
            </div>
            <h1 className="text-2xl font-bold text-gray-800">
              Create Your Custom Scenario
            </h1>
          </div>
          
          <input
            type="text"
            value={scenario}
            onChange={handleInputChange}
            placeholder="Enter your custom scenario title..."
            className="w-full p-4 border border-gray-300 rounded-lg mb-6 text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#48d1cc] focus:border-transparent"
            onKeyPress={(e) => e.key === 'Enter' && handleSubmit()}
          />
          
          <button
            onClick={handleSubmit}
            disabled={isSaving}
            className={`w-full ${isSaving ? 'bg-gray-400' : 'bg-[#48d1cc] hover:bg-[#20b2aa]'} text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200 flex items-center justify-center`}
          >
            {isSaving ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white mr-2"></div>
                Creating...
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Create Scenario
              </>
            )}
          </button>
        </div>
      </div>
      
      {/* New Beautiful Modal Design */}
      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50">
          <div 
            className="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"
            onClick={handleModalClose}
          ></div>
          
          <div className="bg-white dark:bg-gray-800 w-full max-w-md mx-4 rounded-2xl shadow-2xl transform transition-all overflow-hidden z-10 animate-fadeIn">
            <div className={`
              ${modalType === 'success' ? 'bg-gradient-to-r from-green-400 to-green-600' : 
                modalType === 'error' ? 'bg-gradient-to-r from-red-400 to-red-600' : 
                'bg-gradient-to-r from-yellow-400 to-amber-500'}
              p-5
            `}>
              <div className="flex items-center">
                <div className="mr-4 bg-white bg-opacity-20 rounded-full p-2">
                  {modalType === 'success' && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {modalType === 'error' && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                  {modalType === 'warning' && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  )}
                </div>
                <h2 className="text-xl font-bold text-white">
                  {modalType === 'success' ? 'Success' : 
                  modalType === 'error' ? 'Error' : 'Warning'}
                </h2>
              </div>
            </div>
            
            <div className="p-6">
              <p className="text-gray-700 dark:text-gray-300 text-lg mb-8">{modalMessage}</p>
              
              <div className="flex justify-end">
                <button 
                  onClick={handleModalClose}
                  className={`px-5 py-2.5 rounded-lg font-medium text-white shadow-md transform transition-transform duration-200 hover:scale-105 active:scale-95 
                    ${modalType === 'success' ? 'bg-green-500 hover:bg-green-600' : 
                      modalType === 'error' ? 'bg-red-500 hover:bg-red-600' : 
                      'bg-amber-500 hover:bg-amber-600'}
                  `}
                >
                  {shouldRedirect ? 'Continue' : 'Close'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomScenarioWrapper;