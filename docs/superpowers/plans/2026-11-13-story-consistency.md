# Story consistency implementation plan

> **For agentic workers:** Use subagent-driven-development for the isolated story-bible module; integrate and verify its contract before doctor changes. Review spec and quality after the working implementation.

**Goal:** Diagnose a scene/chapter against the saved whole-work outline and adopted canon, with inspectable Markdown and exact opposing evidence.

**Architecture:** Derive a deterministic story-bible snapshot from existing project data; do not create a second editable source of truth. All new doctor requests capture it, while the explicit continuity mode additionally selects bounded cross-scene passages. Diagnosis remains read-only; selected findings flow into existing opinions, with source fingerprints and existing versioned writing guards.

**Tech Stack:** Existing Node API/domain, React doctor modal, node:test, isolated browser acceptance.

## Task 1: Deterministic story bible

Files: `server/story-bible.mjs`, `tests/story-bible.test.mjs`.

- [x] Test deterministic fingerprints, complete active outline/episode coverage, adopted-only characters/world material, missing-data labels, no body inference or cross-project data.
- [x] Implement `captureStoryBible(project)`, `storyBibleDocument(snapshot)`, and `validateStoryBible(snapshot, ownedSceneIds)`.
- [x] Entry contract: `{id,kind,title,text,sceneId?,episodeId?}`. Snapshot: `{schemaVersion:1,title,format,entries,fingerprint,coverage}`. Document adds safe filename and Markdown, derived from the same snapshot.
- [x] Preserve evidence text verbatim. Markdown is a derived view, never executed and never treated as a substitute for saved source fields.

## Task 2: Bounded cross-scene references and exact paired evidence

Files: `server/continuity.mjs`, `server/doctor.mjs`, `server/doctor-guidance.mjs`, `tests/doctor.test.mjs`, `tests/continuity.test.mjs`.

- [x] Red test: diagnosing scene B includes all outline entries, adopted canon, reference from scene A, but no foreign or archived data.
- [x] Select whole reference scenes where possible within a bounded text budget; for long scenes select disclosed start/end excerpts. Rank shared cast/name and proximity; report actual covered/omitted scenes without claiming exhaustive proof.
- [x] Add continuity mode. Capture bible in every diagnosis; only continuity adds cross-body references. Do not send duplicated characters/materials when Markdown already includes them.
- [x] Validate optional issue `certainty: conflict|needs-context` and `basis:[{referenceId,quote}]`; every conflict needs exact target evidence plus at least one exact opposing source. Unknown/missing context remains a question, not invented canon.
- [x] Source changes, including off-scope outline/reference-body edits, invalidate handoff. Legacy reports retain their original comparison logic; imported histories stay read-only.
- [x] Include paired references in the saved opinion instruction. Never update canon from a model diagnosis.

## Task 3: Doctor interface and export

Files: `server/api.mjs`, `src/doctor/controller.mjs`, `src/doctor/DoctorModal.jsx`, `src/doctor/doctor.css`, UI tests.

- [x] GET doctor history returns current derived bible and feature capability; POST returns captured bible. No model call or state mutation when viewing/exporting.
- [x] Add consistency mode and a collapsed `故事档案` preview with Markdown download. Show its version/coverage and material gaps.
- [x] Reports display target quote, comparison quote, certainty and partial-context limits; retain snapshot MD for old diagnoses.
- [x] Older backend clearly requests full reopen for this feature and does not pretend to compare canon.

## Task 4: Verification and delivery

- [x] Run all existing and new tests; production build and Sites checks.
- [x] Isolated browser acceptance: preview/download Markdown without model calls; submit one continuity diagnosis; compare target/canon evidence; handoff an opinion without changing prose; off-scope edit invalidates it.
- [x] Update README/CONTRACT/AGENTS/adoption notes. Build an installable package; do not deploy the new feature or restart Harness without the user's decision. The separately approved 0.7.1 installation remains intact.
