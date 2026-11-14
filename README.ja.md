<p align="center"><img src="docs/assets/hero.png" alt="DSH StoryDesk — A quieter space for bigger stories" width="100%" /></p>

<p align="center">
<a href="https://github.com/giuliano1101/DSH-StoryDesk/releases/tag/v0.9.4"><img alt="Release 0.9.4" src="https://img.shields.io/badge/release-0.9.4-147CE5?style=flat-square" /></a>
<a href="https://github.com/giuliano1101/DSH-StoryDesk/actions/workflows/ci.yml"><img alt="Continuous integration" src="https://github.com/giuliano1101/DSH-StoryDesk/actions/workflows/ci.yml/badge.svg" /></a>
<a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-30343B?style=flat-square" /></a>
<img alt="Harness compatibility" src="https://img.shields.io/badge/Harness-%E2%89%A50.2.1--rc.5%20%3C0.3.0-747A84?style=flat-square" />
</p>

<p align="center"><a href="README.md">简体中文</a> · <a href="README.en.md">English</a> · <strong>日本語</strong></p>

## 物語を育てる、静かなワークスペース

**DSH StoryDesk** は [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 向けの、小説・脚本制作ワークスペースです。複数作品の管理、登場人物と世界設定、章・エピソード・シーンの構成、本文、AI アシスタント、履歴の復元をまとめて扱えます。通常の執筆と保存に AI 接続は不要です。

### 主な機能

- 小説と脚本の入口を分離。複数プロジェクト、タスク、検索、アーカイブ、復元可能なゴミ箱。
- 採用済みの設定とアウトラインから参照可能なストーリーバイブルを生成。
- 必要なときだけ開く AI アシスタント。役割・性格・Markdown Skills を設定し、Harness に接続済みのモデルを利用。
- 選択した本文にコメントを付け、折りたたんで蓄積。まとめて依頼し、変更前の版を保持。
- 小説・脚本の診断：総合、テンポ、台詞、整合性、人物の動機、伏線回収、サスペンスと情報開示。
- JSON バックアップ、Word、印刷。小説は Markdown / TXT、脚本は Fountain にも対応。

診断は原稿を直接変更しません。根拠のある問題、任意の提案、確認が必要な点を区別します。参照できる本文量には上限があり、全作品を無制限に検査する機能ではありません。

### Harness にインストール

1. [v0.9.4 リリース](https://github.com/giuliano1101/DSH-StoryDesk/releases/tag/v0.9.4) から **`dsh-screenwriter-desk-0.9.4.tgz`** をダウンロードします。Source code はインストール用パッケージではありません。
2. Harness のプラグイン追加画面でローカルの `.tgz` / パスを指定します。
3. 作業を保存し、Harness を完全終了（macOS：⌘Q）して再起動します。サイドバーの **创作工作台** を開きます。

`dsh` CLI が利用できる場合は、使用中の profile を指定します。`desktop` は例です。

```sh
dsh plugin --profile desktop add ./dsh-screenwriter-desk-0.9.4.tgz
```

以下の公開 URL を Harness のプラグイン追加欄に指定する方法も利用できます。

```text
https://github.com/giuliano1101/DSH-StoryDesk/releases/download/v0.9.4/dsh-screenwriter-desk-0.9.4.tgz
```

リポジトリは公開されています。インストールパッケージのダウンロードに GitHub へのログインは不要です。互換性の宣言：Harness `>=0.2.1-rc.5 <0.3.0`、Node `>=20`。チェックサムや移行は [インストールガイド（中文 / English）](docs/installation.md) を参照してください。

### 言語・プライバシー

**アプリの UI は現在、主に簡体字中国語です。** 日本語版は導入文書であり、UI の完全翻訳ではありません。多言語化への貢献を歓迎します。AI を実行すると、選択範囲と必要な文脈が設定済みのモデル提供者へ送信されます。作品やモデルの認証情報はインストールパッケージに含まれません。作品の移行は JSON のエクスポート / インポートで行います。

[貢献](CONTRIBUTING.md) · [サポート](SUPPORT.md) · [ロードマップ](docs/roadmap.md) · [安全とプライバシー](SECURITY.md)

### ライセンス

[MIT](LICENSE)。既存の著作権表記を保持します。[出典・依存ライセンス](THIRD_PARTY_NOTICES.md) もご確認ください。DeepSeek とは独立したコミュニティプロジェクトであり、公式製品ではありません。
