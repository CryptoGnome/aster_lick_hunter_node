import { useState, useEffect } from 'react';

export function useWebSocketUrl() {
  const [wsUrl, setWsUrl] = useState<string | null>(null);

  useEffect(() => {
    // Fetch configuration to get the WebSocket settings
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        const port = data.global?.server?.websocketPort;
        if (!port) {
          console.warn('WebSocket port not configured, skipping connection');
          return;
        }
        const useRemoteWebSocket = data.global?.server?.useRemoteWebSocket || false;
        const configHost = data.global?.server?.websocketHost;
        const websocketPath = data.global?.server?.websocketPath;

        // Determine the host based on configuration
        // Priority: window.location.hostname > configHost > envHost > localhost
        let host = 'localhost';
        const envHost = data.global?.server?.envWebSocketHost;
        
        if (typeof window !== 'undefined') {
          // When running in browser, always use the hostname the user is accessing from
          host = window.location.hostname;
        } else if (configHost) {
          // Explicit config override for special cases
          host = configHost;
        } else if (envHost) {
          // Environment variable fallback (for SSR/non-browser contexts)
          host = envHost;
        }

        // Determine protocol based on current page
        let protocol = 'ws';
        if (typeof window !== 'undefined') {
          protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        }

        // Check if websocketPath is configured (for reverse proxy setups)
        if (websocketPath && typeof window !== 'undefined') {
          setWsUrl(`${protocol}://${window.location.host}${websocketPath}`);
        } else {
          setWsUrl(`${protocol}://${host}:${port}`);
        }
      })
      .catch(err => {
        console.error('Failed to load WebSocket config:', err);
        setWsUrl(null);
      });
  }, []);

  return wsUrl;
}
