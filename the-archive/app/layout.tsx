import type { Metadata } from "next";
import { Anton, JetBrains_Mono, Oswald, Bebas_Neue, Space_Mono } from "next/font/google";
import "./globals.css";
import Loader from "@/components/Loader";
import Navigation from "@/components/Navigation";
import { ToastProvider } from "@/components/Toast";
import { SyncProvider } from "@/components/SyncContext";
import { AuthProvider } from "@/components/AuthContext";
import AppContent from "@/components/AppContent";
import ErrorBoundary from "@/components/ErrorBoundary";

const anton = Anton({
  weight: "400",
  variable: "--font-anton",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
});

const bebas = Bebas_Neue({
  weight: "400",
  variable: "--font-bebas",
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
      <body className={`${anton.variable} ${mono.variable} ${oswald.variable} ${bebas.variable} ${space.variable} antialiased selection:bg-acid selection:text-black`}>
        <div className="film-grain"></div>
        <ErrorBoundary>
          <SyncProvider>
            <AuthProvider>
              <ToastProvider>
                <AppContent>{children}</AppContent>
              </ToastProvider>
            </AuthProvider>
          </SyncProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
