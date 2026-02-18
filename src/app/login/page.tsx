'use client';

import { useState, Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Lock } from 'lucide-react';

function LoginForm() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isPasswordConfigured, setIsPasswordConfigured] = useState(true);
  const router = useRouter();

  // Check if a custom password is configured (fetch from public endpoint)
  useEffect(() => {
    const checkPasswordStatus = async () => {
      try {
        const response = await fetch('/api/public-status');
        if (response.ok) {
          const data = await response.json();
          setIsPasswordConfigured(data.hasCustomPassword);
        }
      } catch {
        // If fetch fails, assume password is configured (safer default)
        setIsPasswordConfigured(true);
      }
    };
    checkPasswordStatus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Client-side validation
    if (!password || password.trim().length === 0) {
      setError('Password is required');
      setLoading(false);
      return;
    }

    // Allow "admin" as default password even if it's less than 4 characters
    if (password.length < 4 && !(password === 'admin' && !isPasswordConfigured)) {
      setError('Password must be at least 4 characters');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Invalid password');
        setLoading(false);
      } else {
        // Success - redirect to dashboard
        window.location.href = '/';
      }
    } catch (err) {
      console.error('[Login] Exception:', err);
      setError('Failed to login. Please try again.');
      setLoading(false);
    }
  };

  // Show loading while page initializes
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="flex items-center justify-center mb-2">
            <Lock className="h-8 w-8 text-primary" />
          </div>
          <CardTitle>Dashboard Login</CardTitle>
          <CardDescription>
            {isPasswordConfigured
              ? 'Enter your dashboard password to continue'
              : 'No password configured. Use "admin" as default password'
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder={isPasswordConfigured
                  ? "Enter dashboard password (min 4 characters)"
                  : "admin (default password)"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
              {password.length > 0 && password.length < 4 && !(password === 'admin' && !isPasswordConfigured) && (
                <p className="text-xs text-muted-foreground">
                  Password must be at least 4 characters
                </p>
              )}
            </div>
            {error && (
              <div className="text-sm text-destructive">{error}</div>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={loading || (password.length < 4 && !(password === 'admin' && !isPasswordConfigured))}
            >
              {loading ? 'Logging in...' : 'Login'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <div>Loading...</div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
