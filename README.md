# Handball Studio

iPad優先の個人用ハンドボール記録・分析アプリ。SO-Q Statsの公式ガイド・95問FAQ・架空サンプル画面を調査し、独自のデザインとコードで開発した。2026-10-25時点の開発版。全機能同等・実機検証完了とは扱わない。

## iPadで開く

公開先：https://learning-apps-jp.github.io/handball-studio/

Safariで開き「共有 → ホーム画面に追加」。試合データは端末内に保存されます。GitHub Pages版はリアルタイム同期サーバーを含みません。

## PCで起動

このフォルダーで `node sync-server.mjs` を実行し、表示された `http://127.0.0.1:4174` を開く。外部ライブラリのインストール不要。同期を使わない静的プレビューは `node server.mjs`（4173）。Windowsでは「アプリを起動.cmd」でも起動できる。

初回は自チーム・相手チームが空の名簿で用意される。「チーム・選手」で登録し、「新しい試合」から始める。「保存・共有」で架空サンプル3試合を追加できる。サンプルは実在の個人情報を含まない。

## 実装

- IndexedDBへの保存、PWAとオフライン起動（HTTPSまたはlocalhost）、全データバックアップ・検証付き復元
- 両チーム並列／自チーム記録、時計、選手・GK、7m、シュート位置・コース、各種プレー、公式記録表示、訂正履歴
- 単試合・複数試合・大会・選手・GK・戦術分析、不完全データの率非表示、別名合算
- 前後半動画、複数同期点、時刻メモ・タグ・返信・いいね、場面連続再生、作戦添付
- SVG動的作戦盤、人数・隊形・全面半面、録画・補間・線・パス、作戦保存、端末動画生成
- 真正xlsx、名簿CSV、個人成績を絞った閲覧リンク、備品管理
- 任意のローカル同期サーバー：8文字コード、名簿／試合／備品、オフラインキュー、CAS競合検出、コード再発行、180日期限

## 検証

`node --test js/*.test.mjs tests/*.test.mjs`

ブラウザ試験は `tests/browser.cjs`、`tests/record-browser.cjs`、`tests/video-browser.cjs`（4173）、`tests/sync-browser.cjs`（4174）。このPCのbundled PlaywrightとEdgeを使用する。動画テストのYouTubeはモック、ローカル動画は実WebM。テストは架空データを使い、既存のユーザープロファイルへ接続しない。

配信用ファイル生成：`node build.mjs`。`dist/`のみが静的配信対象。同期サーバーは静的ホスティングでは動かない。

## ドキュメント

- [公式機能調査](docs/official-feature-audit.md)
- [実装・検証・残課題](docs/implementation-status.md)
- [iPadでの利用](docs/ipad-guide.md)
- [同期サーバー](docs/sync-server.md)

試合・名簿は通常端末内に保存され、共有を開始した対象だけ指定サーバーへ送信する。外部AI・アクセス解析・広告なし。動画を指定したときだけYouTube等へ通信する。共有コードを知る人は編集も可能。公開ホスティング先・HTTPS・iPad Safariの実機検証は未完了。
