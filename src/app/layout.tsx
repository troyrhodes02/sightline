import type { Metadata, Viewport } from "next";

/**
 * The bare root layout.
 *
 * Deliberately empty of providers: the Material UI theme, the font loading, and
 * the appearance-scheme script all land in SIG-31, which is the pitch's named
 * design-system deliverable. Nothing here should pre-empt that.
 */

export const metadata: Metadata = {
  title: "Sightline",
  description: "Invite-only NFL player-prop analysis.",
  icons: {
    icon: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
  // No acquisition surface exists, and none is planned.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
