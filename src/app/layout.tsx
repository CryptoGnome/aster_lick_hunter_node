import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/components/AuthProvider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import ConfigProvider from "@/components/ConfigProvider";
import ErrorNotificationButton from "@/components/ErrorNotificationButton";
import { WebSocketProvider } from "@/providers/WebSocketProvider";
import { WebSocketErrorModal } from "@/components/WebSocketErrorModal";
import { PersistentErrorBanner } from "@/components/PersistentErrorBanner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Aster Liquidation Hunter",
  description: "Advanced cryptocurrency futures trading bot",
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Aster Hunter",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            <ConfigProvider>
              <WebSocketProvider>
                <PersistentErrorBanner />
                {children}
                <Toaster />
                <ErrorNotificationButton />
                <WebSocketErrorModal />
              </WebSocketProvider>
            </ConfigProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}