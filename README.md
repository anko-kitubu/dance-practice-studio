# 振りコピスタジオ

## GitHub Pages
- GitHub Pages: https://anko-kitubu.github.io/dance-practice-studio/
- ブラウザでアクセスして利用できます（インストール不要）。

## 概要
振りコピスタジオは、YouTubeのお手本動画と自分のカメラ映像を同時表示し、振り付け練習をしやすくするWebアプリです。  
動画とカメラを同時に見ながら、再生区間の反復やレイアウト切替を行える構成になっています。

## 主な機能（安定機能）
- YouTube URL / 動画IDの読み込み
- 再生・停止、シーク、再生速度変更
- レイアウト切替（`Split` / `Reverse` / `Cam Float` / `Vid Float` / `Video` / `Camera`）
- カメラ・動画のミラー切替
- 履歴管理（再生動画・再生位置）
- プレイリスト管理（追加・並び替え・削除）
- 設定のローカル保存・復元

## 使い方（基本）
1. GitHub Pages を開き、カメラ権限を許可します。
2. YouTubeのURLまたは動画IDを入力して `Load` を押します。
3. `Play` で再生し、シークバーと再生速度で練習区間を調整します。
4. レイアウトとミラー設定を切り替え、見やすい表示で練習します。
5. 必要に応じて履歴・プレイリストを利用して動画を管理します。

## 試作機能（検証中）
- `Wave ON/OFF`
- `Motion Tracker`

これらは体験検証のための試作機能です。現時点では以下の前提があります。
- 表示品質・表現は暫定実装で、仕様変更や削除の可能性があります。
- 波形表示は `pseudo` モードの疑似表現であり、厳密な音声解析表示ではありません。
- モーショントラッカーはカメラフレーム差分ベースの簡易推定で、姿勢推定（Pose Estimation）ではありません。

## 動作環境
- エンドユーザー: PCブラウザ（Chrome / Edge 推奨）
- 必須: カメラ権限、インターネット接続
- 開発者向け: Node.js 20 / npm

## 技術スタック
- Vue 3
- TypeScript
- Vite
- YouTube IFrame Player API
- MediaDevices API（`getUserMedia`）
- Canvas（疑似波形・フレーム差分による動き量推定）
- `localStorage`（状態保存）
- GitHub Actions / GitHub Pages

## 保存されるデータ
ブラウザ `localStorage` に以下を保存します。
- `dance.practice.state`
- `dance.practice.history`
- `dance.practice.playlists`

## 注意点
- 埋め込み制限があるYouTube動画は再生できません。
- 自動再生はブラウザ制限の影響を受けます。
- カメラ権限が拒否された場合、カメラ映像は利用できません。
- 保存データはブラウザ `localStorage` に保持されるため、端末・ブラウザが変わると引き継がれません。
- GitHub Pages はワークフロー上、`比率一定UI` ブランチへの push でデプロイされます。

## ローカル開発（必要な場合のみ）
```bash
npm ci
npm run dev
```

## ライセンス
MIT License

## 作者
- GitHub: `anko-kitubu`
