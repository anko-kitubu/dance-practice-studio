# 振りコピスタジオ

YouTubeのお手本動画と自分のカメラ映像を同時表示し、振り付け練習をしやすくするWebアプリです。  
再生操作・レイアウト切替・ミラー表示・波形表示を1画面で扱えます。

## できること
- YouTubeのURL/ID読み込み（`Load`）
- 再生/停止（`Play` / `Pause`）
- シークバー操作
- 倍速変更（利用可能な再生速度）
- レイアウト切替（`Split` / `Reverse` / `Camera Float` / `Video Float` / `Video` / `Camera`）
- カメラ・動画のミラー切替（`Mirror Camera` / `Mirror Video`）
- 波形表示のON/OFF（`Wave ON/OFF`）
- 簡易モーショントラッカーのON/OFF（`Motion Tracker`）
- 履歴・プレイリストの利用
- 設定のローカル保存と復元

## 動作環境
- PCブラウザ（Chrome / Edge 推奨）
- カメラ権限が必要
- Node.js / npm

## セットアップ
```bash
npm install
```

## 開発
```bash
npm run dev
```

## ビルド
```bash
npm run build
```

## プレビュー
```bash
npm run preview
```

## 型チェック
```bash
npm run typecheck
```

## 使い方（クイックスタート）
1. YouTubeのURLまたは動画IDを入力して `Load` を押す
2. `Play` で再生開始
3. シークバーと倍速で練習区間を調整
4. レイアウトを `Split` / `Reverse` / `Float` / 単独表示に切り替える
5. 必要に応じて `Mirror Camera` / `Mirror Video` を切り替える
6. `Wave ON/OFF` と `Motion Tracker` を切り替えて表示を調整する

## 保存される設定
`localStorage` に以下を保存します（キー: `dance.practice.state`）。
- `videoId`
- `lastInput`
- `playbackRate`
- `layout`
- `mirrorCamera`
- `mirrorVideo`
- `floatRect`
- `waveformEnabled`
- `motionTrackerEnabled`
- `waveformMode`

履歴とプレイリストは別キーで保存されます。
- `dance.practice.history`
- `dance.practice.playlists`

## 既知の注意点
- YouTube埋め込み制限のある動画は再生できません
- 自動再生はブラウザ制限の影響を受けます
- カメラ未許可・未接続時はカメラ表示が利用できません

## 関連ドキュメント
- `仕様書.md`
- `優先順位.md`
- `dance練習ツール_要件定義（たたき台）.md`