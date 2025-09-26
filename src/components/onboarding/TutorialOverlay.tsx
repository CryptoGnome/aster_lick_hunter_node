'use client';

import React, { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useOnboarding } from './OnboardingProvider';

interface TutorialStep {
  target: string;
  title: string;
  content: string;
  position: 'top' | 'bottom' | 'left' | 'right';
}

const tutorialSteps: TutorialStep[] = [
  {
    target: '[data-tutorial="sidebar-status"]',
    title: 'Bot Status',
    content: 'Monitor your bot\'s connection status and trading mode here. Green means active!',
    position: 'right',
  },
  {
    target: '[data-tutorial="positions-card"]',
    title: 'Active Positions',
    content: 'Track all your open positions, P&L, and automatic orders in real-time.',
    position: 'bottom',
  },
  {
    target: '[data-tutorial="liquidation-feed"]',
    title: 'Liquidation Feed',
    content: 'Watch incoming liquidations. The bot automatically analyzes and trades qualifying events.',
    position: 'top',
  },
  {
    target: '[data-tutorial="balance-card"]',
    title: 'Account Balance',
    content: 'Your current balance and available margin. Updates automatically as you trade.',
    position: 'bottom',
  },
  {
    target: '[data-tutorial="config-link"]',
    title: 'Configuration',
    content: 'Adjust trading parameters, symbols, and risk settings anytime from here.',
    position: 'right',
  },
];

export function TutorialOverlay() {
  const { showTutorial, setShowTutorial } = useOnboarding();
  const [currentStep, setCurrentStep] = useState(0);
  const [highlightedElement, setHighlightedElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (showTutorial && tutorialSteps[currentStep]) {
      const target = document.querySelector(tutorialSteps[currentStep].target) as HTMLElement;
      if (target) {
        setHighlightedElement(target);
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [showTutorial, currentStep]);

  if (!showTutorial) return null;

  const handleNext = () => {
    if (currentStep < tutorialSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleClose();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleClose = () => {
    setShowTutorial(false);
    setCurrentStep(0);
    setHighlightedElement(null);
  };

  const step = tutorialSteps[currentStep];

  const getTooltipPosition = () => {
    if (!highlightedElement) return {};

    const rect = highlightedElement.getBoundingClientRect();
    const tooltipWidth = 320;
    const tooltipHeight = 150;
    const offset = 20;

    const style: React.CSSProperties = {
      position: 'fixed',
      zIndex: 9999,
      width: tooltipWidth,
    };

    switch (step.position) {
      case 'top':
        style.left = rect.left + rect.width / 2 - tooltipWidth / 2;
        style.bottom = window.innerHeight - rect.top + offset;
        break;
      case 'bottom':
        style.left = rect.left + rect.width / 2 - tooltipWidth / 2;
        style.top = rect.bottom + offset;
        break;
      case 'left':
        style.right = window.innerWidth - rect.left + offset;
        style.top = rect.top + rect.height / 2 - tooltipHeight / 2;
        break;
      case 'right':
        style.left = rect.right + offset;
        style.top = rect.top + rect.height / 2 - tooltipHeight / 2;
        break;
    }

    // Ensure tooltip stays within viewport
    if (style.left && typeof style.left === 'number' && style.left < 10) style.left = 10;
    if (style.right && typeof style.right === 'number' && style.right < 10) style.right = 10;
    if (style.top && typeof style.top === 'number' && style.top < 10) style.top = 10;
    if (style.bottom && typeof style.bottom === 'number' && style.bottom < 10) style.bottom = 10;

    return style;
  };

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 z-[9998]"
        onClick={handleClose}
      />

      {/* Highlight */}
      {highlightedElement && (
        <div
          className="fixed border-2 border-primary rounded-lg z-[9998] pointer-events-none"
          style={{
            left: highlightedElement.getBoundingClientRect().left - 4,
            top: highlightedElement.getBoundingClientRect().top - 4,
            width: highlightedElement.getBoundingClientRect().width + 8,
            height: highlightedElement.getBoundingClientRect().height + 8,
          }}
        >
          <div className="absolute inset-0 bg-primary/10 animate-pulse rounded-lg" />
        </div>
      )}

      {/* Tooltip */}
      <Card className="p-4 shadow-xl" style={getTooltipPosition()}>
        <div className="space-y-3">
          <div className="flex items-start justify-between">
            <h3 className="font-semibold text-lg">{step.title}</h3>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              className="h-6 w-6"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">{step.content}</p>

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {currentStep + 1} of {tutorialSteps.length}
            </span>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrevious}
                disabled={currentStep === 0}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                onClick={handleNext}
              >
                {currentStep === tutorialSteps.length - 1 ? 'Finish' : 'Next'}
                {currentStep < tutorialSteps.length - 1 && (
                  <ChevronRight className="ml-1 h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}