import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  JetBrains_Mono,
  Public_Sans,
} from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-bricolage",
  display: "swap",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-public-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Theseus — Rewrite every plank. Prove nothing changed.",
  description:
    "Open-source CLI that treats your legacy web app as the answer key. Kane CLI verifies old vs. new in real Chrome and drives your coding agent until zero behavioral drift.",
  openGraph: {
    title: "Theseus — Rewrite every plank. Prove nothing changed.",
    description:
      "Treat your legacy web app as the answer key. Real-browser verification via Kane CLI + closed-loop agent convergence + SHA-256 signed equivalence certificate.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${publicSans.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-screen bg-[#0B0F19] text-[#F1F5F9] antialiased">
        {children}
      </body>
    </html>
  );
}
