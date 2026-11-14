# Architecture / 开发结构

StoryDesk uses a shared application core for a local standalone server and a Harness bundle.

| Path | Responsibility |
| --- | --- |
| `src/` | React workspace, projects, writer, assistant popup, revisions and doctors |
| `server/` | Local API, persistence, validated actions, versions, AI adapter and diagnosis |
| `shared/` | Shared format and doctor contracts |
| `plugin/` | Harness host adapter, client entry and Cordis bundle patch |
| `worker/` + `.openai/` | Existing Sites handoff; not a manuscript cloud-sync service |
| `scripts/` | Frontend / plugin packaging, Sites preparation and documentation checks |
| `tests/` | Domain, API, isolation, evidence, format, revision and packaging coverage |
| `docs/skill-handoff/` | Attributed original skill snapshot and selective adaptation record |

## Important flows

The UI flushes author drafts before dependent operations. The server validates operations and evidence against captured project state. Normal edits persist locally; snapshots and pre-edit versions support recovery. Project and assistant histories are scoped so parallel works do not share accidental context.

A story bible is a deterministic view of saved project foundations and outline. Doctor modes request only curated guidance and bounded content. The server validates exact quotes and classification; it stores inspectable reports. Selected supported findings become collapsed paragraph opinions. Subsequent generation and writing check the underlying sources again. Diagnosis itself does not modify the manuscript.

The Harness adapter enumerates host providers and models; an explicit plugin choice does not silently change the host default. Standalone mode uses an OpenAI-compatible endpoint. These routes share application contracts while retaining private credentials outside project backups.

## Boundaries

No realtime multi-author editing, hosted accounts, unlimited full-book context or automatic synchronization is implemented. Keep host-specific code at the adapter boundary, preserve legacy/imported data, and avoid adding presentation details to persistence contracts without a migration plan.

[Contribution and checks](../CONTRIBUTING.md) · [Privacy](../SECURITY.md)
