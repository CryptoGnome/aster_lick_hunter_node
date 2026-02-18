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
import type { Config, SymbolConfig } from '@/lib/types';
import { WelcomeStep } from './steps/WelcomeStep';
import { PasswordSetup } from './steps/PasswordSetup';
import { ApiKeyStep } from './steps/ApiKeyStep';
import { SymbolConfigStep } from './steps/SymbolConfigStep';
import { DashboardTourStep } from './steps/DashboardTourStep';
import { CompletionStep } from './steps/CompletionStep';
import { hashPassword } from '@/lib/utils/password';

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
    console.log('🔍 handlePasswordSetup - DEBUG START');
    console.log('Password received:', password);
    console.log('Current config exists:', !!config);

    if (!config) {
      console.error('❌ Config not loaded yet');
      return;
    }

    // Hash the password before storing
    const hashedPassword = await hashPassword(password);
    console.log('🔐 Password hashed successfully');

    // CRITICAL: Preserve ALL existing config, only update password
    const updatedConfig = {
      ...config,
      api: config.api || { apiKey: '', secretKey: '' },
      symbols: config.symbols || {},
      global: {
        ...config.global,
        server: {
          ...config.global?.server,
          dashboardPassword: hashedPassword
        }
      },
      version: config.version || '1.1.0'
    };

    console.log('📋 Saving updated config with password');

    try {
      await updateConfig(updatedConfig);
      console.log('✅ Config saved successfully');
      completeStep('password-setup');
      nextStep();
    } catch (error) {
      console.error('❌ Config save failed:', error);
      throw error;
    }
  };

  const handlePasswordSkip = () => {
    // Keep default "admin" password
    completeStep('password-setup');
    nextStep();
  };

  const handleApiKeyNext = async (apiKey: string, secretKey: string) => {
    setApiKeys({ apiKey, secretKey });
    const paperMode = !apiKey && !secretKey;
    setIsPaperMode(paperMode);

    // Update config with API keys
    if (config) {
      const updatedConfig: Config = {
        ...config,
        api: { apiKey, secretKey },
        global: {
          ...config.global,
          paperMode,
          // Ensure all required global config properties are present
          riskPercent: config.global?.riskPercent ?? 2,
          positionMode: config.global?.positionMode ?? 'ONE_WAY',
          maxOpenPositions: config.global?.maxOpenPositions ?? 10,
          useThresholdSystem: config.global?.useThresholdSystem ?? false,
          server: {
            ...config.global?.server,
            dashboardPassword: config.global?.server?.dashboardPassword ?? '',
            dashboardPort: config.global?.server?.dashboardPort ?? 3000,
            websocketPort: config.global?.server?.websocketPort ?? 3001,
            useRemoteWebSocket: config.global?.server?.useRemoteWebSocket ?? false,
            websocketHost: config.global?.server?.websocketHost ?? null
          },
          rateLimit: {
            ...config.global?.rateLimit,
            maxRequestWeight: config.global?.rateLimit?.maxRequestWeight ?? 2400,
            maxOrderCount: config.global?.rateLimit?.maxOrderCount ?? 1200,
            reservePercent: config.global?.rateLimit?.reservePercent ?? 30,
            enableBatching: config.global?.rateLimit?.enableBatching ?? true,
            queueTimeout: config.global?.rateLimit?.queueTimeout ?? 30000,
            parallelProcessing: config.global?.rateLimit?.parallelProcessing ?? false,
            maxConcurrentRequests: config.global?.rateLimit?.maxConcurrentRequests ?? 3
          }
        },
        // Ensure symbols exist
        symbols: config.symbols || {}
      };
      
      await updateConfig(updatedConfig);
    }

    completeStep('api-setup');
    nextStep();
  };

  const handleSymbolConfigNext = async (symbolConfigs: Array<{
    symbol: string;
    volumeThreshold: number;
    leverage: number;
    tpPercent: number;
    slPercent: number;
  }>, riskPercent: number) => {
    if (config) {
      const symbolsObject: Record<string, any> = {};
      
      // Calculate safe minimum trade sizes based on leverage
      // BTC min notional ~$100, ETH/others ~$5-10
      const getTradeSize = (symbol: string, leverage: number): number => {
        const isBTC = symbol === 'BTCUSDT';
        const minNotional = isBTC ? 100 : 5;
        // Add 50% buffer for price movements
        const safeMargin = (minNotional / leverage) * 1.5;
        // Round up to nearest dollar for BTC, nearest 0.5 for others
        return isBTC ? Math.ceil(safeMargin) : Math.ceil(safeMargin * 2) / 2;
      };
      
      symbolConfigs.forEach(sc => {
        const tradeSize = getTradeSize(sc.symbol, sc.leverage);
        
        symbolsObject[sc.symbol] = {
          // Required fields - tradeSize in USDT (margin)
          tradeSize: tradeSize,
          leverage: sc.leverage,
          tpPercent: sc.tpPercent,
          slPercent: sc.slPercent,
          
          // Volume thresholds
          volumeThresholdUSDT: sc.volumeThreshold,
          longVolumeThresholdUSDT: sc.volumeThreshold,
          shortVolumeThresholdUSDT: sc.volumeThreshold,
          
          // Default values for other required fields
          maxPositionMarginUSDT: 1000,
          priceOffsetBps: 10,
          usePostOnly: true,
          maxSlippageBps: 50,
          orderType: 'LIMIT' as const,
          vwapProtection: false,
          vwapTimeframe: '1m',
          vwapLookback: 100,
          useThreshold: false,
          thresholdTimeWindow: 60000,
          thresholdCooldown: 30000,
        };
      });

      const updatedConfig: Config = {
        ...config,
        symbols: symbolsObject as Record<string, SymbolConfig>,
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

  // Don't render anything while checking setup status
  if (isOnboarding === null) {
    return null;
  }

  // Don't render if not onboarding
  if (!isOnboarding) {
    return null;
  }

  return (
    <Dialog open={true} onOpenChange={() => {}}>
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