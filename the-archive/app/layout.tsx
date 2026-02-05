import type { Metadata } from "next";
import { Anton, JetBrains_Mono, Oswald } from "next/font/google";
import "./globals.css";
import Loader from "@/components/Loader";
import Navigation from "@/components/Navigation";
import { ToastProvider } from "@/components/Toast";
import { SyncProvider } from "@/components/SyncContext";
import { AuthProvider } from "@/components/AuthContext";
import AppContent from "@/components/AppContent";

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
      <body className={`${anton.variable} ${mono.variable} ${oswald.variable} antialiased selection:bg-acid selection:text-black`}>
        <div className="film-grain"></div>
        <SyncProvider>
          <AuthProvider>
            <ToastProvider>
              <AppContent>{children}</AppContent>
            </ToastProvider>
          </AuthProvider>
        </SyncProvider>
      </body>
    </html>
  );
}
