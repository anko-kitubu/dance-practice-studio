# 振りコピスタジオ

YouTubeのお手本動画と自分のカメラ映像を同時表示し、振り付け練習をしやすくするWebアプリです。  
カメラと動画の比率を一定に保つ設計により、場面によって表示領域が小さくなる課題があります。そこで画面自体を無理に拡大するのではなく、余白を活用する方針として波形・オーディオスペクトラム表示を取り入れています。

## 今すぐ試す
- https://anko-kitubu.github.io/dance-practice-studio/

アクセス直後はカメラ権限が必要です。埋め込み不可のYouTube動画は再生できない場合があります。

## 現状の課題と方針
- カメラと動画の比率を一定に保つと、レイアウトによっては表示面積が小さくなります。
- 画面サイズそのものを大きくするより、余白を有効活用して情報量と体験を補う方針を採用しています。
- その具体策として、波形・オーディオスペクトラム表示を実装しています。

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

※ 波形の実装状況は「波形表示の現在地」を参照してください。

## 波形表示の現在地
- 現在の波形は、余白活用の有効性を確認するための簡易実装です。
- 現段階は表示価値の検証を優先しており、演出面は最小限です。
- 踊っていて楽しいと感じられる本格的な表現は、今後の改善対象です。

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
- 自動再生はブラウザ制限の影響を受けます
- ネットワーク状態によって、YouTube APIの初回読み込みが失敗する場合があります

## 関連ドキュメント
- `仕様書.md`
- `優先順位.md`
- `dance練習ツール_要件定義（たたき台）.md`

## ライセンス
このプロジェクトは `MIT License` のもとで公開しています。詳細は `LICENSE` を参照してください。