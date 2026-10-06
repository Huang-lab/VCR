import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VCR - variant cancer risk",
  description:
    "VCR by the Huang Lab at Mount Sinai (labs.icahn.mssm.edu/kuanhuanglab): look up a variant and see its penetrance against disease base rates, alongside ClinVar classifications.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
