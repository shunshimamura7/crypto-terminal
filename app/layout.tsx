import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import "./globals.css";

const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Crypto Terminal — リアルタイム暗号通貨情報",
  description:
    "CoinGecko APIを使ったリアルタイムの暗号通貨価格・チャート・マーケット情報",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`${notoSansJP.variable} h-full`} suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#ef4444" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||((!t)&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`}} />
        {children}
        <script dangerouslySetInnerHTML={{ __html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
          }
        `}} />
      </body>
    </html>
  );
}
