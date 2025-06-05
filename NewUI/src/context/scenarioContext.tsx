"use client"
import React, { createContext, useContext, useState, useEffect } from 'react';

type Scenario = {
  id: string;
  title: string;
};

type ScenarioContextType = {
  scenarios: Scenario[];
  addScenario: (title: string) => void;
};

const ScenarioContext = createContext<ScenarioContextType | undefined>(undefined);

export function ScenarioProvider({ children }: { children: React.ReactNode }) {
  const [scenarios, setScenarios] = useState<Scenario[]>(() => {
    if (typeof window !== 'undefined') {
      const savedScenarios = localStorage.getItem('userScenarios');
      return savedScenarios ? JSON.parse(savedScenarios) : [];
    }
    return [];
  });

  useEffect(() => {
    if (scenarios.length > 0) {
      localStorage.setItem('userScenarios', JSON.stringify(scenarios));
    }
  }, [scenarios]);

  const addScenario = (title: string) => {
    const newScenario = { 
      id: Date.now().toString(), 
      title 
    };
    const updatedScenarios = [...scenarios, newScenario];
    setScenarios(updatedScenarios);
    localStorage.setItem('userScenarios', JSON.stringify(updatedScenarios));
  };

  return (
    <ScenarioContext.Provider value={{ scenarios, addScenario }}>
      {children}
    </ScenarioContext.Provider>
  );
}

export function useScenarios() {
  const context = useContext(ScenarioContext);
  if (context === undefined) {
    throw new Error('useScenarios must be used within a ScenarioProvider');
  }
  return context;
}