'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import PasswordStrengthIndicator from '@/components/ui/password-strength';
import { generatePassword, copyToClipboard } from '@/lib/utils/password-generator';
import { Shield, Copy, RefreshCw, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface PasswordSetupProps {
  onComplete: (password: string) => void;
  onSkip: () => void;
}

export function PasswordSetup({ onComplete, onSkip }: PasswordSetupProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [showSkipWarning, setShowSkipWarning] = useState(false);

  const handleGeneratePassword = () => {
    const generated = generatePassword({
      length: 16,
      includeUppercase: true,
      includeLowercase: true,
      includeNumbers: true,
      includeSymbols: true,
      excludeSimilar: true,
      excludeAmbiguous: true
    });

    setPassword(generated);
    setConfirmPassword(generated);
    setError('');
  };

  const handleCopyPassword = async () => {
    try {
      await copyToClipboard(password);
      toast.success('Password copied to clipboard');
    } catch (_err) {
      toast.error('Failed to copy password');
    }
  };

  const handleSubmit = () => {
    setError('');

    // Validation
    if (password.length < 4) {
      setError('Password must be at least 4 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password === 'admin') {
      toast.warning('Using default password. Consider changing it later for better security.');
    }

    onComplete(password);
  };

  const handleSkip = () => {
    if (!showSkipWarning) {
      setShowSkipWarning(true);
      return;
    }
    onSkip();
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" />
          <CardTitle>Secure Your Dashboard</CardTitle>
        </div>
        <CardDescription>
          Set a strong password to protect your trading dashboard. This is especially important if you plan to access the dashboard remotely.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Password Input */}
        <div className="space-y-2">
          <Label htmlFor="password">Dashboard Password</Label>
          <div className="flex gap-2">
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
                setShowSkipWarning(false);
              }}
              placeholder="Enter a secure password"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleGeneratePassword}
              title="Generate strong password"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            {password && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleCopyPassword}
                title="Copy password"
              >
                <Copy className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Confirm Password */}
        <div className="space-y-2">
          <Label htmlFor="confirm-password">Confirm Password</Label>
          <Input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              setError('');
            }}
            placeholder="Confirm your password"
          />
        </div>

        {/* Password Strength Indicator */}
        {password && (
          <PasswordStrengthIndicator
            password={password}
            showRequirements={true}
          />
        )}

        {/* Error Message */}
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Skip Warning */}
        {showSkipWarning && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Are you sure?</strong> Without a password, your dashboard will use the default &quot;admin&quot; password, which is not secure.
              Click skip again to continue without setting a password.
            </AlertDescription>
          </Alert>
        )}

        {/* Why Security Matters */}
        <Alert>
          <Shield className="h-4 w-4" />
          <AlertDescription>
            <strong>Why set a strong password?</strong>
            <ul className="mt-2 space-y-1 text-sm">
              <li>• Protects your API keys and trading configuration</li>
              <li>• Prevents unauthorized access to your bot controls</li>
              <li>• Essential for remote access security</li>
              <li>• Safeguards your trading history and analytics</li>
            </ul>
          </AlertDescription>
        </Alert>

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          <Button
            variant="ghost"
            onClick={handleSkip}
          >
            {showSkipWarning ? 'Skip Anyway' : 'Skip'}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!password || !confirmPassword}
          >
            Set Password
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}