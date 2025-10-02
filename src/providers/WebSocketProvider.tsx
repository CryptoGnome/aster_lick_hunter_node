'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import websocketService from '@/lib/services/websocketService';

interface WebSocketContextType {
  wsPort: number;
  wsUrl: string;
}

const WebSocketContext = createContext<WebSocketContextType>({
  wsPort: 8080,
  wsUrl: 'ws://localhost:8080'
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
        const port = data.config?.global?.server?.websocketPort || 8080;
        const useRemoteWebSocket = data.config?.global?.server?.useRemoteWebSocket || false;
        const configHost = data.config?.global?.server?.websocketHost;
        let host = 'localhost';

        // Check for environment variable override first
        if (process.env.NEXT_PUBLIC_WS_HOST) {
          host = process.env.NEXT_PUBLIC_WS_HOST;
        } else if (useRemoteWebSocket) {
          // If remote WebSocket is enabled
          if (configHost) {
            // Use the configured host if specified
            host = configHost;
          } else if (typeof window !== 'undefined') {
            // Auto-detect from browser location
            host = window.location.hostname;
          }
        }
        
        // Set the host and port in state
        setWsHost(host);
        setWsPort(port);
        
        // Determine the WebSocket protocol based on the current protocol
        const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${host}:${port}`;
        websocketService.setUrl(url);
      })
      .catch(err => {
        console.error('Failed to load WebSocket config:', err);
        // Use default
        websocketService.setUrl('ws://localhost:8080');
      });
  }, []);

  return (
    <WebSocketContext.Provider value={{ wsPort, wsUrl: `ws://${wsHost}:${wsPort}` }}>
      {children}
    </WebSocketContext.Provider>
  );
}