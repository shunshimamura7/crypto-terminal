import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "BELL Lab | ショートシグナル検証ダッシュボード",
  description: "BELL Short Scannerの自動バックテスト結果をリアルタイム分析。戦略別勝率・エクイティカーブ・スコア帯別パフォーマンスを可視化。",
  openGraph: {
    title: "BELL Lab — Signal Performance",
    description: "ショートシグナルの検証実績をリアルタイム表示",
    url: "https://bell-sig.vercel.app/lab",
    siteName: "BELL Signal",
  },
};

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
