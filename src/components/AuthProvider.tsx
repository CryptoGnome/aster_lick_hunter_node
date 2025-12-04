'use client';

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextType {
  status: AuthStatus;
  signOut: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  status: 'loading',
  signOut: async () => {},
  checkAuth: async () => {},
});

export const useAuth = () => useContext(AuthContext);

// Hook for backwards compatibility with code that used useSession
export const useSession = () => {
  const { status } = useAuth();
  return { status };
};

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const router = useRouter();
  const pathname = usePathname();

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/verify', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setStatus(data.authenticated ? 'authenticated' : 'unauthenticated');
      } else {
        setStatus('unauthenticated');
      }
    } catch {
      setStatus('unauthenticated');
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fetch('/api/auth/simple-logout', { method: 'POST', credentials: 'include' });
    } catch (error) {
      console.error('Logout error:', error);
    }
    setStatus('unauthenticated');
    router.push('/login');
  }, [router]);

  useEffect(() => {
    // Skip auth check on login page
    if (pathname === '/login') {
      setStatus('unauthenticated');
      return;
    }
    checkAuth();
  }, [pathname, checkAuth]);

  return (
    <AuthContext.Provider value={{ status, signOut, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
}
