"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, ToasterProps } from "sonner"
import { useEffect } from "react"
import { gsap } from "gsap"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  useEffect(() => {
    // Set up GSAP animations for Sonner toasts
    const setupToastAnimations = () => {
      // Create a MutationObserver to watch for new toasts
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as HTMLElement;

              // Check if this is a toast element
              if (element.matches('[data-sonner-toast]') ||
                  element.querySelector('[data-sonner-toast]')) {

                const toastElement = element.matches('[data-sonner-toast]')
                  ? element
                  : element.querySelector('[data-sonner-toast]') as HTMLElement;

                if (toastElement && !toastElement.hasAttribute('data-animated')) {
                  toastElement.setAttribute('data-animated', 'true');

                  // Set initial state - slide in from right with fade
                  gsap.set(toastElement, {
                    opacity: 0,
                    x: 50,
                    scale: 0.95,
                    transformOrigin: "top right"
                  });

                  // Animate in with slide, fade and scale
                  gsap.to(toastElement, {
                    opacity: 1,
                    x: 0,
                    scale: 1,
                    duration: 0.35,
                    ease: "power2.out"
                  });
                }
              }
            }
          });

          // Handle removed toasts - no special animation needed
          // Sonner handles the positioning internally with the gap prop
        });
      });

      // Start observing the toaster container
      const toasterContainer = document.querySelector('[data-sonner-toaster]');
      if (toasterContainer) {
        observer.observe(toasterContainer, {
          childList: true,
          subtree: true
        });
      }

      return () => observer.disconnect();
    };

    // Set up animations after a short delay to ensure Sonner is mounted
    const timer = setTimeout(setupToastAnimations, 100);

    return () => {
      clearTimeout(timer);
    };
  }, []);

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      position="top-right"
      expand={true}
      richColors={true}
      closeButton={true}
      gap={16}
      visibleToasts={10}
      duration={5000}
      {...props}
    />
  )
}

export { Toaster }
