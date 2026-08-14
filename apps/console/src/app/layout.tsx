import type { ReactNode } from "react";

export const metadata = {
  title: "Trackify · Console",
  description: "Operator console — later tickets fill this in.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
