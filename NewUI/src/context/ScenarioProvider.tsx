"use client"
import React, { createContext, useContext, useState, ReactNode } from 'react';

type Scenario = {
  id: string;
  title: string;
  content: string;
};

type ScenarioContextType = {
  scenarios: Scenario[];
  addScenario: (title: string, content: string) => void;
};

const ScenarioContext = createContext<ScenarioContextType | undefined>(undefined);

export function ScenarioProvider({ children }: { children: ReactNode }) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);

  const addScenario = (title: string, content: string) => {
    const newScenario = {
      id: Date.now().toString(),
      title,
      content,
    };
    setScenarios([...scenarios, newScenario]);
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