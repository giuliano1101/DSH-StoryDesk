# Security and privacy / 安全与隐私

## Reporting / 报告

Please do **not** put vulnerabilities, credentials or private manuscripts in public issues. Use [GitHub private vulnerability reporting](https://github.com/giuliano1101/DSH-StoryDesk/security/advisories/new), also available from the repository Security tab’s **Report a vulnerability** button. Include affected version, minimal synthetic reproduction, impact and relevant redacted logs. If no private form is available, use an existing private channel with the maintainer, or open a sanitized issue requesting a private reporting channel without exploit details. Do not disclose a vulnerability publicly just because the private form is unavailable. There is no promised response SLA or bug bounty.

## Supported scope

| Version | Maintenance |
| --- | --- |
| 0.9.x | Current development line; fixes ship in a subsequent release |
| <0.9 | Historical snapshots, no separate backport commitment |

## Data boundary

- Editing and saving are local. The standalone server binds to loopback, not a public interface. Do not expose it directly on the Internet.
- The plugin stores data in `$DSH_HOME/screenwriter-desk/` (default `~/.dsh/screenwriter-desk/`). The standalone app uses `.data/`, or `SCREENWRITER_DATA_DIR`.
- AI requests send the selected scope plus relevant project context, enabled skills and conversation material to the configured provider. A whole-work doctor request may include the story bible, outline and bounded cross-section passages. Read that provider's retention and training policy.
- Harness mode uses host model connections. Standalone mode keeps private model settings locally; project JSON backups exclude model keys.
- There is no StoryDesk cloud account, automatic cross-machine sync or project telemetry service. This statement does not describe Harness, dependency installation or your model provider's separate behavior.
- Installation packages do not include manuscripts, local settings or model keys. Project backups may include complete creative work and should be shared deliberately.

Imported skills and manuscripts are untrusted content. Model replies are not execution receipts; operations pass validated server actions and stale-source protections. Diagnosis and opinion collection must not bypass rewrite authorization or versions. Keep backups; no software can guarantee recovery from every failure.

See [third-party notices](THIRD_PARTY_NOTICES.md) and [contribution rules](CONTRIBUTING.md).
