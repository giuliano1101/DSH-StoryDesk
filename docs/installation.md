# 安装 / Installation

[中文首页](../README.md) · [English](../README.en.md) · [日本語](../README.ja.md)

## 推荐：安装已构建的包 / Recommended: prebuilt package

1. 在 [v0.9.4 发布页](https://github.com/giuliano1101/DSH-StoryDesk/releases/tag/v0.9.4) 下载 `dsh-screenwriter-desk-0.9.4.tgz` 和 `SHA256SUMS.txt`。无需编译，也无需解压。
2. 在 Harness 插件安装入口填写下载文件的本地路径，或使用版本提供的文件选择功能。若安装对话框接受安装来源字符串，可填写下面的公开下载 URL。
3. 安装完成后保存工作，完整退出并重新打开 Harness。侧栏进入「创作工作台」，选择小说或剧本。助手模型读取该机 Harness 的实际模型连接。

Download the `.tgz` asset, not **Source code**. Install through Harness's plugin installer using the local path or supported file picker. Save, fully quit and reopen Harness. Open **创作工作台** in the sidebar. Connect your models in Harness on this machine.

```text
https://github.com/giuliano1101/DSH-StoryDesk/releases/download/v0.9.4/dsh-screenwriter-desk-0.9.4.tgz
```

**私有期间 / While private:** the URL is not anonymous. Use your authorized browser account to download first, or use `gh release download v0.9.4 --repo giuliano1101/DSH-StoryDesk --pattern '*.tgz'` with an authenticated GitHub CLI. Do not paste access tokens into installation URLs. Public direct URL installation becomes available when the repository is deliberately made public.

## CLI 与 profile / CLI and profiles

Use your already-installed `dsh` CLI and the profile your actual Harness session uses. `desktop` and `web` are examples, not interchangeable defaults:

```sh
# Desktop example / 桌面示例
dsh plugin --profile desktop add ./dsh-screenwriter-desk-0.9.4.tgz

# Web example / 网页配置示例
dsh plugin --profile web add ./dsh-screenwriter-desk-0.9.4.tgz
```

After public launch, the release URL above can replace the local path. No npm package has been published for StoryDesk; `npm install dsh-screenwriter-desk` is not the supported install route. Git source installation is not advertised: the repository does not track compiled `dist/` and does not run a prepare build at install time. Use the prebuilt Release tarball.

官方依据 / Official references, checked 2026-11-14: [Package and install a plugin](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md), [Plugin manager](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-plugin-manager/README.md). Harness is evolving; installer wording may differ across versions.

## 兼容性 / Compatibility

| Component | Declared requirement / 声明要求 |
| --- | --- |
| Harness / `dsh` | `>=0.2.1-rc.5 <0.3.0` |
| Node | `>=20` |
| Real desktop acceptance | macOS + Harness, v0.9.4; see [evidence summary](verification/0.9.4.md) |
| Windows / Linux | Source can be developed with Node; native Harness installation has not received the same live desktop acceptance |

A declared range is not proof of every environment. Do not bypass Harness compatibility or build-script checks. Update the host or report the exact failure. Desktop restart should happen only after saving current work.

## 校验 / Verify

Put the archive and checksum file in the same directory:

```sh
# macOS
shasum -a 256 -c SHA256SUMS.txt
# Linux
sha256sum -c SHA256SUMS.txt
```

Original 0.9.4 SHA-256: `91ed88bcb668123e8fc4fecf845d47a2f12d59746ba0fdeb9bdd3cd90b26dbdb`.

## 升级、迁移与恢复 / Upgrade, migration and recovery

Export complete project JSON backups before upgrading or moving machines. The plugin archive contains no manuscripts, history or credentials. Import each project backup on the destination machine; configure that machine's Harness providers separately. Local plugin data lives under `$DSH_HOME/screenwriter-desk/`, normally `~/.dsh/screenwriter-desk/`. Do not copy an entire host profile over another machine's settings.

This project has no automatic cloud sync. Uninstalling / reinstalling code is not a substitute for backup. Before a downgrade, keep a separate copy of your current data; an older release may not understand newer fields.

## 常见问题 / Troubleshooting

- **404 on download:** private repository or missing access; log into the authorized account and download locally.
- **Old API / restart message:** fully quit the app, rather than just closing its window, then reopen after saving.
- **No AI model:** configure a provider in Harness, refresh the assistant catalog and select an available model. Ordinary editing remains usable.
- **Installed but no entry:** check the active profile and whether the installed bundle is enabled.
- **Install failure:** record host version, profile and redacted installer output in a [bug report](https://github.com/giuliano1101/DSH-StoryDesk/issues/new/choose). Never paste secrets or a private manuscript.

See [Support](../SUPPORT.md) and [Security](../SECURITY.md).
