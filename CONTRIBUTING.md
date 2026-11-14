# Contributing / 参与贡献

Thank you for helping authors finish stories. 中文、English、日本語 issue descriptions are welcome. Keep changes small, explain the user-visible result, and preserve authors' saved work.

## Local development

For development and packaging, use Node >=22.13 with the pinned pnpm version in package.json. The plugin runtime declares Node >=20; CI installs tools on Node 22, then tests the application separately on Node 20 and 22. Clone this repository, then:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev --host 127.0.0.1
# In another terminal for the local API:
pnpm start
```

The standalone app listens at http://127.0.0.1:4378; the Vite development server prints its own address and proxies API requests. `pnpm start` serves the built client after `pnpm build`. Use an isolated `SCREENWRITER_DATA_DIR` for development; never point acceptance tests at your real manuscripts.

```sh
pnpm test
pnpm run test:docs
pnpm build
pnpm run test:sites
pnpm pack
```

Build precedes Sites tests because they inspect emitted files. The plugin is delivered as a prebuilt `.tgz`; do not commit node_modules, dist, local .data, .qa, screenshots with personal data, keys or model transcripts. See [architecture](docs/architecture.md) and [installation](docs/installation.md).

## Contribution workflow

1. Start from an issue or describe the problem and intended scope in the PR.
2. Use a focused branch. Write regression tests for behavioral fixes; add meaningful tests for new behavior.
3. Run checks above and report actual results. Browser or real-model tests are useful when the changed flow needs them; label fixtures and provider calls honestly.
4. Explain data migration, recovery and model-cost implications when relevant.
5. Keep exact paragraph anchors, project isolation, stale-source checks, pre-edit versions and explicit rewrite authorization intact. Diagnosis must remain read-only.

AI-assisted contributions are welcome. You remain responsible for rights, correctness, tests and explaining the change. Do not upload user manuscripts to model services just to reproduce an issue without permission.

## Translations and design

README.md, README.en.md and README.ja.md provide language entry points; the application is still Chinese-first. Keep compatibility, privacy and installation instructions consistent in every language. Do not advertise UI localization before it exists. Use accessible contrast and text alternatives; keep screenshots synthetic and mark mocked model responses.

## Rights and conduct

Contributions are provided under [MIT](LICENSE). Include provenance and retain original notices for reused code or assets. Do not submit material you cannot redistribute. No CLA is currently required. Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security reports follow [SECURITY.md](SECURITY.md), not public issues.
