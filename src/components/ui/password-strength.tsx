'use client';

import React from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PasswordStrengthProps {
  password: string;
  showRequirements?: boolean;
  className?: string;
}

export interface PasswordStrength {
  score: number; // 0-4
  label: 'Weak' | 'Fair' | 'Good' | 'Strong' | 'Very Strong';
  color: string;
  percentage: number;
}

export function calculatePasswordStrength(password: string): PasswordStrength {
  let score = 0;

  // Length checks
  if (password.length >= 4) score += 0.5;
  if (password.length >= 8) score += 0.5;
  if (password.length >= 12) score += 0.5;
  if (password.length >= 16) score += 0.5;

  // Character diversity
  if (/[a-z]/.test(password)) score += 0.5; // lowercase
  if (/[A-Z]/.test(password)) score += 0.5; // uppercase
  if (/[0-9]/.test(password)) score += 0.5; // numbers
  if (/[^A-Za-z0-9]/.test(password)) score += 0.5; // special chars

  // Cap at 4
  score = Math.min(score, 4);

  // Determine label and color
  let label: PasswordStrength['label'];
  let color: string;

  if (score < 1) {
    label = 'Weak';
    color = 'bg-red-500';
  } else if (score < 2) {
    label = 'Fair';
    color = 'bg-orange-500';
  } else if (score < 3) {
    label = 'Good';
    color = 'bg-yellow-500';
  } else if (score < 4) {
    label = 'Strong';
    color = 'bg-green-500';
  } else {
    label = 'Very Strong';
    color = 'bg-green-600';
  }

  return {
    score,
    label,
    color,
    percentage: (score / 4) * 100
  };
}

const PasswordStrengthIndicator: React.FC<PasswordStrengthProps> = ({
  password,
  showRequirements = true,
  className
}) => {
  const strength = calculatePasswordStrength(password);

  // Requirements check
  const requirements = [
    { met: password.length >= 4, text: 'At least 4 characters' },
    { met: password.length >= 8, text: 'At least 8 characters (recommended)' },
    { met: /[a-z]/.test(password) && /[A-Z]/.test(password), text: 'Upper and lowercase letters' },
    { met: /[0-9]/.test(password), text: 'At least one number' },
    { met: /[^A-Za-z0-9]/.test(password), text: 'At least one special character' },
  ];

  // Special case for "admin" default password
  const isDefaultAdmin = password === 'admin';

  return (
    <div className={cn('space-y-2', className)}>
      {password && (
        <>
          {/* Strength Bar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Password Strength
              </span>
              <span className={cn(
                'text-xs font-medium',
                isDefaultAdmin && 'text-orange-500'
              )}>
                {isDefaultAdmin ? 'Default Password' : strength.label}
              </span>
            </div>
            <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full transition-all duration-300',
                  isDefaultAdmin ? 'bg-orange-500' : strength.color
                )}
                style={{ width: `${isDefaultAdmin ? 25 : strength.percentage}%` }}
              />
            </div>
          </div>

          {/* Requirements List */}
          {showRequirements && (
            <div className="space-y-1">
              {isDefaultAdmin && (
                <div className="text-xs text-orange-500 mb-2">
                  ⚠️ Using default password. Please change it for better security.
                </div>
              )}
              {requirements.map((req, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 text-xs"
                >
                  {req.met ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <X className="h-3 w-3 text-muted-foreground" />
                  )}
                  <span className={cn(
                    req.met ? 'text-muted-foreground' : 'text-muted-foreground/60'
                  )}>
                    {req.text}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PasswordStrengthIndicator;