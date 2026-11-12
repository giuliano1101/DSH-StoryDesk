# DSH-StoryDesk engineering guidance

This repository contains the standalone novel/screenplay creation workbench and its Harness plugin. Keep existing project data and API contracts compatible. Preserve immutable project formats, legacy screenplay data, multi-project isolation, exact paragraph anchors, saved author drafts, read-only imported histories and pre-edit versions. Ordinary editing must work without AI. Use the actual Harness model catalog and never include credentials in model metadata or exports.

Keep plugin IDs, package name, API namespace and data directory compatible with installed versions. Keep src/, server/, shared/, plugin/, tests/, scripts/, worker/ and .openai/ in sync. Build with pnpm build; run pnpm test and pnpm test:sites. Never commit .data/, .qa/, .deployment/, model settings, credentials or local logs.
