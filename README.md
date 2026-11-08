# 💍 結婚式の収支

二人で結婚式の収入（ご祝儀・援助など）と支出を共有できる、スマホ向けのWebアプリです。
iPhoneでもAndroidでも「ホーム画面に追加」するとアプリのように使えます。

- 収入・支出・未払い・収支の合計表示
- カテゴリ別・支払った人別の集計
- 「合言葉」で二人のデータをリアルタイム共有
- CSV書き出し（Excelなどで開けます）
- オフラインでも起動可能

---

## セットアップ手順

### ステップ1：Firebaseを準備する（約15分）

1. https://console.firebase.google.com をGoogleアカウントで開く
2. **「プロジェクトを作成」**（または「Firebaseプロジェクトを始める」）
   - 名前は何でもOK（例：`wedding-budget`）
   - Gemini や Google アナリティクスは **オフでOK**
3. プロジェクトの画面で **「</>（ウェブ）」アイコン** をクリックしてアプリを追加
   - ニックネームは何でもOK。「Firebase Hosting」のチェックは **不要**
   - 表示される `const firebaseConfig = { ... }` の中身をコピー
4. このフォルダの **`firebase-config.js`** を開き、`""` の部分にコピーした値を貼り付けて保存
5. 左メニュー **「構築」→「Authentication」→「始める」**
   - 「ログイン方法」タブで **「匿名」** を選んで **有効にする** → 保存
6. 左メニュー **「構築」→「Firestore Database」→「データベースを作成」**
   - ロケーション：**`asia-northeast1 (Tokyo)`**
   - **「本番環境モード」** を選んで作成
7. Firestoreの **「ルール」タブ** を開き、中身を全部消して **`firestore.rules`** の内容を貼り付け → **「公開」**

> `apiKey` はGitHubで公開されても問題ない値です（データは上記ルールで守られます）。
> 無料枠（Sparkプラン）で十分に動きます。クレジットカード登録は不要です。

### ステップ2：GitHubに置いて公開する（約10分）

1. https://github.com にログイン（アカウントがなければ作成）
2. 右上の **「＋」→「New repository」**
   - Repository name：`wedding-budget`
   - **Public** を選択（無料でGitHub Pagesを使うため）
   - 「Create repository」
3. 作成後の画面で **「uploading an existing file」** のリンクをクリック
4. このフォルダの中身（`index.html`、`app.js` など **全ファイル**）をドラッグ＆ドロップ → 「Commit changes」
5. リポジトリの **「Settings」→ 左メニュー「Pages」**
   - Source：**Deploy from a branch**
   - Branch：**main** / **/(root)** → 「Save」
6. 1〜2分待つと `https://<あなたのユーザー名>.github.io/wedding-budget/` で公開されます

> 合言葉を知らない人はデータを見られませんが、アプリ自体のURLは誰でも開けます。

### ステップ3：スマホで使う

1. iPhoneのSafariで上のURLを開く
2. 共有ボタン →「ホーム画面に追加」
3. アプリを開いて **「新しく始める」**
4. 「設定」→ 二人の名前を入力 →「リンクを送る」でパートナーにLINEなどで送る
5. パートナーはリンクを開いて「参加する」→ 同じくホーム画面に追加

---

## あとから修正したいとき

- GitHubでファイルを開き、鉛筆アイコンで編集 →「Commit changes」
- **`sw.js` の `VERSION` の数字を上げる**（例：`v1` → `v2`）と、スマホ側にも確実に反映されます
- 反映されないときは、アプリを一度完全に閉じてから開き直してください

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | 画面 |
| `style.css` | デザイン |
| `app.js` | 動き（集計・保存・共有） |
| `firebase-config.js` | Firebaseの接続設定（ここだけ書き換える） |
| `firestore.rules` | Firebaseに貼るセキュリティルール |
| `sw.js` / `manifest.webmanifest` / `icon*` | ホーム画面アプリ化・オフライン用 |
