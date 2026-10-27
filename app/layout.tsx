import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { THEME_INIT_SCRIPT } from "@/lib/ui/theme";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin", "latin-ext"], variable: "--font-manrope" });

export const metadata: Metadata = {
  title: "Plugent",
  description: "AI agents that work from your Sebtember knowledge.",
  icons: { icon: "/logo-navy.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EDEDF3" },
    { media: "(prefers-color-scheme: dark)", color: "#09090F" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The theme script sets data-theme before React hydrates; that attribute is expected.
    <html lang="en" className={manrope.variable} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed string from lib/ui/theme.ts */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
