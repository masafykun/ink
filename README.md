# 🌊 INK — 墨流し

> カーソルで暗い水面をかき混ぜ、色とりどりのインクを渦巻かせるフルスクリーン流体。

INK は WebGL2 上で動くフルスクリーンのリアクティブ GPU 流体です。カーソルを動かすと、暗い水のプールに色彩のリボンが渦を描いて広がります。ライブラリに頼らず、生の WebGL2 と GLSL だけで実装したリアルタイムの Navier–Stokes シミュレーションです（JavaScript は約 16 KB）。

![WebGL2](https://img.shields.io/badge/WebGL2-990000?style=flat-square&logo=webgl&logoColor=white)
![GLSL](https://img.shields.io/badge/GLSL_ES-5586A4?style=flat-square)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)

🔗 **[Live Demo](https://ink.1qaz.jp)**

---

## 📸 スクリーンショット

![hero](docs/01-hero.png)

![flow](docs/02-flow.png)

---

## 🎮 操作方法 / 見方

| 操作 | 動作 |
|---|---|
| 移動 / ドラッグ | 速度と色を注入。ホバーするとゆっくり循環する虹色で水をかき混ぜ、押しながらドラッグすると新しい色相になる |
| タッチ | 完全対応。複数の指による同時操作も可能 |
| 放置 | しばらく操作しないと、穏やかなアンビエントの揺らぎがプールを生き生きと保つ |

---

## ✨ 特徴

- **ライブラリ不使用** — 生の WebGL2 と GLSL のみ。重い処理を担う外部ライブラリは一切なし
- **Stable Fluids ソルバー** — Jos Stam / GPU Gems の手法を、浮動小数点フレームバッファ間で ping-pong するフラグメントシェーダのチェーンとして実装
- **vorticity confinement** — ソルバーが減衰させてしまう渦を計測して再注入し、流れの躍動感を保つ
- **発光する液体の質感** — display パスで勾配ベースのシェーディングと軽量なブルームを加え、平坦な流体を発光する液面として見せる

各フレームでは、速度場を advection（移流）し、Jacobi 法による pressure solve で divergence-free（非圧縮）にし、vorticity confinement で渦を戻します。別途、dye（染料）フィールドが流れに乗って色を運びます。

### ソルバーのパス構成

各シミュレーションステップは以下のシェーダプログラムを順に実行します（`src/shaders.js` 参照）。

| パス | 役割 |
|---|---|
| curl + vorticity | ソルバーが減衰させる渦を計測し再注入する |
| divergence | 速度場がどれだけ圧縮 / 膨張しているかを求める |
| pressure（×20 Jacobi） | その divergence を打ち消す圧力を解く |
| gradient subtract | 速度場を非圧縮にする |
| advection | 速度と dye を流れに沿って運ぶ |
| splat | ポインタ位置に速度と色の柔らかいガウシアンを加える |
| display | dye をエンボス調シェーディング + ソフトグローで合成する |

---

## 🛠️ 技術スタック

| カテゴリ | 技術 |
|---|---|
| 描画 | WebGL2 + GLSL ES（half-float レンダーターゲット、`EXT_color_buffer_float`） |
| シミュレーション | GPU 上の Navier–Stokes（stable fluids）ソルバー |
| ビルド | Vite（純粋な静的出力。バックエンド・依存ライブラリなし） |
| 表現 | display パスで勾配ベースのシェーディングと軽量ブルームを付加 |

### プロジェクト構成

```
index.html      # canvas + ブランド / ヒント / クレジットのオーバーレイ
src/
  main.js       # ソルバー起動、初回操作でヒントをフェードアウト
  fluid.js      # WebGL2 ソルバー本体：FBO、プログラム、step ループ、ポインタ入力
  shaders.js    # すべての GLSL パス
  style.css     # オーバーレイ / タイポグラフィ / ビネット
```

---

## 🚀 セットアップ

```bash
npm install
npm run dev      # http://localhost:5173 で起動
npm run build    # → dist/（静的ファイル。どこへでもデプロイ可能）
```

WebGL2 対応ブラウザが必要です（最近の Chrome / Safari / Firefox / Edge）。

---

## ライセンス

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

このプロジェクトは **MIT ライセンス** のもとで公開しています。

WebGL 実験シリーズの一作で、[VOYAGE](https://github.com/masafykun/voyage)、[ORB](https://github.com/masafykun/kodou-orb)、[FLUX](https://github.com/masafykun/yuragi-flux) と並ぶ作品です。

© 2026 masafykun (https://github.com/masafykun)
