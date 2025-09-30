import { useState, useEffect } from 'react';

export function useWebSocketUrl() {
  const [wsUrl, setWsUrl] = useState<string | null>(null);

  useEffect(() => {
    // Fetch configuration to get the WebSocket settings
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        // Fix: API returns config directly, not nested under config property
        const port = data.global?.server?.websocketPort || 8080;
        const useRemoteWebSocket = data.global?.server?.useRemoteWebSocket || false;
        const configHost = data.global?.server?.websocketHost;

        // Determine the host based on configuration
        let host = 'localhost'; // default

        // Check for environment variable override (handled by server config)
        const envHost = data.global?.server?.envWebSocketHost;
        
        if (envHost) {
          host = envHost;
        } else if (useRemoteWebSocket) {
          // If remote WebSocket is enabled
          if (configHost) {
            // Use the configured host if specified
            host = configHost;
          } else if (typeof window !== 'undefined') {
            // Auto-detect from browser location
            host = window.location.hostname;
          }
        } else if (typeof window !== 'undefined') {
          // Default to current hostname when useRemoteWebSocket is false but we're in browser
          host = window.location.hostname;
        }

        // Determine protocol based on current page
        let protocol = 'ws';
        if (typeof window !== 'undefined') {
          protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        }

        setWsUrl(`${protocol}://${host}:${port}`);
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
        
        setWsUrl(`${fallbackProtocol}://${fallbackHost}:8080`);
      });
  }, []);

  return wsUrl;
}