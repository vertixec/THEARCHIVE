import type { Metadata } from "next";
import { Anton, Oswald, Space_Mono } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";
import { SyncProvider } from "@/components/SyncContext";
import { AuthProvider } from "@/components/AuthContext";
import AppContent from "@/components/AppContent";
import ErrorBoundary from "@/components/ErrorBoundary";
import { GenerateProvider } from "@/components/GenerateContext";
import GeneratePanel from "@/components/GeneratePanel";

const anton = Anton({
  weight: "400",
  variable: "--font-anton",
  subsets: ["latin"],
});

const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
});

const space = Space_Mono({
  weight: ["400", "700"],
  variable: "--font-space",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "THE ARCHIVE | MAIN",
  description: "Central repository for prompts and AI creative references.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <head>
        <link rel="preconnect" href="https://cdn.midjourney.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://images.higgs.ai" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://higgsfield.ai" crossOrigin="anonymous" />
      </head>
      <body suppressHydrationWarning className={`${anton.variable} ${oswald.variable} ${space.variable} antialiased selection:bg-acid selection:text-black`}>
        <div className="film-grain"></div>
        <ErrorBoundary>
          <SyncProvider>
            <AuthProvider>
              <GenerateProvider>
                <ToastProvider>
                  <div className="relative flex min-h-screen flex-col">
                    <AppContent>{children}</AppContent>
                    <GeneratePanel />
                  </div>
                </ToastProvider>
              </GenerateProvider>
            </AuthProvider>
          </SyncProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
