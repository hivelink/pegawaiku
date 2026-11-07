import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "PegawaiKu — Tim AI untuk Bisnis Anda", template: "%s · PegawaiKu" },
  description: "Rekrut pegawai AI untuk marketing, desain, video, HR, finance, dan builder — semua dari satu workspace.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="antialiased">{children}</body>
    </html>
  );
}
