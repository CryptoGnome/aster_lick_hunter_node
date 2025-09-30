type WebSocketMessage = {
  type: string;
  data: any;
};

type MessageHandler = (message: WebSocketMessage) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private url: string;
  private isConnected = false;
  private connectionListeners: Set<(connected: boolean) => void> = new Set();
  private isIntentionalDisconnect = false;

  constructor(url?: string) {
    // Will be set dynamically based on config
    if (url) {
      this.url = url;
    } else if (typeof window !== 'undefined') {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const wsHost = window.location.hostname;
      // Use port 8080 as default, will be updated by WebSocketProvider
      this.url = `${wsProtocol}://${wsHost}:8080`;
      console.log('WebSocketService: Initialized with default URL from window location:', this.url);
    } else {
      // Don't set a default URL during SSR - it will be set by WebSocketProvider
      this.url = '';
    }
  }

  setUrl(url: string): void {
    if (this.url !== url) {
      console.log('WebSocketService: Setting URL from', this.url, 'to', url);
      this.url = url;
      // If connected, reconnect with new URL
      if (this.isConnected) {
        this.disconnect();
        this.reconnectAttempts = 0;
        this.connect().catch(error => {
          console.log('WebSocketService: Reconnection with new URL failed:', error.message);
        });
      }
    }
  }

  // Test if WebSocket server is reachable
  async testConnection(): Promise<boolean> {
    if (!this.url) {
      console.log('WebSocketService: Cannot test connection - URL not configured');
      return false;
    }

    return new Promise((resolve) => {
      const testWs = new WebSocket(this.url);
      const timeout = setTimeout(() => {
        testWs.close();
        resolve(false);
      }, 3000); // 3 second timeout

      testWs.onopen = () => {
        clearTimeout(timeout);
        testWs.close();
        resolve(true);
      };

      testWs.onerror = () => {
        clearTimeout(timeout);
        resolve(false);
      };
    });
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Don't attempt to connect if URL is not set
      if (!this.url) {
        console.log('WebSocketService: Cannot connect - URL not configured');
        reject(new Error('WebSocket URL not configured'));
        return;
      }

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      // If already connecting, wait for it to complete
      if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
        const checkConnection = () => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            resolve();
          } else if (this.ws?.readyState === WebSocket.CLOSED || this.ws?.readyState === WebSocket.CLOSING) {
            reject(new Error('WebSocket connection failed - connection closed during handshake'));
          } else {
            setTimeout(checkConnection, 50);
          }
        };
        checkConnection();
        return;
      }

      console.log('WebSocketService: Attempting to connect to', this.url);

      try {
        this.ws = new WebSocket(this.url);
      } catch (error) {
        console.log('WebSocketService: Failed to create WebSocket:', error);
        reject(new Error(`Failed to create WebSocket connection: ${error instanceof Error ? error.message : 'Unknown error'}`));
        return;
      }

      const cleanup = () => {
        if (this.ws) {
          this.ws.removeEventListener('open', onOpen);
          this.ws.removeEventListener('error', onError);
        }
      };

      const onOpen = () => {
        console.log('WebSocketService: Connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.notifyConnectionChange(true);
        
        // Setup ping interval for keep-alive
        this.pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000); // Ping every 30 seconds
        
        cleanup();
        resolve();
      };

      const onError = (event: Event) => {
        console.log('WebSocketService: Connection failed to', this.url);
        console.log('WebSocketService: Error event details:', {
          type: event.type,
          target: event.target instanceof WebSocket ? {
            readyState: event.target.readyState,
            url: event.target.url
          } : 'unknown'
        });
        cleanup();
        // Only reject if we're still in connecting state
        if (this.ws?.readyState === WebSocket.CONNECTING || this.ws?.readyState === WebSocket.CLOSED) {
          reject(new Error(`WebSocket connection failed to ${this.url} - Check if bot service is running on the correct port`));
        }
      };

      this.ws.addEventListener('open', onOpen);
      this.ws.addEventListener('error', onError);

      this.ws.addEventListener('message', (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);

          // Handle ping/pong for keep-alive (ignore silently)
          if (message.type === 'pong') {
            return;
          }

          // Handle shutdown message specially
          if (message.type === 'shutdown') {
            console.log('WebSocketService: Received shutdown message - bot service stopping');
            this.isIntentionalDisconnect = true;
          }

          this.handlers.forEach(handler => {
            try {
              handler(message);
            } catch (error) {
              console.error('WebSocketService: Handler error:', error);
            }
          });
        } catch (error) {
          console.error('WebSocketService: Message parse error:', error);
        }
      });

      this.ws.addEventListener('close', () => {
        console.log('WebSocketService: Connection closed' + (this.isIntentionalDisconnect ? ' (intentional)' : ''));
        this.isConnected = false;

        // Clear ping interval
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }

        // Only notify connection change if not intentional disconnect
        if (!this.isIntentionalDisconnect) {
          this.notifyConnectionChange(false);
          this.attemptReconnect();
        } else {
          // Reset flag for next connection
          this.isIntentionalDisconnect = false;
        }
      });
    });
  }

  disconnect(): void {
    console.log('WebSocketService: Disconnecting');

    // Mark for disconnection to prevent reconnection attempts
    this.reconnectAttempts = this.maxReconnectAttempts;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.ws) {
      const ws = this.ws;
      this.ws = null;

      // Only close if not already closed/closing
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        try {
          ws.close();
        } catch (error) {
          console.log('WebSocketService: Error closing WebSocket:', error);
        }
      }
    }

    this.isConnected = false;
    this.notifyConnectionChange(false);
  }

  addMessageHandler(handler: MessageHandler): () => void {
    this.handlers.add(handler);

    // Check if we should auto-connect (skip on excluded pages)
    if (typeof window !== 'undefined') {
      const pathname = window.location.pathname;
      const wsExcludedPaths = ['/errors', '/config', '/auth', '/wiki', '/login'];
      const shouldConnect = !wsExcludedPaths.some(path => pathname.startsWith(path));

      if (!shouldConnect) {
        console.log('WebSocketService: Skipping auto-connect on excluded page:', pathname);
        // Return cleanup function without connecting
        return () => {
          this.handlers.delete(handler);
        };
      }
    }

    // Auto-connect if not already connected or connecting, and URL is configured
    if (this.url && !this.isConnected && (!this.ws || this.ws.readyState === WebSocket.CLOSED)) {
      // Reset reconnect attempts when adding new handler
      this.reconnectAttempts = 0;
      // Add small delay to prevent race conditions during component mounting
      setTimeout(() => {
        if (this.url && !this.isConnected && (!this.ws || this.ws.readyState === WebSocket.CLOSED)) {
          this.connect().catch(_error => {
            console.log('WebSocketService: Auto-connect failed, will retry');
          });
        }
      }, 100);
    }

    // Return cleanup function
    return () => {
      this.handlers.delete(handler);

      // If no more handlers, disconnect
      if (this.handlers.size === 0) {
        this.disconnect();
      }
    };
  }

  addConnectionListener(listener: (connected: boolean) => void): () => void {
    // Check if we should skip on excluded pages
    if (typeof window !== 'undefined') {
      const pathname = window.location.pathname;
      const wsExcludedPaths = ['/errors', '/config', '/auth', '/wiki', '/login'];
      const shouldConnect = !wsExcludedPaths.some(path => pathname.startsWith(path));

      if (!shouldConnect) {
        console.log('WebSocketService: Skipping connection listener on excluded page:', pathname);
        // Return no-op cleanup function
        return () => {};
      }
    }

    this.connectionListeners.add(listener);

    // Immediately notify of current state
    listener(this.isConnected);

    // Return cleanup function
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  private notifyConnectionChange(connected: boolean): void {
    this.connectionListeners.forEach(listener => {
      try {
        listener(connected);
      } catch (error) {
        console.error('WebSocketService: Connection listener error:', error);
      }
    });
  }

  private attemptReconnect(): void {
    if (this.handlers.size === 0) {
      // No handlers left, don't reconnect
      return;
    }

    if (!this.url) {
      // No URL configured, don't reconnect
      console.log('WebSocketService: Cannot reconnect - URL not configured');
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('WebSocketService: Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000); // Max 30 seconds

    console.log(`WebSocketService: Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      this.connect().catch(error => {
        console.error('WebSocketService: Reconnection failed:', error);
      });
    }, delay);
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  isIntentionallyDisconnected(): boolean {
    return this.isIntentionalDisconnect;
  }
}

// Global instance
const websocketService = new WebSocketService();

export default websocketService;