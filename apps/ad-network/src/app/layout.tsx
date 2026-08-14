import type { ReactNode } from "react";

export const metadata = {
  title: "Trackify · Ad Network",
  description: "T3 fills in the fake ad network pages.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
