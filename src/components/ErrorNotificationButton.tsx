'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bug } from 'lucide-react';

export default function ErrorNotificationButton() {
  const [hasNewErrors, setHasNewErrors] = useState(false);
  const [lastErrorCount, setLastErrorCount] = useState(0);
  const router = useRouter();

  useEffect(() => {
    const checkForNewErrors = async () => {
      try {
        const response = await fetch('/api/errors');
        if (response.ok) {
          const contentType = response.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            console.warn('Errors API returned non-JSON response');
            return;
          }
          const data = await response.json();
          const currentErrorCount = data.errors?.length || 0;

          if (currentErrorCount > lastErrorCount && lastErrorCount > 0) {
            setHasNewErrors(true);
          }

          setLastErrorCount(currentErrorCount);
        }
      } catch (error) {
        console.error('Failed to check for errors:', error);
      }
    };

    checkForNewErrors();
    const interval = setInterval(checkForNewErrors, 10000);

    return () => clearInterval(interval);
  }, [lastErrorCount]);

  const handleClick = () => {
    setHasNewErrors(false);
    router.push('/errors');
  };

  if (!hasNewErrors) {
    return null;
  }

  return (
    <button
      onClick={handleClick}
      className="fixed bottom-6 right-6 z-50 group"
      aria-label="New errors - click to view"
    >
      <div className="relative">
        <div className="absolute inset-0 bg-red-500 rounded-full animate-ping opacity-75"></div>
        <div className="relative flex items-center justify-center w-8 h-8 bg-red-500 rounded-full shadow-lg hover:bg-red-600 transition-colors">
          <Bug className="w-3 h-3 text-white" />
        </div>
        <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-600 rounded-full animate-pulse"></div>
      </div>
    </button>
  );
}