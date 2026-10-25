# 共有・同期サーバー（ローカル試験版）

起動：`node sync-server.mjs`（handball-stats内）。既定URLは http://127.0.0.1:4174/ 。アプリとAPIを同じサーバーから配信する。既存の4173静的サーバーとGitHub Pagesは共有APIを持たない。

PC内専用の既定設定。LANでの試験は利用者がネットワーク環境を確認してHOSTを指定する。iPadのPWA・Service Worker・永続ストレージには信頼できるHTTPSが必要であり、PCのHTTP LANアドレスだけでは本番用PWA環境にならない。公開HTTPS配置やPCのファイアウォール変更はこの実装で行っていない。

## 実装

- POST /api/rooms `{scope:'match'|'roster'|'inventory',payload}` → code/rev/expiresAt。
- GET /api/rooms/:code → 保存内容。
- PUT /api/rooms/:code `{payload}` + If-Match版番号 → CAS更新。409競合時はサーバー内容を維持。
- POST /api/rooms/:code/rotate `{}` + If-Match → 新コードへ変更し旧コードを無効化。
- DELETE /api/rooms/:code + If-Match → サーバーデータ削除。
- 暗号乱数による8文字コード。コードを持つ人は閲覧と編集の両方が可能。アカウント認証とは異なる。
- 最終書込から180日で失効。GETでは期限延長しない。
- application/json、Origin/Sec-Fetch-Site検査、IPごとの120リクエスト/分、5MB上限。
- `.local-data/rooms.json`へ一時ファイルからrenameして保存。非公開・Git除外。
- 静的配信はアプリ資産の固定許可リストだけ。サーバー、テスト、保存データは配信しない。

## クライアント

`mountSync(container,{state,save,toast})`はクリーンアップ関数を返す。state.sync.roomsとstate.sync.queueへ共有設定と未送信内容を保存する。

`startSync({state,save,toast,onRemote})`をアプリ初期化後に呼ぶ。5秒ごとに登録済み対象のローカル変更を検出し、キュー保存・CAS送信・他端末の版確認を直列に行う。端末側に未送信変更がなければ他端末の更新を自動取込する。ローカル変更がある場合はCAS送信を優先し、競合時は両方を保持する。返されたcleanupはタイマーとonlineイベントを解除する。バックアップ復元などでstateオブジェクト自体が替わる場合はcleanup後に再起動する。mountSync自体は画面操作のみで常駐タイマーを持たない。

他端末の変更は常駐同期で自動取得し、手動の「最新を取り込む」も利用できる。409時は未送信内容を保持し、利用者にバックアップ後の明示的な「端末の内容を優先」または「最新を取り込む」を選んでもらう。端末優先でも最新の版へCAS更新するため、その間に再競合すると再び保持する。「同期解除」はこの端末の接続と未送信キューを解除し、実際の試合等は残す。「サーバーから削除」は他端末のコード利用も停止する。

試合・名簿・備品は別スコープ。試合のpayloadは `{match,teams}` の形式で参照先名簿も同梱する。取り込み時は既存チーム・選手の表示名等を維持し、不足するIDだけを追加する。これは双方向の名簿全体共有とは異なり、名簿を継続共有する場合はrosterスコープを別途使用する。取り込み候補はcore.validateState検証後に適用する。

## 検証と未完了

Nodeのlocalhost統合テスト9件成功：CRUD・CAS・コード再発行・永続化ファイル・非公開パス・Origin・Content-Type・容量・頻度制限・TTL・オフライン保持・競合保持・対象限定取込。

Edge Chromiumの独立2コンテキストでも常駐送受信、オフラインキューのIndexedDB保存と再読込、競合保持、コード再発行と削除、非公開パス拒否を確認した。結果はtests/sync-browser-results.json。これはiPad画面サイズでのPCブラウザ検証である。iPad実機、HTTPS公開、複数実端末、悪意のある大量リクエスト、停電中のディスク破損、長期間保存の運用は未検証。5秒周期の自動同期は実装したが、iPad/複数実端末での自動反映・競合をまだ確認していない。完成・本番運用可能とは扱わない。



