"use client"
import { ScenarioProvider } from '../../context/scenarioContext';

export default function CustomLayout({ children }: { children: React.ReactNode }) {
  return (
    <ScenarioProvider>
      {children}
    </ScenarioProvider>
  );
}