# Three Craft Checks Implementation Plan

> **For agentic workers:** Execute inline, task by task, using test-driven-development and verification-before-completion. Keep concurrent work intact.

**Goal:** Add 人物动机、伏笔回收、悬念信息释放 to both novel and screenplay doctors, preserving read-only diagnosis and explicit opinion handoff.

**Architecture:** Add three dedicated modes to the existing doctor flow. Reuse the captured story bible, bounded cross-scene passages, validated quotes, project isolation, report history and stale-opinion protections. Distinguish supported craft findings, optional suggestions and questions; do not label aesthetic judgments as objective contradictions. Future outline plans and intentionally deferred payoffs are not completed prose.

**Tech Stack:** Node HTTP API, React, node:test, existing isolated browser acceptance harness.

**Workspace:** Work only in `screenwriter-desk/`, which is currently untracked inside a dirty unrelated parent repository. A parent Git worktree would omit this project's live source. Do not change branches, stash, commit concurrent work, install, restart Harness or push.

### Task 1: API and interpretation contract

- [x] Append parameterized tests in `tests/doctor.test.mjs` for all three modes × both formats, exact cross-scene evidence, no cross-project data, read-only diagnosis and handoff, invalid findings, stale evidence and history import.
- [x] Run `node --test tests/doctor.test.mjs` and retain expected missing-mode failures.
- [x] Add shared mode metadata in `shared/doctor.mjs`; adapt `server/doctor.mjs`, `server/doctor-guidance.mjs` and `server/api.mjs`. New modes use bounded context, capability `craftChecks`, and required `certainty` (`supported`, `suggestion`, `needs-context`, or fully evidenced `conflict`). Supported findings and suggestions require exact target prose. Questions cannot become rewrite opinions.
- [x] Verify the focused tests pass, including existing legacy modes and imported archives.

### Task 2: Existing popup and safe controller

- [x] Add `tests/doctor-ui.test.mjs` cases showing old backends reject new modes before flush/request, and all modes capture options/model once.
- [x] Run the focused UI tests to observe their failures.
- [x] Update `src/doctor/DoctorModal.jsx` and `controller.mjs` to share labels, display mode-specific guidance and classification labels, and disable unsupported modes without silently falling back.
- [x] Verify UI-controller tests; preserve activity feedback and collapsed assistant-opinion flow.

### Task 3: Browser acceptance and delivery

- [x] Extend an isolated browser acceptance script for both formats: choose every new mode, observe pending feedback, render exact paired sources and classifications, hand off one opinion, block a question, and verify manuscript/version preservation. Test a stale off-scope source before a rewrite call. Use deterministic fixtures and label them explicitly.
- [x] Run full `npm test`, `npm run build` and `npm run test:sites`; retain logs under `.qa/`.
- [x] Update `AGENTS.md`, `CONTRACT.md`, `README.md` and skill adoption notes. Record implementation and test evidence, explicitly separating isolated tests from real-model acceptance and installed status.
- [x] Review changed files against this plan and mark completed tasks. No deployment or restart in this task.

**Verification:** Baseline 306/306; final core 318/318 and Sites 4/4, production build passed. Six isolated browser flows passed (two formats × three checks); real creative-model calls: 0. Packaged candidate 0.9.0, not installed or restarted. See `.qa/craft-final-evidence.json`. Browser first attempt timed out because its startup selector ran before React rendered; corrected test waits and newest-report selection, then all six flows passed. No product failure was hidden.
