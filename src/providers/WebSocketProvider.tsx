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

export const useWebSocketConfig = () => useContext(WebSocketContext);

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [wsPort, setWsPort] = useState(8080);
  const [wsHost, setWsHost] = useState('localhost');

  useEffect(() => {
    // Fetch configuration to get the WebSocket settings
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        const port = data.config?.global?.server?.websocketPort || 8080;
        const useRemoteWebSocket = data.config?.global?.server?.useRemoteWebSocket || false;
        const configHost = data.config?.global?.server?.websocketHost;

        setWsPort(port);

        // Determine the host based on configuration with priority order
        let host = 'localhost'; // default

        // 1. Check for environment variable override first (highest priority)
        // Note: NEXT_PUBLIC_ env vars are available in browser, but we use config for flexibility
        const envHost = data.config?.global?.server?.envWebSocketHost;
        
        if (envHost) {
          host = envHost;
        } else if (useRemoteWebSocket) {
          // 2. If remote WebSocket is enabled in config
          if (configHost) {
            // 3. Use the configured host if specified
            host = configHost;
          } else if (typeof window !== 'undefined') {
            // 4. Auto-detect from browser location
            host = window.location.hostname;
          }
        }

        setWsHost(host);
        
        // Determine protocol based on current page and host
        let protocol = 'ws';
        if (typeof window !== 'undefined') {
          // Use secure WebSocket if page is HTTPS or if connecting to a different host
          protocol = window.location.protocol === 'https:' || host !== window.location.hostname ? 'wss' : 'ws';
        }
        
        const url = `${protocol}://${host}:${port}`;
        console.log('WebSocketProvider: Configured WebSocket URL:', url);
        websocketService.setUrl(url);
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