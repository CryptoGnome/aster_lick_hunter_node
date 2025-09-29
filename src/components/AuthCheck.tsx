'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function AuthCheck() {
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Check if password is required
        const response = await fetch('/api/auth/check');

        // Check if response is JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          console.warn('Auth check returned non-JSON response, skipping auth check');
          return;
        }

        if (!response.ok) {
          console.warn('Auth check failed with status:', response.status);
          return;
        }

        const data = await response.json();

        // Set cookie to indicate if password is required
        if (data.passwordRequired) {
          document.cookie = 'password-required=true; path=/; max-age=86400'; // 24 hours

          // Check if we have a valid auth token
          const authToken = document.cookie
            .split('; ')
            .find(row => row.startsWith('auth-token='));

          if (!authToken) {
            // No auth token, redirect to login
            router.push('/login?redirect=' + encodeURIComponent(window.location.pathname));
          }
        } else {
          // No password required, clear the cookie
          document.cookie = 'password-required=false; path=/; max-age=86400';
        }
      } catch (error) {
        console.error('Failed to check auth status:', error);
      }
    };

    checkAuth();
  }, [router]);

  return null; // This component doesn't render anything
}