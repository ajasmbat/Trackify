import type { ReactNode } from "react";

export const metadata = {
  title: "Trackify · Storefront",
  description: "T2 fills in the real storefront pages.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
