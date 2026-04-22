import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "BELL Short Scanner | MEXC先物ショート候補自動検出",
  description: "MEXC先物の全銘柄を自動スキャン。25指標スコアリングでショート候補をTOP20表示。完全無料。",
  openGraph: {
    title: "BELL Short Scanner",
    description: "MEXC先物の全銘柄を25指標でスコアリング。ショート候補を自動検出。完全無料。",
    url: "https://bell-crypto-terminal.vercel.app/short-scan",
    siteName: "BELL Short Scanner",
    images: [
      {
        url: "https://bell-crypto-terminal.vercel.app/og-short-scan.png",
        width: 1200,
        height: 630,
        alt: "BELL Short Scanner",
      },
    ],
    locale: "ja_JP",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BELL Short Scanner",
    description: "MEXC先物の全銘柄を25指標でスコアリング。ショート候補を自動検出。完全無料。",
    images: ["https://bell-crypto-terminal.vercel.app/og-short-scan.png"],
  },
};

export default function ShortScanLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
