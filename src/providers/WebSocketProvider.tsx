'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import websocketService from '@/lib/services/websocketService';
import logger, { setDebugMode } from '@/lib/utils/logger';

interface WebSocketContextType {
  wsPort: number;
  wsHost: string;
  wsUrl: string;
}

const WebSocketContext = createContext<WebSocketContextType>({
  wsPort: 0,
  wsHost: typeof window !== 'undefined' ? window.location.hostname : 'localhost',
  wsUrl: ''
});

export const useWebSocketConfig = () => {
  const context = useContext(WebSocketContext);
  if (context === undefined) {
    throw new Error('useWebSocketConfig must be used within a WebSocketProvider');
  }
  return context;
};

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [wsPort, setWsPort] = useState(0);
  const [wsHost, setWsHost] = useState('localhost');

  useEffect(() => {
    // Fetch configuration to get the WebSocket settings
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        // Fix: API returns config directly, not nested under config property
        const port = data.global?.server?.websocketPort || 8080;
        const useRemoteWebSocket = data.global?.server?.useRemoteWebSocket || false;
        const configHost = data.global?.server?.websocketHost;
        const envHost = data.global?.server?.envWebSocketHost;
        
        // Set debug mode from config
        const debugMode = data.global?.debugMode || false;
        setDebugMode(debugMode);

        setWsPort(port);

        logger.debug('WebSocketProvider: Config loaded', {
          port,
          useRemoteWebSocket,
          configHost,
          envHost,
          debugMode
        });

        // Determine the host based on configuration with priority order
        let host = 'localhost'; // default

        // 1. Check for environment variable override first (highest priority)
        if (envHost) {
          host = envHost;
          logger.debug('WebSocketProvider: Using environment host override:', host);
        } else if (useRemoteWebSocket) {
          // 2. If remote WebSocket is enabled in config
          if (configHost) {
            // 3. Use the configured host if specified
            host = configHost;
            logger.debug('WebSocketProvider: Using configured remote host:', host);
          } else if (typeof window !== 'undefined') {
            // 4. Auto-detect from browser location
            host = window.location.hostname;
            logger.debug('WebSocketProvider: Auto-detected remote host from browser:', host);
          }
        } else if (typeof window !== 'undefined') {
          // 5. Default to current hostname when useRemoteWebSocket is false but we're in browser
          host = window.location.hostname;
          logger.debug('WebSocketProvider: Using current hostname (useRemoteWebSocket disabled):', host);
        }

        // Set the host and port in state
        setWsHost(host);

        // Determine protocol based on current page and host
        let protocol = 'ws';
        if (typeof window !== 'undefined') {
          // Use secure WebSocket if page is HTTPS
          protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        }

        const url = `${protocol}://${host}:${port}`;
        logger.debug('WebSocketProvider: Configured WebSocket URL:', url);
        websocketService.setUrl(url);

        // Test the connection to provide helpful feedback
        websocketService.testConnection().then(isReachable => {
          if (!isReachable) {
            logger.warn(`WebSocketProvider: Bot service appears to be unreachable at ${url}`);
            logger.warn('WebSocketProvider: Make sure the bot service is running with: npm run dev:bot or npm run bot');
          } else {
            logger.debug('WebSocketProvider: Bot service is reachable at', url);
          }
        });
      })
      .catch(err => {
        logger.error('Failed to load WebSocket config:', err);
        // Use smart defaults
        let fallbackHost = 'localhost';
        let fallbackProtocol = 'ws';
        
        if (typeof window !== 'undefined') {
          fallbackHost = window.location.hostname;
          fallbackProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        }
        
        setWsHost(fallbackHost);
        const fallbackUrl = `${fallbackProtocol}://${fallbackHost}:8080`;
        logger.debug('WebSocketProvider: Using fallback WebSocket URL:', fallbackUrl);
        websocketService.setUrl(fallbackUrl);

        // Test the fallback connection
        websocketService.testConnection().then(isReachable => {
          if (!isReachable) {
            logger.warn(`WebSocketProvider: Bot service appears to be unreachable at ${fallbackUrl}`);
            logger.warn('WebSocketProvider: Make sure the bot service is running with: npm run dev:bot or npm run bot');
          } else {
            logger.debug('WebSocketProvider: Bot service is reachable at', fallbackUrl);
          }
        });
      });
  }, []);

  // Determine protocol for context URL
  const wsProtocol = typeof window !== 'undefined' && (window.location.protocol === 'https:' || wsHost !== window.location.hostname) ? 'wss' : 'ws';
  const wsUrl = `${wsProtocol}://${wsHost}:${wsPort}`;

  return (
    <WebSocketContext.Provider value={{ wsPort, wsHost, wsUrl }}>
      {children}
    </WebSocketContext.Provider>
  );
}