import type { ReactNode } from "react";

export const metadata = {
  title: "TIRYAQ Backend",
  description: "API backend for TIRYAQ",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
