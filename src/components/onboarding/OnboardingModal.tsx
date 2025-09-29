'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { useOnboarding } from './OnboardingProvider';
import { useConfig } from '@/components/ConfigProvider';
import { WelcomeStep } from './steps/WelcomeStep';
import { PasswordSetup } from './steps/PasswordSetup';
import { ApiKeyStep } from './steps/ApiKeyStep';
import { SymbolConfigStep } from './steps/SymbolConfigStep';
import { DashboardTourStep } from './steps/DashboardTourStep';
import { CompletionStep } from './steps/CompletionStep';

export function OnboardingModal() {
  const {
    isOnboarding,
    currentStep,
    steps,
    nextStep,
    previousStep,
    skipOnboarding,
    completeStep,
    setShowTutorial,
  } = useOnboarding();

  const { config, updateConfig } = useConfig();
  const [apiKeys, setApiKeys] = useState({ apiKey: '', secretKey: '' });
  const [isPaperMode, setIsPaperMode] = useState(false);

  const progress = ((currentStep + 1) / steps.length) * 100;

  const handleWelcomeNext = () => {
    completeStep('welcome');
    nextStep();
  };

  const handlePasswordSetup = async (password: string) => {
    // Update config with the new password
    if (config) {
      const updatedConfig = {
        ...config,
        global: {
          ...config.global,
          server: {
            ...config.global.server,
            dashboardPassword: password,
          },
        },
      };
      await updateConfig(updatedConfig);
    }

    completeStep('password-setup');
    nextStep();
  };

  const handlePasswordSkip = () => {
    // Keep default "admin" password
    completeStep('password-setup');
    nextStep();
  };

  const handleApiKeyNext = async (apiKey: string, secretKey: string) => {
    setApiKeys({ apiKey, secretKey });
    setIsPaperMode(!apiKey && !secretKey);

    // Update config with API keys
    if (config) {
      const updatedConfig = {
        ...config,
        api: { apiKey, secretKey },
        global: {
          ...config.global,
          paperMode: !apiKey && !secretKey,
        },
      };
      await updateConfig(updatedConfig);
    }

    completeStep('api-setup');
    nextStep();
  };

  const handleSymbolConfigNext = async (symbolConfigs: any[], riskPercent: number) => {
    if (config) {
      const symbolsObject: any = {};
      symbolConfigs.forEach(sc => {
        symbolsObject[sc.symbol] = {
          volumeThresholdUSDT: sc.volumeThreshold,
          tradeSize: sc.symbol === 'BTCUSDT' ? 0.001 : 0.01,
          leverage: sc.leverage,
          tpPercent: sc.tpPercent,
          slPercent: sc.slPercent,
        };
      });

      const updatedConfig = {
        ...config,
        symbols: symbolsObject,
        global: {
          ...config.global,
          riskPercent,
        },
      };
      await updateConfig(updatedConfig);
    }

    completeStep('symbol-config');
    nextStep();
  };

  const handleDashboardTourNext = () => {
    completeStep('dashboard-tour');
    nextStep();
  };

  const handleStartTour = () => {
    setShowTutorial(true);
  };

  const handleComplete = () => {
    completeStep('completion');
    skipOnboarding();
    // Force refresh page to repull dashboard data with new API keys
    setTimeout(() => {
      window.location.reload();
    }, 500);
  };

  const handleSkip = () => {
    if (confirm('Are you sure you want to skip the setup? You can always access it later from the help menu.')) {
      skipOnboarding();
      // Force refresh page to repull dashboard data
      setTimeout(() => {
        window.location.reload();
      }, 500);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <WelcomeStep onNext={handleWelcomeNext} onSkip={handleSkip} />;
      case 1:
        return <PasswordSetup onComplete={handlePasswordSetup} onSkip={handlePasswordSkip} />;
      case 2:
        return <ApiKeyStep onNext={handleApiKeyNext} onBack={previousStep} onSkip={handleSkip} />;
      case 3:
        return <SymbolConfigStep onNext={handleSymbolConfigNext} onBack={previousStep} isPaperMode={isPaperMode} />;
      case 4:
        return <DashboardTourStep onNext={handleDashboardTourNext} onBack={previousStep} onStartTour={handleStartTour} />;
      case 5:
        return <CompletionStep onComplete={handleComplete} isPaperMode={isPaperMode} hasApiKeys={!!apiKeys.apiKey} />;
      default:
        return null;
    }
  };

  return (
    <Dialog open={isOnboarding} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="sr-only">Setup Wizard</DialogTitle>
            {currentStep > 0 && currentStep < steps.length - 1 && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleSkip}
                className="absolute right-4 top-4"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          {currentStep < steps.length - 1 && (
            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Step {currentStep + 1} of {steps.length}</span>
                <span>{Math.round(progress)}% Complete</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}
        </DialogHeader>

        <div className="mt-4">
          {renderStep()}
        </div>
      </DialogContent>
    </Dialog>
  );
}