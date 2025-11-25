import logger from '@/lib/utils/logger';

// WebSocket Service with optimized message handling
// Last updated: 2025-11-24 - Added message queue and batch processing

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
  private messageQueue: WebSocketMessage[] = [];
  private processingMessages = false;

  constructor(url?: string) {
    // Will be set dynamically based on config by WebSocketProvider
    if (url) {
      this.url = url;
    } else {
      // Don't set a default URL - it will be set by WebSocketProvider with config port
      this.url = '';
      if (typeof window !== 'undefined') {
        logger.debug('WebSocketService: Initialized without URL, waiting for WebSocketProvider to set it');
      }
    }
  }

  setUrl(url: string): void {
    if (this.url !== url) {
      logger.debug('WebSocketService: Setting URL from', this.url, 'to', url);
      this.url = url;
      // If connected, reconnect with new URL
      if (this.isConnected) {
        this.disconnect();
        this.reconnectAttempts = 0;
        this.connect().catch(error => {
          logger.debug('WebSocketService: Reconnection with new URL failed:', error.message);
        });
      }
    }
  }

  // Test if WebSocket server is reachable
  async testConnection(): Promise<boolean> {
    if (!this.url) {
      logger.debug('WebSocketService: Cannot test connection - URL not configured');
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
        logger.debug('WebSocketService: Cannot connect - URL not configured');
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

      logger.debug('WebSocketService: Attempting to connect to', this.url);

      try {
        this.ws = new WebSocket(this.url);
      } catch (error) {
        logger.debug('WebSocketService: Failed to create WebSocket:', error);
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
        logger.debug('WebSocketService: Connected');
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
        logger.debug('WebSocketService: Connection failed to', this.url);
        logger.debug('WebSocketService: Error event details:', {
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
            logger.debug('WebSocketService: Received shutdown message - bot service stopping');
            this.isIntentionalDisconnect = true;
          }

          // Queue message for batch processing to avoid blocking
          this.messageQueue.push(message);
          this.scheduleMessageProcessing();
        } catch (error) {
          logger.error('WebSocketService: Message parse error:', error);
        }
      });

      this.ws.addEventListener('close', () => {
        logger.debug('WebSocketService: Connection closed' + (this.isIntentionalDisconnect ? ' (intentional)' : ''));
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

  private scheduleMessageProcessing(): void {
    if (this.processingMessages) return;
    
    this.processingMessages = true;
    
    // Use requestAnimationFrame for better performance
    // Falls back to setTimeout if not available
    const processFrame = () => {
      const messages = this.messageQueue.splice(0, 10); // Process up to 10 messages per frame
      
      messages.forEach(message => {
        this.broadcastMessage(message);
      });
      
      if (this.messageQueue.length > 0) {
        // More messages to process
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(processFrame);
        } else {
          setTimeout(processFrame, 0);
        }
      } else {
        this.processingMessages = false;
      }
    };
    
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(processFrame);
    } else {
      setTimeout(processFrame, 0);
    }
  }

  private broadcastMessage(message: WebSocketMessage): void {
    // Broadcast to all handlers
    // Wrap in try-catch to prevent one handler from breaking others
    this.handlers.forEach(handler => {
      try {
        handler(message);
      } catch (error) {
        logger.error('WebSocketService: Handler error:', error);
      }
    });
  }

  disconnect(): void {
    logger.debug('WebSocketService: Disconnecting');

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
          logger.debug('WebSocketService: Error closing WebSocket:', error);
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
        logger.debug('WebSocketService: Skipping auto-connect on excluded page:', pathname);
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
            logger.debug('WebSocketService: Auto-connect failed, will retry');
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
        logger.debug('WebSocketService: Skipping connection listener on excluded page:', pathname);
        // Return no-op cleanup function
        return () => {};
      }
    }

    this.connectionListeners.add(listener);

    // Delay initial notification to avoid false positives on first load
    // Give the WebSocket time to establish connection (especially important for remote connections)
    setTimeout(() => {
      // Only notify if listener is still registered
      if (this.connectionListeners.has(listener)) {
        listener(this.isConnected);
      }
    }, 1000); // Wait 1 second before first notification

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
        logger.error('WebSocketService: Connection listener error:', error);
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
      logger.debug('WebSocketService: Cannot reconnect - URL not configured');
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.debug('WebSocketService: Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000); // Max 30 seconds

    console.log(`WebSocketService: Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      this.connect().catch(error => {
        logger.error('WebSocketService: Reconnection failed:', error);
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