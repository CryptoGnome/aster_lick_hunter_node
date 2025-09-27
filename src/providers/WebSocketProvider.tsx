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

export const useWebSocketConfig = () => useContext(WebSocketContext);

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [wsPort, setWsPort] = useState(8080);

  useEffect(() => {
    // Fetch configuration to get the WebSocket port
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        const port = data.config?.global?.server?.websocketPort || 8080;
        setWsPort(port);

        // Determine WebSocket URL based on environment
        const isDocker = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.hostname;

        let url: string;
        if (isDocker) {
          // In Docker with Nginx, use the same host but with WebSocket path
          url = `${protocol}//${host}/ws`;
        } else {
          // Local development
          url = `ws://localhost:${port}`;
        }

        websocketService.setUrl(url);
      })
      .catch(err => {
        console.error('Failed to load WebSocket config:', err);
        // Use default based on environment
        const isDocker = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.hostname;

        let url: string;
        if (isDocker) {
          url = `${protocol}//${host}/ws`;
        } else {
          url = 'ws://localhost:8080';
        }

        websocketService.setUrl(url);
      });
  }, []);

  const wsUrl = `ws://localhost:${wsPort}`;

  return (
    <WebSocketContext.Provider value={{ wsPort, wsUrl }}>
      {children}
    </WebSocketContext.Provider>
  );
}