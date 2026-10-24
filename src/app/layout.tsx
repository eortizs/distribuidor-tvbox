import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { AppSplash } from "@/components/app-splash";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

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
  title: "Togu",
  description: "Admin dashboard for Togu",
  applicationName: "Distribuidor TVBox",
  appleWebApp: {
    capable: true,
    title: "TVBOX",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfb" },
    { media: "(prefers-color-scheme: dark)", color: "#171717" },
  ],
  viewportFit: "cover",
  interactiveWidget: "resizes-visual",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <TooltipProvider>
            <AppSplash />
            {children}
          </TooltipProvider>
          <Toaster
            offset={{ bottom: "var(--shell-bottom-nav-space)" }}
            mobileOffset={{ bottom: "var(--shell-bottom-nav-space)" }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
