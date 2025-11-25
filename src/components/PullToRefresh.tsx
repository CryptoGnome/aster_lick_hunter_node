'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
}

export function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const [isPulling, setIsPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startY = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const PULL_THRESHOLD = 80;
  const MAX_PULL = 120;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let touchStartY = 0;
    let scrollTop = 0;

    const handleTouchStart = (e: TouchEvent) => {
      // Check both container and window scroll position
      scrollTop = Math.max(container.scrollTop, window.scrollY, document.documentElement.scrollTop);
      touchStartY = e.touches[0].clientY;
      startY.current = touchStartY;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (isRefreshing) return;
      
      const currentY = e.touches[0].clientY;
      const diff = currentY - touchStartY;

      // Only activate pull-to-refresh if at the top of the scroll
      if (scrollTop <= 5 && diff > 0) { // Allow 5px threshold for edge cases
        e.preventDefault();
        setIsPulling(true);
        const distance = Math.min(diff, MAX_PULL);
        setPullDistance(distance);
      }
    };

    const handleTouchEnd = async () => {
      if (pullDistance >= PULL_THRESHOLD && !isRefreshing) {
        setIsRefreshing(true);
        try {
          await onRefresh();
        } finally {
          setTimeout(() => {
            setIsRefreshing(false);
            setIsPulling(false);
            setPullDistance(0);
          }, 500);
        }
      } else {
        setIsPulling(false);
        setPullDistance(0);
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [pullDistance, isRefreshing, onRefresh]);

  const progress = Math.min((pullDistance / PULL_THRESHOLD) * 100, 100);
  const rotation = (pullDistance / MAX_PULL) * 360;

  return (
    <div ref={containerRef} className="h-full overflow-y-auto relative">
      {/* Pull indicator */}
      {(isPulling || isRefreshing) && (
        <div
          className="absolute top-0 left-0 right-0 flex items-center justify-center transition-all duration-200 z-50"
          style={{
            height: `${Math.max(pullDistance, isRefreshing ? 60 : 0)}px`,
            opacity: pullDistance > 20 ? 1 : pullDistance / 20,
          }}
        >
          <div className="bg-background/95 backdrop-blur rounded-full p-2 shadow-lg border">
            <RefreshCw
              className={`h-5 w-5 text-primary ${isRefreshing ? 'animate-spin' : ''}`}
              style={{
                transform: isRefreshing ? undefined : `rotate(${rotation}deg)`,
              }}
            />
          </div>
          {pullDistance >= PULL_THRESHOLD && !isRefreshing && (
            <span className="ml-2 text-sm font-medium text-muted-foreground">Release to refresh</span>
          )}
        </div>
      )}

      {/* Progress indicator */}
      {isPulling && !isRefreshing && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-muted z-40">
          <div
            className="h-full bg-primary transition-all duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {children}
    </div>
  );
}
