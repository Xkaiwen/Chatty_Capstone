"use client"
import { ScenarioProvider } from '../../context/scenarioContext';

export default function ScenarioLayout({ children }: { children: React.ReactNode }) {
  return (
    <ScenarioProvider>
      {children}
    </ScenarioProvider>
  );
}