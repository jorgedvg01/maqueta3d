import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Plasencia · Maqueta viva",
  description:
    "Explora el casco histórico de Plasencia como una maqueta 3D interactiva.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
