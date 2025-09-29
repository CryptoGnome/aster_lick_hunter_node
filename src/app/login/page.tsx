'use client';

import { useState, Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn, useSession } from 'next-auth/react';
import { useConfig } from '@/components/ConfigProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Lock } from 'lucide-react';

function LoginForm() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get('callbackUrl') || '/';
  const { data: _session, status } = useSession();
  const { config } = useConfig();

  // Check if password is configured
  const isPasswordConfigured = config?.global?.server?.dashboardPassword &&
    config.global.server.dashboardPassword.trim().length > 0;

  // Redirect if already authenticated
  useEffect(() => {
    if (status === 'authenticated') {
      router.push(redirectUrl);
    }
  }, [status, router, redirectUrl]);

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
      const result = await signIn('credentials', {
        password,
        redirect: false,
      });

      if (result?.error) {
        setError('Invalid password');
      } else if (result?.ok) {
        // Redirect to the intended page
        router.push(redirectUrl);
      }
    } catch (_err) {
      setError('Failed to login. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Show loading while checking session
  if (status === 'loading') {
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
                minLength={4}
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
