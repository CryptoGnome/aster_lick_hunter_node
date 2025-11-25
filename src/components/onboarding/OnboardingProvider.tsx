'use client';

import React, { createContext, useState, useEffect, useContext, ReactNode } from 'react';

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
}

interface OnboardingContextType {
  isOnboarding: boolean | null; // null = loading/checking server
  currentStep: number;
  steps: OnboardingStep[];
  showTutorial: boolean;
  startOnboarding: () => void;
  completeStep: (stepId: string) => void;
  nextStep: () => void;
  previousStep: () => void;
  skipOnboarding: () => void;
  resetOnboarding: () => void;
  setShowTutorial: (show: boolean) => void;
  isNewUser: boolean;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

export const useOnboarding = () => {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return context;
};

const ONBOARDING_STORAGE_KEY = 'aster_onboarding_state';
const ONBOARDING_COMPLETE_KEY = 'aster_onboarding_complete';

const initialSteps: OnboardingStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Aster Liquidation Hunter',
    description: 'Learn how to set up and use the automated trading bot',
    completed: false,
  },
  {
    id: 'password-setup',
    title: 'Dashboard Security',
    description: 'Set a password to protect your dashboard',
    completed: false,
  },
  {
    id: 'api-setup',
    title: 'API Key Configuration',
    description: 'Connect your Aster Exchange account',
    completed: false,
  },
  {
    id: 'symbol-config',
    title: 'Trading Configuration',
    description: 'Choose symbols and set risk parameters',
    completed: false,
  },
  {
    id: 'dashboard-tour',
    title: 'Dashboard Overview',
    description: 'Explore the main features and interface',
    completed: false,
  },
  {
    id: 'completion',
    title: 'Setup Complete',
    description: 'You\'re ready to start trading',
    completed: false,
  },
];

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [isOnboarding, setIsOnboarding] = useState<boolean | null>(null); // null = loading, checking server
  const [currentStep, setCurrentStep] = useState(0);
  const [steps, setSteps] = useState<OnboardingStep[]>(initialSteps);
  const [showTutorial, setShowTutorial] = useState(false);
  const [isNewUser, setIsNewUser] = useState(false);

  // Check server-side setup state from public endpoint (no auth required)
  const checkSetupStatus = async () => {
    try {
      const response = await fetch('/api/public-status');
      if (response.ok) {
        const data = await response.json();
        return {
          hasApiKeys: data.hasApiKeys === true,
          setupComplete: data.setupComplete === true
        };
      }
    } catch (error) {
      console.error('Could not check setup status:', error);
    }
    return { hasApiKeys: false, setupComplete: false };
  };

  // Load onboarding state - check server config instead of localStorage
  useEffect(() => {
    const initializeOnboarding = async () => {
      const { hasApiKeys, setupComplete } = await checkSetupStatus();

      console.log('🔍 Onboarding check:', { hasApiKeys, setupComplete });

      // If setup is complete server-side, skip onboarding regardless of browser/device
      if (setupComplete) {
        console.log('✅ Setup complete - skipping onboarding');
        setIsOnboarding(false);
        return;
      }

      // If no API keys configured, force onboarding
      if (!hasApiKeys) {
        console.log('⚠️ No API keys - forcing onboarding');
        setIsNewUser(true);
        setIsOnboarding(true);
        setCurrentStep(1); // Start at API key step
        return;
      }

      // If we have API keys but setup not marked complete, assume it's an old install
      // Skip onboarding but let them access it from help menu if needed
      console.log('ℹ️ Has API keys but setup not complete - skipping onboarding (legacy install)');
      setIsOnboarding(false);
    };

    initializeOnboarding();
  }, []);

  // Listen for restart onboarding event
  useEffect(() => {
    const handleRestartOnboarding = () => {
      resetOnboarding();
    };

    window.addEventListener('restart-onboarding', handleRestartOnboarding);
    return () => window.removeEventListener('restart-onboarding', handleRestartOnboarding);
  }, []);

  // Save onboarding state to localStorage
  useEffect(() => {
    if (isOnboarding) {
      const state = {
        steps,
        currentStep,
      };
      localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
    }
  }, [steps, currentStep, isOnboarding]);

  const startOnboarding = () => {
    setIsOnboarding(true);
    setCurrentStep(0);
  };

  const completeStep = (stepId: string) => {
    setSteps(prevSteps =>
      prevSteps.map(step =>
        step.id === stepId ? { ...step, completed: true } : step
      )
    );
  };

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      completeStep(steps[currentStep].id);
      setCurrentStep(currentStep + 1);
    } else {
      // Complete onboarding
      skipOnboarding();
    }
  };

  const previousStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const skipOnboarding = async () => {
    setIsOnboarding(false);
    
    // Mark setup as complete in server config (persistent across browsers/devices)
    try {
      const response = await fetch('/api/config');
      if (response.ok) {
        const config = await response.json();
        const updatedConfig = {
          ...config,
          global: {
            ...config.global,
            server: {
              ...config.global?.server,
              setupComplete: true
            }
          }
        };
        
        await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedConfig)
        });
      }
    } catch (error) {
      console.error('Failed to update setup status:', error);
    }
    
    // Keep localStorage for backward compatibility
    localStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
    localStorage.setItem('aster_setup_complete', 'true');
  };

  const resetOnboarding = async () => {
    setSteps(initialSteps);
    setCurrentStep(0);
    setIsOnboarding(true);
    
    // Clear server-side setup state
    try {
      const response = await fetch('/api/config');
      if (response.ok) {
        const config = await response.json();
        const updatedConfig = {
          ...config,
          global: {
            ...config.global,
            server: {
              ...config.global?.server,
              setupComplete: false
            }
          }
        };
        
        await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedConfig)
        });
      }
    } catch (error) {
      console.error('Failed to reset setup status:', error);
    }
    
    // Clear localStorage
    localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    localStorage.removeItem(ONBOARDING_COMPLETE_KEY);
  };

  return (
    <OnboardingContext.Provider
      value={{
        isOnboarding,
        currentStep,
        steps,
        showTutorial,
        startOnboarding,
        completeStep,
        nextStep,
        previousStep,
        skipOnboarding,
        resetOnboarding,
        setShowTutorial,
        isNewUser,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}