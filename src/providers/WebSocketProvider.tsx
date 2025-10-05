'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import websocketService from '@/lib/services/websocketService';

interface WebSocketContextType {
  wsPort: number;
  wsHost: string;
  wsUrl: string;
}

const WebSocketContext = createContext<WebSocketContextType>({
  wsPort: 8080,
  wsHost: typeof window !== 'undefined' ? window.location.hostname : 'localhost',
  wsUrl: typeof window !== 'undefined' ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:8080` : 'ws://localhost:8080'
});

export const useWebSocketConfig = () => {
  const context = useContext(WebSocketContext);
  if (context === undefined) {
    throw new Error('useWebSocketConfig must be used within a WebSocketProvider');
  }
  return context;
};

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [wsPort, setWsPort] = useState(8080);
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

        setWsPort(port);

        console.log('WebSocketProvider: Config loaded', {
          port,
          useRemoteWebSocket,
          configHost,
          envHost
        });

        // Determine the host based on configuration with priority order
        let host = 'localhost'; // default

        // 1. Check for environment variable override first (highest priority)
        if (envHost) {
          host = envHost;
          console.log('WebSocketProvider: Using environment host override:', host);
        } else if (useRemoteWebSocket) {
          // 2. If remote WebSocket is enabled in config
          if (configHost) {
            // 3. Use the configured host if specified
            host = configHost;
            console.log('WebSocketProvider: Using configured remote host:', host);
          } else if (typeof window !== 'undefined') {
            // 4. Auto-detect from browser location
            host = window.location.hostname;
            console.log('WebSocketProvider: Auto-detected remote host from browser:', host);
          }
        } else if (typeof window !== 'undefined') {
          // 5. Default to current hostname when useRemoteWebSocket is false but we're in browser
          host = window.location.hostname;
          console.log('WebSocketProvider: Using current hostname (useRemoteWebSocket disabled):', host);
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
        console.log('WebSocketProvider: Configured WebSocket URL:', url);
        websocketService.setUrl(url);

        // Test the connection to provide helpful feedback
        websocketService.testConnection().then(isReachable => {
          if (!isReachable) {
            console.warn(`WebSocketProvider: Bot service appears to be unreachable at ${url}`);
            console.warn('WebSocketProvider: Make sure the bot service is running with: npm run dev:bot or npm run bot');
          } else {
            console.log('WebSocketProvider: Bot service is reachable at', url);
          }
        });
      })
      .catch(err => {
        console.error('Failed to load WebSocket config:', err);
        // Use smart defaults
        let fallbackHost = 'localhost';
        let fallbackProtocol = 'ws';
        
        if (typeof window !== 'undefined') {
          fallbackHost = window.location.hostname;
          fallbackProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        }
        
        setWsHost(fallbackHost);
        const fallbackUrl = `${fallbackProtocol}://${fallbackHost}:8080`;
        console.log('WebSocketProvider: Using fallback WebSocket URL:', fallbackUrl);
        websocketService.setUrl(fallbackUrl);

        // Test the fallback connection
        websocketService.testConnection().then(isReachable => {
          if (!isReachable) {
            console.warn(`WebSocketProvider: Bot service appears to be unreachable at ${fallbackUrl}`);
            console.warn('WebSocketProvider: Make sure the bot service is running with: npm run dev:bot or npm run bot');
          } else {
            console.log('WebSocketProvider: Bot service is reachable at', fallbackUrl);
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