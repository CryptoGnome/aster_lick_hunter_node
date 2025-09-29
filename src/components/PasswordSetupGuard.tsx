'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Shield } from 'lucide-react';
import { useConfig } from '@/components/ConfigProvider';

interface PasswordSetupGuardProps {
  children: React.ReactNode;
}

export function PasswordSetupGuard({ children }: PasswordSetupGuardProps) {
  const { config, updateConfig } = useConfig();
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true);
  const [showSetup, setShowSetup] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const checkPasswordSetup = async () => {
      try {
        // Check if password is already set
        const dashboardPassword = config?.global?.server?.dashboardPassword;

        if (dashboardPassword && dashboardPassword.length > 0) {
          // Password is set, user should be redirected to login
          router.push('/login');
          return;
        }

        // No password set, show setup form
        setShowSetup(true);
      } catch (error) {
        console.error('Failed to check password setup:', error);
        setError('Failed to check configuration');
      } finally {
        setIsChecking(false);
      }
    };

    checkPasswordSetup();
  }, [config, router]);

  const handlePasswordSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    if (password.length < 4) {
      setError('Password must be at least 4 characters');
      setLoading(false);
      return;
    }

    try {
      // Update config with new password
      await updateConfig({
        api: config?.api || { apiKey: '', secretKey: '' },
        symbols: config?.symbols || {},
        global: {
          riskPercent: config?.global?.riskPercent || 2,
          paperMode: config?.global?.paperMode ?? true,
          positionMode: config?.global?.positionMode || 'HEDGE',
          maxOpenPositions: config?.global?.maxOpenPositions || 10,
          server: {
            ...config?.global?.server,
            dashboardPassword: password
          }
        },
        version: config?.version || '1.1.0'
      });

      // Redirect to login page
      router.push('/login');
    } catch (error) {
      console.error('Failed to set password:', error);
      setError('Failed to set password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Show loading while checking
  if (isChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="space-y-4">
          <div className="h-8 w-64 bg-muted animate-pulse rounded" />
          <div className="h-4 w-32 bg-muted animate-pulse rounded" />
        </div>
      </div>
    );
  }

  // Show password setup form
  if (showSetup) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center justify-center mb-2">
              <Shield className="h-8 w-8 text-primary" />
            </div>
            <CardTitle>Setup Dashboard Password</CardTitle>
            <CardDescription>
              Set a password to secure your dashboard. This will be required to access the application.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordSetup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter a secure password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
              {error && (
                <div className="text-sm text-destructive">{error}</div>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Setting up...' : 'Setup Password'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // If password is set, render children (this shouldn't happen due to redirect)
  return <>{children}</>;
}
