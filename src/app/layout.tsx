import type { Metadata, Viewport } from "next";
import InitColorSchemeScript from "@mui/material/InitColorSchemeScript";
import { plexMono, plexSans } from "@/theme/fonts";
import { ThemeRegistry } from "@/theme/ThemeRegistry";

export const metadata: Metadata = {
  title: "Sightline",
  description: "Invite-only NFL player-prop analysis.",
  icons: { icon: "/favicon.svg", apple: "/apple-touch-icon.png" },
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
    <html
      lang="en"
      suppressHydrationWarning
      className={`${plexSans.variable} ${plexMono.variable}`}
    >
      <body>
        {/*
          Applies the stored appearance before first paint. Without it a
          dark-mode reader sees a white flash on every load — unpleasant
          generally, and on a screen read at 7am on a Sunday, the kind of thing
          that quietly stops a tool being opened.
        */}
        <InitColorSchemeScript
          attribute="data-mui-color-scheme"
          defaultMode="system"
        />
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  );
}
