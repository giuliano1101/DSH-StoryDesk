# Open Source Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Present StoryDesk professionally and make the verified Harness release easy to install, without changing repository visibility or the running app.

**Architecture:** Repository-only documentation, original vector identity, GitHub community files and CI. Immutable v0.9.4 assets remain the install source. Chinese, English and Japanese landing pages share installation requirements and disclose the Chinese-first interface. License provenance is recorded separately from maintainer-authored documentation.

**Tech Stack:** Markdown, SVG, GitHub Actions, Node test runner, pnpm.

## Task 1: Identity and onboarding
- [x] Preserve the long-form Chinese guide as docs/user-guide.zh-CN.md. Replace README.md and add README.en.md / README.ja.md with release links, features, language status, screenshots and contributor entry points.
- [x] Add docs/assets/hero.svg and icon.svg as original vector artwork. Add a synthetic-data diagnosis screenshot with an explicit fixture caption.
- [x] Add docs/installation.md with private/public download routes, profile selection, compatibility, checksum, migration and troubleshooting. Cite official Harness packaging and plugin-manager docs.

## Task 2: Community and provenance
- [x] Add CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, SUPPORT.md, THIRD_PARTY_NOTICES.md, docs/architecture.md, docs/roadmap.md and docs/open-source-checklist.md.
- [x] Preserve upstream MIT notices. Record the owner-confirmed handoff snapshot under its additional MIT license; do not rewrite history or change visibility.
- [x] Add bilingual issue forms, a pull request template, Dependabot and release note categorization.

## Task 3: Verification and distribution
- [x] First add tests in tests/docs.test.mjs for missing/escaping links and code-fence handling; observe failure because scripts/check-docs.mjs is absent.
- [x] Implement the link checker and add test:docs. Run the link check over maintained entry points and documents.
- [x] Add least-privilege CI to install locked dependencies, run core/docs tests, build before Sites checks, pack the plugin, write checksums and upload workflow artifacts. Pin actions by immutable commit.
- [x] Verify all tests/build/package checks, render the banner, scan tracked content and inspect file changes. Push only the repository preparation commit after verification; do not change the v0.9.4 release asset.
- [ ] Set repository description, topics and support features; verify private visibility and inspect remote CI. Document any remaining public-launch decisions. Remote CI and synchronization are recorded in the final acceptance report.
