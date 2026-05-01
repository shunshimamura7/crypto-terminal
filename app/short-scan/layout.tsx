import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "BELL Short Scanner | MEXC Futures ショートスキャナー",
  description: "ATH急落 × 出来高枯渇 × FR × OI × 取引所独占度を総合スコアリング。MEXCショート候補を自動検出。",
  openGraph: {
    title: "BELL Short Scanner",
    description: "MEXC Futuresのショート候補を自動検出するスキャナー",
    url: "https://bell-sig.vercel.app/short-scan",
    siteName: "BELL Crypto Terminal",
    images: [
      {
        url: "https://bell-sig.vercel.app/og-short-scan.png",
        width: 1200,
        height: 630,
        alt: "BELL Short Scanner",
      },
    ],
    locale: "ja_JP",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "BELL Short Scanner",
    description: "MEXC Futuresのショート候補を自動検出",
    images: ["https://bell-sig.vercel.app/og-short-scan.png"],
  },
};

export default function ShortScanLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
