import type { Metadata } from "next";
import type { Viewport } from "next";

export const viewport: Viewport = {
  themeColor: "#ef4444",
};

export const metadata: Metadata = {
  title: "BELL Short Hunter | MEXC先物ショート特化ツール",
  description: "FRアラート × ウォッチリスト × ショートスキャナーを一画面に集約。MEXC先物ショートトレード特化ツール。",
  openGraph: {
    title: "BELL Short Hunter",
    description: "FRアラート × ウォッチリスト × ショートスキャナー。MEXC先物ショートトレード特化ツール。",
    url: "https://bell-crypto-terminal.vercel.app/short-hunter",
    siteName: "BELL Short Hunter",
    locale: "ja_JP",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "BELL Short Hunter",
    description: "FRアラート × ウォッチリスト × ショートスキャナー。MEXC先物ショートトレード特化ツール。",
  },
  manifest: "/manifest-hunter.json",
};

export default function ShortHunterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
