'use client';

import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Config } from '@/lib/types';
import { OnboardingProvider } from './onboarding/OnboardingProvider';
import { OnboardingModal } from './onboarding/OnboardingModal';
import { TutorialOverlay } from './onboarding/TutorialOverlay';

interface ConfigContextType {
  config: Config | null;
  loading: boolean;
  updateConfig: (newConfig: Config) => Promise<void>;
  reloadConfig: () => Promise<void>;
}

const ConfigContext = createContext<ConfigContextType>({
  config: null,
  loading: true,
  updateConfig: async () => {},
  reloadConfig: async () => {},
});

export const useConfig = () => useContext(ConfigContext);

export default function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  const isLoginPage = pathname === '/login';

  const createDefaultConfig = (): Config => ({
    api: { apiKey: '', secretKey: '' },
    symbols: {},
    global: {
      riskPercent: 90,
      paperMode: true,
      positionMode: "HEDGE",
      maxOpenPositions: 5,
      useThresholdSystem: false,
      server: {
        dashboardPassword: "",
        dashboardPort: 3000,
        websocketPort: 8080,
        useRemoteWebSocket: false,
        websocketHost: null
      },
      rateLimit: {
        maxRequestWeight: 2400,
        maxOrderCount: 1200,
        reservePercent: 30,
        enableBatching: true,
        queueTimeout: 30000,
        parallelProcessing: false,
        maxConcurrentRequests: 3
      }
    },
    version: "1.1.0"
  });

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/config');
      const data = await response.json() as Partial<Config>;

      if (response.ok) {
        const defaultConfig = createDefaultConfig();
        
        // Create merged config with proper type safety
        const mergedConfig: Config = {
          ...defaultConfig,
          ...data,
          api: {
            ...defaultConfig.api,
            ...(data.api || {})
          },
          global: {
            ...defaultConfig.global,
            ...(data.global || {}),
            server: {
              ...defaultConfig.global.server,
              ...(data.global?.server || {})
            },
            rateLimit: {
              ...defaultConfig.global.rateLimit,
              ...(data.global?.rateLimit || {})
            }
          },
          symbols: data.symbols || {}
        };
        
        setConfig(mergedConfig);
      } else if (response.status === 401) {
        // Not authenticated, use default config with ASTERUSDT symbol
        const defaultConfig = createDefaultConfig();
        defaultConfig.symbols = {
          ASTERUSDT: {
            longVolumeThresholdUSDT: 1000,
            shortVolumeThresholdUSDT: 2500,
            tradeSize: 0.69,
            shortTradeSize: 0.69,
            maxPositionMarginUSDT: 200,
            leverage: 10,
            tpPercent: 1,
            slPercent: 20,
            vwapProtection: true,
            vwapTimeframe: "5m",
            vwapLookback: 200,
            orderType: "LIMIT"
          }
        };
        setConfig(defaultConfig);
      } else {
        throw new Error(`Failed to load config: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to load config:', error);
      // Initialize with default config on error
      setConfig(createDefaultConfig());
    } finally {
      setLoading(false);
    }
  }, [setConfig, setLoading]);

  const updateConfig = async (newConfig: Config) => {
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newConfig),
      });

      if (response.ok) {
        setConfig(newConfig);
      } else {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Failed to save config: ${response.status} ${response.statusText}${errorData.error ? ` - ${errorData.error}` : ''}`);
      }
    } catch (error) {
      console.error('Failed to save config:', error);
      throw error;
    }
  };

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Listen for tutorial restart event
  useEffect(() => {
    const handleRestartTutorial = () => {
      const event = new CustomEvent('restart-onboarding');
      window.dispatchEvent(event);
    };

    window.addEventListener('restart-tutorial', handleRestartTutorial);
    return () => window.removeEventListener('restart-tutorial', handleRestartTutorial);
  }, []);

  return (
    <ConfigContext.Provider
      value={{
        config,
        loading,
        updateConfig,
        reloadConfig: loadConfig,
      }}
    >
      {isLoginPage ? (
        children
      ) : (
        <OnboardingProvider>
          {children}
          <OnboardingModal />
          <TutorialOverlay />
        </OnboardingProvider>
      )}
    </ConfigContext.Provider>
  );
}