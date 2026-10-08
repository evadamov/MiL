import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "MiL — воркшоп", description: "Слайды ведущего и ходы команд" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
