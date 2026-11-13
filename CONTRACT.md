# Screenwriter Desk v1 contract

All paths are same-origin `/api/…`. The standalone app binds loopback only. DSH mounts the same routes under `/screenwriter-desk/api/` and applies host authentication.

## State
`GET /api/state` returns `{state, ai:{connected,label}, capabilities:{creationFormats:['screenplay','novel']}}`. Creation capabilities are independent of model readiness. An older backend missing this capability remains usable for screenplay work; the client gates novel creation. State is `{schemaVersion:1, revision, projects, sharedMaterials, workspace, assistant?}`. Assistant state is optional, separate from secret settings. Older data remains readable; GET never writes defaults to disk.

A project is `{id,format,title,kind,stage,status,pinned,deadline,synopsis,brief,characters,materials,scenes,tasks,versions,aiHistory,view,createdAt,updatedAt}`. `format` is immutable `screenplay|novel`; absent legacy values read as screenplay. New creation defaults to screenplay and strictly rejects explicitly invalid values. `project.update` rejects the `format` field. Novel defaults are title `未命名小说`, kind `长篇小说`, unit title `未命名章节` and group `第一卷`. Internal `scenes`, `sceneId`, `act`, routes and data namespace stay stable: novel scenes are chapters and acts are volumes. Existing screenplay defaults and data remain valid.
`stage` is `idea|characters|outline|draft|revision|delivery`; `status` is `active|paused|archived`; `deadline` is a `YYYY-MM-DD` string or empty.
`brief` is `{logline,length,audience,theme,constraints}`; all fields are text.
Characters are `{id,name,role,goal,secret,voice,notes,status}`; materials `{id,title,category,body,source,status}`. Reference `status` is `adopted|alternative|archived`.
Scenes are `{id,title,location,time,interior,act,cast,summary,intent,outcome,body,revision,archived}`; `cast` holds character IDs, and `interior` is `内景|外景`. Scene IDs are stable across reorder.
Tasks are `{id,title,sceneId,due,done}`. Versions `{id,name,createdAt,snapshot}` contain a snapshot of format/title/kind/synopsis/brief/characters/materials/scenes, never nested version history. An old snapshot missing format inherits its owning project on import/export/restore; an explicitly conflicting snapshot format is rejected on import or restore. Restoring never converts a project's format.
`view` is `{tab,sceneId,cursor,scrollTop,inspector}`. `workspace` is `{screen,activeProjectId,openProjectIds,theme,overviewMode,creationMode?}`. `creationMode` accepts only `screenplay|novel`, with legacy read fallback screenplay. Defaults: screen `overview`, theme `light`, overviewMode `grid`. `screen:'entry'` records returning to the common creation entrance. Opening/creating/importing a project derives creationMode from that project. UI view changes must not erase draft content.

### Shared creation vocabulary

Browser-safe `shared/creation.mjs` exports `projectFormat(project)`, `workspaceFormat(state)`, `creationCopy(format)` and `roleForPage(page,format)`. Read helpers treat absent/invalid formats as screenplay without mutation. Workspace format follows the active owned project while `screen:'project'`; otherwise it follows workspace.creationMode. Mutations use strict validation. Unknown pages return no role. `creationCopy` returns an immutable object with this exact shape:

```js
{format,workspaceTitle,entryLabel,projectNoun,projectName,defaultKind,
 unit,unitName,unitCount,group,groupName,manuscriptLabel,
 tabs:{brief,library,scenes,script},
 stages:{idea,characters,outline,draft,revision,delivery},
 brief:{logline,length,audience,theme,constraints,synopsis}}
```

| Keys, in order | screenplay | novel |
| --- | --- | --- |
| workspaceTitle / entryLabel / projectNoun | 编剧工作台 / 剧本创作 / 剧本 | 小说工作台 / 小说创作 / 小说 |
| projectName / defaultKind | 未命名剧本 / 短片 | 未命名小说 / 长篇小说 |
| unit / unitName / unitCount | 场景 / 未命名场景 / 场 | 章节 / 未命名章节 / 章 |
| group / groupName / manuscriptLabel | 幕 / 第一幕 / 剧本正文 | 卷 / 第一卷 / 小说正文 |
| tabs: brief / library / scenes / script | 项目简报 / 资料与人物 / 分场 / 正文 | 作品设定 / 人物与世界观 / 章节大纲 / 正文 |
| stages: idea / characters / outline / draft / revision / delivery | 故事构思 / 人物开发 / 分场 / 写稿 / 改稿 / 待交付 | 灵感构思 / 人物塑造 / 章节大纲 / 小说初稿 / 修订打磨 / 完稿导出 |
| brief: logline / length / audience / theme / constraints / synopsis | 一句话故事 / 时长 / 目标观众 / 主题 / 创作约束 / 故事梗概 | 故事前提 / 目标字数 / 目标读者 / 主题 / 视角与文风约束 / 故事梗概 |

## Commands
`POST /api/actions` accepts `{action}` and returns `{state,result?}`. Errors are JSON `{error,code?}` with 4xx status. Actions:
```js
{type:'project.create',title?,kind?,deadline?,format?:'screenplay'|'novel',text?}
{type:'project.import',project} // exported JSON project backup
{type:'project.update',projectId,patch} // only title/kind/stage/status/pinned/deadline/synopsis/brief
{type:'scene.add',projectId,scene} // scene may be empty
{type:'scene.update',projectId,sceneId,patch} // only scene editable fields, revision server-owned
{type:'scene.reorder',projectId,sceneIds} // exact permutation of all scene IDs
{type:'character.upsert',projectId,character} // optional id for insert
{type:'material.upsert',projectId,material} // optional id for insert
{type:'shared.add',material}
{type:'shared.update',materialId,patch} // title/category/body/source/status; retained ID
{type:'shared.import',projectId,materialId} // independent copy with retained source
{type:'task.upsert',projectId,task}
{type:'task.toggle',projectId,taskId}
{type:'view.save',projectId,view}
{type:'workspace.update',patch}
{type:'version.create',projectId,name}
{type:'version.restore',projectId,versionId} // retain pre-restore snapshot and append restored snapshot
{type:'ai.apply',projectId,suggestionId} // match original revision/text; save pre-edit snapshot; never apply twice
```
Creation result: `{projectId}` or `{sceneId}` or `{id}` as appropriate. Project and scene updates merge whitelisted fields, not whole snapshots. Project view merges must not update creative `updatedAt`.

Request limits are measured in UTF-8 bytes: normal actions, AI requests, and settings are limited to **2 MiB**. A `POST /api/actions` request whose action is `project.import` may be up to **64 MiB**, including its JSON request envelope. The actions transport is bounded at 64 MiB, then the parsed action type is checked so every non-import action still has the 2 MiB limit. Oversized requests return HTTP 413 with `BODY_TOO_LARGE`; content is never truncated.

Project-owned collection counts (`characters`, `materials`, `scenes`, `tasks`, `versions`, `aiHistory`, including version snapshot collections) have no separate arbitrary item cap: the complete import request's 64 MiB byte limit bounds them. Normal editing and AI history may therefore grow past 5,000 entries without producing an unimportable backup. Field types, IDs, project ownership, and source revisions remain validated. Imported generated version labels are preserved exactly, including labels extended by restore or AI snapshot prefixes.

## AI
`POST /api/ai` takes `{projectId,sceneId,mode,instruction,selection?,modelSelection?}`. Mode `discuss|check|rewrite`. Selection `{start,end,text}` must match original body. Returns `{state,suggestion}`. Suggestion stored in that project's `aiHistory`: `{id,projectId,sceneId,sourceRevision,sourceText,selection,mode,prompt,text,model,createdAt,applied:false}`. It never edits prose until `ai.apply`; discuss/check cannot be applied. Background completion re-reads current state before adding the result.

`GET /api/settings` returns `{configured,baseUrl,model}` without secrets. `POST /api/settings` accepts `{baseUrl,model,apiKey}`; blank key retains an existing key. Save secrets in a private server-only file. Also support `SCREENWRITER_AI_URL`, `SCREENWRITER_AI_MODEL`, `SCREENWRITER_AI_KEY`. Calls use OpenAI-compatible chat completions. An injected DSH model adapter takes precedence if available. Updating standalone settings preserves unrelated private settings, including the plugin model preference.

`GET /api/models` returns the live model catalog. In Harness its response is `{mode:'host',providers:[{id,name,models:[{id,name}]}],default:null|{provider,model},selection:null|{provider,model},effective:null|{provider,model},connected,label,partial,error?,code?}`. Providers come from `llm.listProviders()` and models from `llm.listModels(providerId)`. Only IDs and display names are exposed; credentials and provider error details are never returned. One failed provider does not hide the other providers; `partial:true` signals incomplete discovery. A failed provider-list request returns a safe error with `connected:false`.

`POST /api/models` accepts exactly `{selection:null|{provider,model}}`. A concrete selection must exist in the live catalog before it is saved. Null follows the Harness default; a concrete selection overrides it only for this plugin and never changes the Harness global default. The preference is stored in private `settings.json`, survives reload, and never enters project state or backups. Both model routes inherit host authentication and same-origin guards. In standalone or generic injected-adapter mode, GET returns `{mode:'standalone'|'adapter',providers:[],selection:null,default:null,effective:null,connected,label}`; POST directs the user to existing connection settings.

An unavailable or removed chosen model remains selected and reports `connected:false` / `MODEL_UNAVAILABLE`; it never silently falls back. Before each host model call, the chosen provider/model is validated against fresh discovery. Assistant and legacy AI requests may carry `modelSelection:null|{provider,model}`. The frontend captures the exact effective route at submission, before flushing draft edits. The server snapshots the host default synchronously before reading private settings, then honors any saved explicit override. It captures the route before preparing the request, resolving null to that submission-time default once. Later preference/default changes cannot reroute an already-submitted request. Removed routes are refused before any provider call. Route validation errors produce no suggestion or conversation entry.

## Page assistants

`GET /api/assistant` returns `{assistant:{capabilities:{execute:true,write:true,navigate:true},roles,skills,profiles,threads}}`, with no model credentials. Use this normalized representation instead of raw `state.assistant`, which also stores server-owned validation metadata.

Roles are `{id,name,description,personality,skillIds}`. The server derives the role from the page:

| Page | Role ID |
| --- | --- |
| `overview`, `projects`, `tasks` | `manager` |
| `shared` | `librarian` |
| `brief` | `story` |
| `library` | `character` |
| `scenes` | `structure` |
| `script` | `writer` |

Skills are `{id,name,description,content,builtin}`. Preset IDs: `project-planning`, `story-core`, `character-arcs`, `scene-progression`, `dialogue`, `continuity`, `material-curation`, `screenwriting`. Imported content is bounded plain Markdown and never executes code, paths or network access. Simple frontmatter `name:` and `description:` is supported; the first heading supplies a fallback name. The complete original Markdown is retained.

The existing six screenplay roles and eight preset definitions remain unchanged. Novel mode adds six independent roles on the corresponding pages: `novel-manager` 小说项目编辑, `novel-librarian` 设定资料员, `novel-story` 小说策划, `novel-character` 人物编辑, `novel-structure` 章节编辑, and `novel-writer` 小说写作搭档. Five added presets are `novel-premise` 故事前提与读者承诺, `novel-character` 人物内心与声音, `novel-chapters` 章节节奏与伏笔, `novel-voice` 叙述视角与文风, and `novel-world` 世界规则与连续性. Project planning/material curation presets are shared where appropriate. The novel writer's defaults do not enable screenplay action-only presets. Each novel role has its own global/project profile and may enable imported text Skills. Regular assistant, legacy AI and paragraph revision prompts resolve the novel writer consistently, preserving POV, tense, narrative distance and author voice while allowing narration, inner thoughts and sensory detail.

`profiles` is `{global:{[roleId]:profile},projects:{[projectId]:{[roleId]:profile}}}`; each profile is exactly `{name,personality,skillIds}`. Global response profiles include every default. Project maps contain only explicit overrides. Resolve project override first, then global. Names are bounded at 80 characters, personality/work instructions at 8,000, and enabled Skills at 12 unique existing IDs.

`POST /api/assistant/config` takes `{roleId,projectId:null|existingId,profile}` and returns `{state,assistant}`. Null project means workspace default; a project ID means project override. `profile:null` resets only a project override. Unknown role/project/Skill IDs and extra profile fields are rejected. Saving model credentials does not erase profiles.

`POST /api/assistant/skills` takes `{markdown}` and returns `{state,assistant,skill}`. Up to 48 imported Skills, each 24,000 characters. Import does not enable it automatically; configure the returned ID in `skillIds`.

`POST /api/assistant` takes:

```js
{
  context: {
    page: 'overview'|'projects'|'tasks'|'shared'|'brief'|'library'|'scenes'|'script',
    projectId?, sceneId?, creationMode?: 'screenplay'|'novel',
    focus?: {kind:'character'|'material',id},
    selection?: {start,end,text}
  },
  mode: 'execute'|'discuss'|'manage'|'rewrite', instruction,
  scope?: 'scene'|'selection',
  modelSelection?: null|{provider,model}
}
```

Project pages (`brief/library/scenes/script`) require a project ID. Global pages reject project/scene/focus/selection context. `sceneId` is optional on `script/scenes` and must belong to that project. Script discussion and task management work before the first scene exists; rewrite requires a selected scene. Focus is only accepted on `library`, identifying a current-project reference. Selection is only accepted on `script`, matching a current nonempty range exactly. Rewrite is only available on `script`. `scope:'selection'` requires an exact selection and never expands it; without scope, a supplied selection implies selection rewrite, otherwise scene rewrite. Explicit `scope:'scene'` requests the full scene.

Project contexts derive format from the owned project and reject mismatching explicit creationMode. Global omission always means screenplay, independently of the current workspace. Novel contexts and public turns retain `creationMode:'novel'`; screenplay contexts/turns preserve their legacy shape. Global project/task data, model projectIndex, fingerprints and write authority include only the captured format. Shared materials remain an explicitly common library. Assistant-created projects inherit the captured format when omitted, and an explicit conflicting format is refused. Navigation to another format does not authorize writes there and updates workspace mode when allowed; server navigation freshness also compares creation mode. Returning to `screen:'entry'` invalidates prior page navigation.

Returns `{state,assistant,turn}`. Public turns are:

```js
{
  id,contextKey,page,projectId:null|id,sceneId:null|id,focus?,
  roleId,roleName,instruction,reply,model,createdAt,mode,
  actions:[{label,action}],applied,
  suggestionId?,sourceRevision?,sourceText?,selection?, // rewrite previews
  readOnly? // imported history
}
```

Actions contain actual validated domain commands. Render affected entities and fields as well as labels for review. Rewrite reply is replacement text; preview against `selection.text` or full `sourceText`. Discuss replies and explanatory management replies have no actions and cannot be adopted. Rewrite also creates a legacy project `aiHistory` entry linked by `suggestionId`. Adopting through either API synchronizes the suggestion and linked assistant turn's `applied` status.

`threads` maps context key to ordered turns. Import `assistantContextKey` from browser-safe `shared/assistant-context.mjs`. Its exact formula is:

```js
const identity = [
  context.page, context.projectId || null, context.sceneId || null,
  context.focus?.kind || null, context.focus?.id || null
];
if (context.creationMode === 'novel') identity.push('novel');
JSON.stringify(identity)
```

Selection and persona name do not split chats. Prompts include only the last 12 matching-context turns fitting a 20,000-character serialized history budget. History contains instruction/reply/mode, actual validated action previews, and explicit `applied`/`readOnly` state so follow-ups can revise a pending proposal by its concrete entities and dates without implying it was saved. Keep the original request context while pending: completion is stored there even after navigation, and must not appear as the newly selected project's reply. Prompts also receive trusted runtime `serverTime:{iso,localDate,timeZone}` for relative date interpretation; time is not part of proposal fingerprints and never supplies invented deadlines.

Management model output may be plain explanation or JSON/fenced JSON `{reply,actions:[{label,action}]}`. Proposals change no creative content before adoption. Up to 12 operations are strictly allowlisted, checked for ownership and unknown fields, and simulated on a clone. The prompt specifies exact operation keys/schema and available entity IDs. User data and Skills cannot widen permissions.

| Page | Management operations |
| --- | --- |
| `overview/projects` | `project.create` without manuscript body, `project.update` metadata/brief, `task.upsert`, `task.toggle` for visible projects |
| `tasks` | `task.upsert`, `task.toggle` for visible projects |
| `shared` | `shared.add`, `shared.update`, including status |
| `brief` | Current project's `project.update` metadata/brief |
| `library` | Current project's `character.upsert`, `material.upsert`, `shared.import` |
| `scenes` | Current project's `scene.add` with empty body, `scene.update` metadata, `scene.reorder` |
| `script` | Current project's `task.upsert`, current scene's `scene.update` metadata; body only through guarded rewrite |

Fields match Commands above. Project patch allows only `title/kind/stage/status/pinned/deadline/synopsis/brief`. Scene metadata allows only `title/location/time/interior/act/cast/summary/intent/outcome/archived`, never body/revision/IDs. Existing nested `task.id`, `character.id`, `material.id` are update selectors; any supplied ID must be a nonempty string identifying an existing owned entity. Only omission creates; null, false, zero and empty IDs are rejected. Scene reorder includes every scene ID, including archived scenes.

`POST /api/assistant/apply` takes `{turnId,allowNavigation?:boolean}` (default `true`) and returns `{state,assistant,turn,result}`. Whole-batch adoption is atomic and once-only. Creative operations retain pre-edit project versions. Server-owned source fingerprints are captured before generation; edits during generation or before adoption invalidate old proposals. Navigation/history/version records alone do not, and another project's edit does not invalidate a project-scoped proposal. Rewrite delegates to existing `ai.apply` text/revision guards and preserves selection surroundings. HTTP 409 codes: `ALREADY_APPLIED`, `STALE_PROPOSAL`, `STALE_SUGGESTION`; no-action/read-only adoption is HTTP 400.

Global prompts include project summaries/stages/deadlines/counts/tasks/scene IDs and titles, never manuscripts. Project prompts contain only that project's brief, adopted references and outline. Library may include its explicitly focused alternative/archived reference as labeled current-page data, without adopting it. Script includes the current body. Selection rewrite sends the complete selection plus labeled nearby context (up to 1,000 characters each side), retaining the complete source server-side. Prompt budget is 120,000 characters; a complete target that cannot fit returns HTTP 413 `ASSISTANT_CONTEXT_TOO_LARGE` rather than being truncated. Existing provider errors and 120-second timeout remain.

Exact frontend examples (use real current IDs):

```js
POST('/api/assistant', {
  context:{page:'brief',projectId},mode:'discuss',instruction:'故事的代价够具体吗？'
});
POST('/api/assistant', {
  context:{page:'tasks'},mode:'manage',instruction:'为雨站增加核对人物动机的任务，日期留空。'
});
POST('/api/assistant', {
  context:{page:'script',projectId,sceneId,selection:{start,end,text}},
  mode:'rewrite',scope:'selection',instruction:'用动作表达这段情绪。'
});
POST('/api/assistant/apply', {turnId}); // after reviewing actual changes
POST('/api/assistant/config', {
  roleId:'writer',projectId:null,
  profile:{name:'编剧搭档',personality:'先核对动作和潜台词',skillIds:['dialogue','continuity']}
});
```

## Executable assistant and reply writes

`execute` uses the same validated `{reply,actions:[{label,action}]}` format as management proposals. `POST /api/assistant` only generates and persists an inspectable turn. After saving pending drafts and checking the original target, the client may automatically apply it once. A failed apply leaves the turn inspectable. Execute turns add `executionStatus:'pending'|'needs_input'|'applied'` (`read_only` on imports). Plain explanations/empty actions receive a server-owned “未执行任何操作” prefix and `needs_input`; generated prose never proves an edit succeeded.

On all project pages execute allows current-project `project.update`, `task.upsert`, `task.toggle`, `character.upsert`, `material.upsert`, `shared.import`, `scene.add`, `scene.update`, and `scene.reorder`. `scene.add` can contain initial screenplay text. Global pages keep their existing management allowlists; `overview/projects` execute also accepts optional `project.create.text`, producing a new initial scene with a server-owned ID. Manage still rejects `text` and retains all existing page/body restrictions.

Execute adds two strictly validated commands:

```js
{type:'scene.write',projectId,sceneId,placement:'append'|'replace'|'selection',text}
{type:'ui.navigate',page:'overview'|'projects'|'tasks'|'shared'|'brief'|'library'|'scenes'|'script',projectId?,sceneId?}
```

`scene.write` only writes the originating current script scene. Append separates existing/generated text with two newlines. Selection replaces the exact captured nonempty range and preserves surroundings, without whole-scene fallback. A captured selection refuses implicit `replace`; explicit request `scope:'scene'` permits whole-scene replacement. An explicit `scope:'selection'` without a captured selection refuses body writes entirely; metadata-only operations remain allowed. Archived project/scene/shared/reference creative content refuses writes; restores must be separate status-only operations. Each batch step validates both original target authority and the evolving simulated state, so archiving then rewriting within a batch is refused atomically. Navigation requires known existing targets; project pages require projectId, scenes belong to that project and are accepted only for script/scenes; global pages reject project/scene IDs. No URLs, selectors, JavaScript or operating-system commands. Project execute prompts receive `projectIndex:[{id,title,stage}]` solely for navigation, without other-project prose.

Batch apply returns `result:{results,appliedWrites:[{label,action,result}],appliedNavigation:[{page,projectId?,sceneId?}],skippedNavigation:[{type:'ui.navigate',page,projectId?,sceneId?,reason}],preEditVersionIds:[{projectId,versionId}]}`. Skip reasons are `client_context_changed` or `origin_context_changed`. The client passes `allowNavigation:false` when its current context changed. Independently, the server checks actual workspace page, active project, project tab and captured scene against the originating context; a mismatch skips navigation while valid background content can still save. Execute restores existing workspace/views around content commands, including implicit project-create/first-scene navigation, then applies only allowed explicit navigation through workspace.update/view.save. Cross-project navigation never authorizes cross-project writes. Fingerprints exclude views/history/versions but include captured content and shared import sources. Validate/simulate the whole batch before atomic commit. `turn.appliedOutcome` records actual results; `turn.preEditVersionIds` records pre-edit project recovery versions. Rewrite also returns pre-edit version IDs while preserving its existing text/revision guards.

Public turns add server-derived `writeTargets:[{target,label}]`. Applied, written and imported turns expose no targets. `POST /api/assistant/write` accepts exactly `{turnId,target,text?,title?}`; omitted text writes persisted turn.reply, while explicit text writes the author's edited replacement. The caller cannot provide project/scene/focus IDs or expand the original context.

| Original context | Write targets |
| --- | --- |
| Current script scene | `script.append`, `script.replace`; `script.selection` only with captured exact selection |
| Project brief | `brief.synopsis`, `brief.logline`, `brief.theme`, `brief.constraints` |
| Focused library character | `character.notes`; library also allows `material.new` |
| Focused library material | `material.body`; library also allows `material.new` |
| Project scenes | `scene.new.summary`, `scene.new.body` |
| Global page | `shared.new` |

`script.replace` is an explicit whole-scene choice. Missing/stale selections refuse without fallback. Archived focused references/projects/scenes have no eligible content targets. `title` is accepted only for new entries (default “助手写入”). New saved materials use status alternative and source “助手回复”. Ordinary destination field limits apply.

Write returns `{state,assistant,turn,destination,preEditVersionIds}`, persisting `turn.write:{target,text,destination,preEditVersionIds,createdAt}`. Destination is `{page,projectId?,sceneId?,focus?:{kind,id},materialId?,field?,label}` with actual saved IDs for a view control. Writing never silently navigates. Pre-edit IDs always use `[{projectId,versionId}]`; recovery uses existing project versions, without a whole-state undo snapshot. One successful write per turn prevents duplicate appends (`ALREADY_WRITTEN`, HTTP 409). Applying a written turn (including its linked legacy ai.apply route) or writing an applied turn refuses with `ALREADY_APPLIED`. Concurrent requests serialize. Invalid/stale writes commit no text, versions or flags.

Project backup/import retains execute mode, readable appliedOutcome results, top-level preEditVersionIds, and actual written text/destinations, remapping owned project IDs and version references to the copy. Imports always set readOnly:true, actions:[], writeTargets:[], without fingerprints or executable links; both apply/write refuse them. Older discuss/manage/rewrite backups remain compatible. GET capability/default normalization never writes state.

## Paragraph opinions in assistant chat

`GET /api/revisions` returns `{capabilities:{notes:true,generate:true,apply:true,chat:true}}` without a model or state write. Older projects may omit `revisionNotes` and `revisionBatches`; treat each as `[]` without persisting defaults.

`POST /api/revisions/notes` saves an opinion without calling a model or changing prose, scene revisions, versions or navigation. It accepts exactly these operation-specific fields:

```js
{projectId,operation:'add',sceneId,selection:{start,end,text},instruction}
{projectId,operation:'update',noteId,instruction}
{projectId,operation:'reanchor',noteId,selection:{start,end,text}}
{projectId,operation:'remove',noteId}
```

Returns `{state,note?}`. IDs must be nonempty strings; unsupported fields/types refuse. Add/reanchor require a nonempty range matching the current scene exactly. Reanchor stays in the note's original scene. Instructions retain author whitespace and are bounded to 100,000 characters. Archived projects refuse all note operations. Archived scenes refuse add/update/reanchor; removing an opinion is allowed and only removes the opinion while invalidating its pending previews, leaving the archived prose unchanged. Notes whose original scene disappeared after restoring a version remain readable, editable and removable; reanchor requires that original scene to exist. Applied notes remain history; add a fresh opinion for further work.

Project-local optional `revisionNotes` records are `{id,sceneId,selection,instruction,sourceRevision,sourceHash,version,status:'open'|'applied',createdAt,updatedAt,appliedAt?}`. `sourceHash` is the SHA-256 of the captured whole scene body; generation and adoption require its hash, revision and exact range to match. Author instruction edits/reanchors increment `version` and invalidate pending previews for that opinion. A stale instruction remains editable but only explicit reanchor refreshes its source. Removing an opinion retains its readable batch history.

`POST /api/revisions/generate` accepts exactly `{projectId,noteIds,modelSelection?,chatInstruction?}` and returns `{state,batch}`. IDs must be unique existing open opinions in the same current project. Selected ranges must not overlap in a scene. All ownership, archive, stale and overlap checks happen before the model call. The host provider/model is captured once through the existing model-selection flow and passed to the provider with a 120-second abort signal. The prompt uses the project's accepted references, brief, outline, writer persona and enabled Skills, with complete selected text/opinions and labeled nearby context. It never includes another project's data or truncates selected text/opinions; the 120,000-character prompt budget returns HTTP 413 `REVISION_CONTEXT_TOO_LARGE`. Collection size is not arbitrarily capped.

The optional `chatInstruction` is a string of at most 24,000 characters; presence, including an empty string, identifies assistant-origin requests and batches. It is captured unchanged, supplied alongside complete paragraph opinions in the prompt, stored in the returned batch and validated/preserved on import. Legacy callers and batches omit it.

The model must return strict JSON `{changes:[{noteId,text}]}`, exactly once per requested note, with nonempty replacements up to 1,000,000 characters each and total output up to 4,000,000 bytes. Unsupported fields, fences, missing/duplicate/foreign IDs and malformed output refuse with HTTP 502 `INVALID_REVISION_OUTPUT`, saving no batch. Generation only appends a preview. Changes to an opinion/body or archive state while the model runs preserve the captured preview as `stale`, without overwriting newer prose/opinions.

Project-local optional batches are:

```js
{
  id,createdAt,model,chatInstruction?,
  changes:[{
    id,noteId,noteVersion,sceneId,sceneTitle,instruction,
    selection:{start,end,text},sourceRevision,sourceHash,replacement,
    status:'pending'|'applied'|'stale',appliedAt?
  }],
  preEditVersionIds:[{projectId,versionId}],readOnly?
}
```

`sceneTitle` and `instruction` are captured for readable history even after the opinion is edited/removed. Host `model` is the captured `provider / model` identifier; standalone adapters retain their returned model label.

`POST /api/revisions/apply` accepts exactly `{projectId,batchId,changeIds}` and returns `{state,result:{appliedChangeIds,preEditVersionIds:[{projectId,versionId}],sceneIds}}`. Selected change IDs must belong to that batch/project and be unique, pending, current and nonoverlapping. A missing opinion, edited opinion, changed body, archive, read-only import or any stale selected change rejects the whole transaction without prose/version/flag mutations. Successful transactions create exactly one screenplay recovery version for the project, apply descending ranges in each scene, preserve all surrounding prose, increment affected scene revisions, and mark adopted opinions/changes applied. They do not navigate or touch other projects. Concurrent/repeated adoption commits once.

After a partial adoption, unaffected open opinions and pending previews from that exact old scene revision/hash rebase their ranges, hash and revision to the new body. Opinion versions do not change during this automatic rebase. Rebasing requires unchanged opinion version and disjoint captured ranges; conflicting previews become stale and conflicting opinions retain their stale source for explicit reanchor. This makes the next single adoption safe even when prior replacement lengths differ.

Errors include HTTP 409 `STALE_REVISION`, `OVERLAPPING_REVISIONS`, `ALREADY_APPLIED`, `ARCHIVED_REVISION`; HTTP 400 `READ_ONLY_REVISION`; and HTTP 404 `REVISION_NOTE_NOT_FOUND`, `REVISION_BATCH_NOT_FOUND`, `REVISION_CHANGE_NOT_FOUND` for foreign/missing IDs.

The ordinary writing flow saves an exact-selection opinion with “加入助手” without calling the model, changing prose or opening the assistant. All current-project scenes/episodes share a collapsed composer group. Open notes are queued unless their same ID/version is already captured by an assistant-origin live batch whose entire remaining write is currently eligible. Any stale/source-changed/version-changed change or recovered note editor makes that whole batch stop suppressing open notes, so removing/reanchoring one failed opinion cannot strand its other opinions; imported read-only batches never consume the queue. Sending accepts attachments without an overall instruction, captures project/model/note versions/draft generation before awaits, generates once, then automatically attempts only that new batch once. A blocked write remains in chat with an apply-only retry and honest errors/recovery links. Reload/open never replays history. Normal chat and opinion sends share a project reservation. The exact existing draft/dialog/stale/overlap locks and recovery-version transaction remain authoritative.

Full-project JSON automatically exports both optional collections. Import validates owned scene references against current scenes and manuscript recovery snapshots, types, timestamps, hashes, ranges and nested fields; it retains stale excerpts/opinions and remaps note/batch/change IDs. Imported matching notes may generate new previews. Imported batches always receive `readOnly:true`, regardless of a forged input flag, and can never be adopted. Deleted-opinion stale/applied history retains an inert remapped note alias. Named version snapshots/exports remain manuscript-only (no opinion history), preserving their project format; restoring a manuscript retains note history and its source guards reject obsolete anchors.

## Export
`GET /api/export?projectId=ID&format=fountain|markdown|txt|json|html|docx&versionId=OPTIONAL` streams actual bytes with content disposition. Screenplay Fountain/HTML/DOCX remain unchanged. Novels support Markdown (`.md`), TXT, HTML, DOCX and JSON; Fountain clearly rejects novels. Novel text/HTML/Word render chapter/volume headings and prose, omitting screenplay sluglines and interior/location/time metadata. HTML is escaped and printable for browser PDF printing; DOCX is a valid Office document. JSON is a project backup. Both full and named-version JSON preserve format. Export a named version's snapshot when `versionId` is provided. No credentials in any export.

Before downloading JSON, the server verifies that its lossless compact `project.import` request (including envelope) fits the 64 MiB import limit. A larger complete-history JSON export returns HTTP 413 with `PROJECT_BACKUP_TOO_LARGE` and instructions to export a specific version or directly preserve the local data directory's `state.json` as the complete offline backup. It never offers a JSON download that exceeds its own roundtrip limit, and never silently drops versions to fit.

Full project JSON additionally carries `assistant:{profiles,skills,turns}` when project overrides or conversations exist. It contains actual project overrides, project-scoped chat text/history, and custom Skills referenced by those overrides; inherited workspace defaults and global conversations remain workspace data. Import generates fresh turn/Skill IDs as needed, remaps copied-project ownership and context keys, and makes imported proposal history inert (`readOnly:true`, `actions:[]`, no executable suggestion link). Assistant-origin legacy suggestion records carry `origin:'assistant'`; imported records also carry `readOnly:true` and reject legacy `ai.apply` with `READ_ONLY_SUGGESTION`. Older unmarked assistant backups are recognized by their turn's `suggestionId` link and receive the same protection. Genuine legacy `/api/ai` backup suggestions remain adoptable. Imported rewrite previews retain original/replacement text; source-project proposals cannot be adopted through either endpoint on the copied history. Named-version exports remain snapshot-only. The same 64 MiB lossless import envelope cap includes assistant data.

## Integration
Export `createStore({directory,seed})`, `createApi({store,modelAdapter?})` whose handler accepts Node `req,res` and handles `/api/…`, and `startServer({port,host,directory,seed})` returning `{server,url,close}` for tests and standalone. Default initial seed is three clearly marked example projects; dates relative to `2026-11-12` are demo data, not user deadlines. Store defaults to package `.data/`, with `SCREENWRITER_DATA_DIR` override.

## Native shell and assistant layout

The Harness plugin reserves the host-owned native top clearance only in a non-fullscreen macOS window: at least 48 px, respecting `--dsh-frame-top-clearance` up to 120 px. Changes to platform/fullscreen/style attributes, resize and fullscreen events update this clearance. Browser, non-macOS and fullscreen layouts reserve zero. The plugin never draws replacement traffic-light controls. Fixed modal shades start below the same native clearance, and modal height is constrained to the remaining content area so settings never dim the native controls or hide the close header.

Layout follows the plugin's measured width, independently of the outer browser width. At 960 px and wider the assistant shares the workspace side by side; the sidebar and inner writer outline compact as needed. Below 960 px, opening the assistant replaces the content area with a dedicated assistant view. No dim backdrop or overlapping drawer obscures the work; global navigation remains available. Hidden content stays mounted so draft/configuration/adoption guards retain their state. Assistant settings remain a stable sibling when width/open state changes.

The assistant model selector groups live models by provider and refreshes on assistant opening, selector focus and window focus. Loading, saving, missing models, catalog errors and unavailable assistant APIs disable generation and never show a ready/green connection. An installed backend returning 404 for the assistant displays `完整退出并重新打开 Harness 后加载新版助手`; the UI does not restart Harness automatically. Standalone connection settings remain available.

## Assistant frontend execution and reply writing

New conversation drafts default to `execute`; valid recovered `discuss/manage/rewrite/execute` modes remain unchanged. The composer labels are 执行, 讨论, 预览修改, with the existing script rewrite shortcut. Script execute requests carry the explicit local body scope. A vanished selection retains `scope:selection` and a visible body-range hint; it never silently upgrades to scene scope, while metadata-only operations remain possible.

Only the newly returned POST execute turn triggers one automatic `/assistant/apply`. GET/history/reload never trigger adoption. A synchronous per-turn controller prevents automatic/manual overlap and repeats after a successful commit. Locks begin after generation, and preflight flushes use the adoption token. After flushing, compare the live page/project/scene/focus with the originating context and disable navigation if it changed or any dialog is open. Server-side origin checks provide the independent final navigation guard.

Content-editing dialogs inside the trusted workbench are associated with its project/shared target. Because their unsaved fields are not registered draft flushers, an affected dialog defers apply/write without saving, discarding or closing it; show the inspectable pending turn and a manual retry. A dialog belonging to another project does not block background content saves. Explicit reply writing uses the same flush/lock/release pipeline, with a shared lock for `shared.new` even when no actions exist.

Eligible replies expose 写入页面 with server-derived targets and an editable preview. `script.selection` is the default whenever offered; otherwise scripts default to append. `script.replace` is an explicit whole-scene choice. Optional titles apply only to new entries. Preview and role settings dialogs are stable siblings across responsive layout/context changes, with a live busy/lifecycle guard for double-click, Escape, backdrop, header and async completion. Failed/stale writes retain the edited preview. Actual write/outcome records supply destination controls, selected library items/shared highlights and recorded-project pre-edit version recovery.

Capabilities are separate from model readiness. Missing `assistant.capabilities.execute/write` gates those new actions and shows `完整退出并重新打开 Harness 后加载新版执行能力`; discussion and legacy preview remain usable when their APIs/models are ready. The client never restarts Harness automatically.

## Episodes and recoverable project trash (0.6)

`GET /api/state` adds independent `capabilities.episodes:true` and `projectTrash:true`, including when no model is connected. Shared browser-safe helpers are `isEpisodic(project)`, `projectEpisodes(project)`, `sceneEpisodeId(project,scene)`, `episodeScenes(project,episodeId,{includeArchived=false}={})`, `episodeLabel(project,episodeId)` and `isProjectTrashed(project)`. Only screenplay kinds 剧集、电视剧、迷你剧、短剧 are episodic; novel kinds never activate episodes. Non-episodic projects project no episodes. Legacy missing/empty episode arrays project a stable project-owned virtual first episode, `{id:'episode_legacy_'+project.id,title:'第1集',summary:''}`, without writing defaults during reads. New series have one stored first episode. Relevant explicit scene/view/episode/kind writes materialize that first episode and assign unassigned legacy scenes without changing their text.

Episodes are ordered `project.episodes:[{id,title,summary}]`; scene and view ownership add `episodeId`. Actions:

```js
{type:'episode.add',projectId,episode:{title?,summary?}} // result:{episodeId}; defaults 第N集 / empty summary
{type:'episode.update',projectId,episodeId,patch:{title?,summary?}}
{type:'episode.reorder',projectId,episodeIds} // exact complete permutation
{type:'scene.add',projectId,scene:{episodeId?, /* existing fields */}}
{type:'scene.update',projectId,sceneId,patch:{episodeId?, /* existing fields */}}
{type:'view.save',projectId,view:{episodeId?,sceneId?, /* existing fields */}}
```

IDs must belong to this project. Scene moves retain IDs/prose and invalidate prior revision-based suggestions. Explicit selected scene/episode must match; a scene-only view derives its episode, while an episode-only switch clears an incompatible selected scene. Direct scene creation defaults to the selected owned episode, otherwise the first. Changing kind preserves dormant episodes and scene/view ownership. Snapshots, old-version restores, full/named JSON imports and exports retain ordered ownership. Restoring a pre-episode snapshot clears stale current metadata and coherently materializes one first episode. Fountain, HTML and DOCX emit episode headings in episode order; each episode starts its own grouping boundary. Imports/persistence reject malformed or foreign stored IDs without committing partial state.

Assistant `context.episodeId` is accepted only for episodic `scenes/script`; it must be owned and match an optional scene. Omission captures the scene's episode or selected/first episode. Their scene outlines are scoped to that episode; legacy scene AI outlines are scoped to the scene's episode. AI `scene.add` omissions bind to captured ownership before application, including execute additions originating on other project pages, never to a later live view. `ui.navigate` additionally accepts an owned `episodeId` on episodic `scenes/script`; navigation freshness compares captured episode as well as existing guards. Legacy screenplay five-part and novel six-part context keys stay unchanged; episodic scene/script keys append `'episode',episodeId` to the five screenplay parts (seven total).

Project history import continues to ignore caller-supplied `contextKey` and rebuild from validated ownership; no untrusted executable key is restored. Explicit history episode IDs must be owned; the exact old virtual first ID remaps to the copied project's first episode. Inert historical contexts retain their recorded episode after a scene move or kind change. Existing trusted persisted thread keys are read unchanged, without migration. All imported proposals remain read-only with no executable actions/fingerprint. The frontend separately validates typed seven-part recovered draft keys.

```js
{type:'project.trash',projectId}
{type:'project.restore',projectId}
```

Trash sets an ISO timestamp `trashedAt`, keeps original status and every creative/history collection, removes all its open tabs, and clears active project navigation to overview. Restore removes only the marker, keeping status. Repeated trash/restore rejects with HTTP 409 (`PROJECT_TRASHED` / `PROJECT_NOT_TRASHED`). Missing markers retain legacy behavior. There is no permanent delete. Archive remains an independent status. Full JSON import creates a restored new copy; imported proposals stay inert.

Normal project access rejects trashed projects with HTTP 409 `PROJECT_TRASHED` and a restoration message. This includes ordinary writes, legacy/rewrite/reply/revision adoption and project navigation. Narrow internal `getProject(state,id,{includeTrashed:true})` access is reserved for restore and trash validation/recovery. Workspace page `trash` uses the matching mode's management persona and only that mode's trashed metadata, without manuscripts. Normal global lists/context/projectIndex/fingerprints exclude trash. Trash fingerprints use its owned metadata set; normal global fingerprints still protect creative content against stale writes. Overview/projects permit `project.trash`; trash permits `project.restore`. These actions use the same original/simulated authority validation, source freshness, atomic apply, pre-edit versions, single application and actual execution receipts as existing operations. Execute navigation preservation cannot resurrect trashed tabs.

`GET /api/assistant` adds `operations:{[page]:{execute:[{type,title,description}],manage:[...]}}`, derived from the actual page allowlists. It preserves execute/write/navigate flags and all twelve roles/thirteen presets. Episode descriptions identify series-only capabilities; prompts omit episode actions for films/novels, and actual domain validation refuses them. System guidance explains trash, restore, archive and unsupported permanent deletion. Trash discussion has no manuscript reply-write target.

Episode reorder/import refinements: `scene.reorder` accepts optional `episodeId`. When present, `sceneIds` must be the exact permutation of that episode's complete scene set, including archived scenes. Only its existing global array positions are replaced; every other episode's order and positions remain untouched. Without it, direct actions retain the legacy whole-project permutation contract. Episode-context assistant requests bind omitted reorder ownership to the captured episode and reject explicit episode mismatches. Their schema describes the current episode's complete set.

Reentering an episodic kind reconciles the selected scene's owned episode before persisting while retaining dormant episode metadata. Inert imported historical episode references may be proven by current metadata or retained version snapshots, so rolling back to fewer episodes does not make a full backup unimportable. Arbitrary foreign history IDs still reject atomically. Projected virtual IDs remap to the copy; IDs already materialized in current or retained metadata retain that stored identity.

## Evidence-based doctor diagnosis

Doctor routes are separate from ordinary assistant calls. `server/doctor-guidance.mjs` selectively adapts the supplied `script-writing-studio` 02 diagnosis, 03 dialogue, and 01b rhythm methods. Source paths are captured in each report; original bytes and SHA256 values are archived in `docs/skill-handoff/2026-11-13-script-writing-studio/manifest.json`, with adaptation decisions in `docs/skill-handoff/ADOPTION.md`. The complete source bundle is never injected into a model request. Ordinary assistants retain their original prompts. Writer profile preferences and enabled Skills remain in diagnosis context, subject to the doctor's fixed read-only/JSON boundary and the same total input budget. Novel diagnosis is an explicit project adaptation of the evidence method, not a claimed upstream novel module.

```js
GET /api/doctor?projectId=PROJECT_ID // {reports:[...]}; no writes/model calls
POST /api/doctor
{projectId, mode:'general'|'rhythm'|'dialogue'|'continuity'|'motivation'|'foreshadow'|'suspense', scope:'scene'|'episode'|'project',
 sceneId?, episodeId?, platform?:string, rhythm?:string, targetDuration?:string,
 modelSelection?:{provider,model}|null}
// GET returns {reports,bible,capabilities:{storyBible:true,continuity:true,craftChecks:true}}
// POST returns {state,report,bible,capabilities:{storyBible:true,continuity:true,craftChecks:true}}
POST /api/doctor/handoff
{projectId,reportId,issueId} // returns {state,note,reportId,issueId}
```

`scene` requires exactly an owned active `sceneId`; `episode` requires exactly an owned `episodeId` on an episodic screenplay; `project` accepts neither. Target prose is limited to scoped active scenes and their complete bodies. Every request additionally captures a deterministic story-bible snapshot of the saved brief, adopted characters/materials and all active scene/episode outlines. The user prompt sends its derived Markdown once instead of duplicating adopted character/material bodies. Continuity and the three craft modes additionally select bounded active cross-scene prose from this same project; general, rhythm and dialogue diagnosis do not send other bodies. No request includes another project's data. Empty material rejects; broad scope explicitly means all *currently available* material, and the model must report incomplete manuscript coverage. Archived/trashed projects and archived scene targets reject. Missing platform/target duration is allowed; absence of a reliable scene time axis means exact seconds are unknown. A target total duration cannot establish event timestamps or platform rules. Short dramas and explicit platforms receive compact rhythm guidance. No rating, market outcome guarantees, fabricated professional credits, video-generation parameters or publishing actions are supported.

The model returns only `{summary,limitations:string[],disagreement,nextStep,issues:[{priority:'high'|'medium'|'low',reviewer,title,impact,suggestion,evidence:{sceneId,selection:{start,end,text}}|null,certainty?:'conflict'|'needs-context'|'supported'|'suggestion',basis?:[{referenceId,quote}]}]}`. Every anchor must reference a scene in the captured scope, with exact UTF-16 range and quote equal to the full captured `body.slice(start,end)`; invalid/foreign quotes or extra action fields reject the entire output with `INVALID_DOCTOR_OUTPUT`. Issues may be empty on insufficient material; unanchored summary issues are readable but cannot transfer. Inputs above 120,000 JavaScript characters (system plus complete serialized user context) reject with `DOCTOR_CONTEXT_TOO_LARGE` before model invocation, without truncating any source. Output is limited to 500,000 UTF-8 bytes and 30 issues. Each project permits one diagnosis request at a time (`DOCTOR_BUSY`), with cancellation/disconnect and a 120-second abort signal. The explicit model is captured before asynchronous source reads and passed through the existing model adapter; it never silently falls back.

Reports append to `project.doctorReports` without changing manuscript bodies or requiring a pre-edit version. They retain captured source, scope/options, selected model, method provenance and a SHA256 source fingerprint. Source freshness compares the complete relevant captured project/scene/reference data again; mutation during generation creates an already-stale report, and later mutation makes the readable report stale. `GET` adds derived `status:'current'|'stale'` and `readOnly`. Imported full JSON backups validate report shape, exact source evidence, source fingerprint and owned scene IDs, remap report/issue IDs, and remain permanently read-only. Reports are preserved through full JSON export/import; manuscript version snapshots remain creative-content snapshots. Ordinary UI reloads never replay handoffs. Handoff authority is additionally process-local: reports generated by an earlier backend process remain readable after restart, but require a fresh diagnosis before further transfers. Imported IDs and serialized flags cannot grant this authority.

Explicit handoff is a single serialized state transaction: validate report/project/issue ownership, trusted generation, current source and unused issue receipt, then call the existing exact-selection `reviseNote` pipeline and record the note ID. It never invokes AI or modifies prose. Identical current open note ranges merge directions into one note while preserving the author's instruction and incrementing the note version; partial overlaps or stale overlapping notes reject with `OVERLAPPING_DOCTOR_OPINION` without partial changes. Repeated issue transfers reject with `DOCTOR_ALREADY_HANDED_OFF`. Stale/imported/history-only reports and unanchored issues cannot transfer. The normal collapsed assistant opinion group then supports the existing single send, exact-range rewrite and pre-edit version flow.

The doctor modal is opt-in from the writer or project brief. Its stable controller captures project, context, options and the shared real model before awaits, guards manual editors and unsaved opinion drafts, and flushes author drafts under existing locks. Generation releases the short source lock; subsequent edits are handled by server freshness checks. Handoff holds the target lock through its request. Replies never open the assistant, navigate, switch projects, or write automatically. Busy dismissal is guarded, failures retain options/reports and display an error, and an older backend 404 explicitly asks for a full Harness reopen while ordinary writing remains usable. Existing assistant popup, blue entries and native dragging semantics are preserved.

### Story bible and continuity (0.8.0)

`source.bible` is a deterministic `{schemaVersion:1,title,format,entries,fingerprint,coverage}` snapshot, with stable source IDs and literal saved field values. World canon, adopted characters, external research, ideas and outline plans are distinct. Outline entries cover the complete active work, including episode/volume context. There is no model-based canon inference, second editable source, or automatic mutation of settings. The derived Markdown is available in `bible` / transient `report.bibleDocument`, is rendered as text, and downloads with a safe UTF-8-length-bounded filename. Markdown viewing/export performs no model calls or state writes. Reports retain the exact snapshot for historical exports. Missing world rules, characters or outline detail are disclosed rather than inferred. Old reports without a bible remain readable with their original freshness scope.

`continuity` adds `{schemaVersion,sourceFingerprint,passages,coverage}`. Selection favors shared cast/names and narrative proximity, retaining full bodies when within a 24,000-character / 24-passage budget; larger works use disclosed head/tail/name-adjacent excerpts. Each passage has exact original `start/end/text`, owned scene ID, revision and stable reference ID. Coverage includes total, covered, complete, excerpt-only and omitted scenes. A full-active-prose fingerprint catches changes even outside selected excerpts. The server appends coverage limitations; absence of detected issues never proves exhaustive consistency.

Issues may add `certainty:'conflict'|'needs-context'` and `basis:[{referenceId,quote}]` (at most three quotes of at most 1,000 UTF-16 characters each). Reference IDs must resolve to the captured bible's literal human rendering, target prose or selected cross-scene passages, with exact substring quotes. Stored titles/kinds are resolved by the server. Every continuity issue requires a certainty; a conflict additionally requires exact target evidence and at least one opposing quote. Missing-context issues remain questions and cannot hand off (`DOCTOR_NEEDS_CONFIRMATION`). The system distinguishes plans from events, world rules from research, and genuine conflicts from lies, dreams, flashbacks, unreliable narration, time shifts or unresolved foreshadowing.

All new reports invalidate on relevant whole-outline/canon changes; continuity reports additionally invalidate on any active prose reference change. Handed-off unchanged doctor instruction blocks are checked before rewrite generation, after generation and before adoption; stale sources reject atomically with `STALE_DOCTOR_OPINION`. An author may explicitly replace the old doctor block with a new instruction, still subject to ordinary note version/range guards. Backup import preserves remapped note provenance while keeping reports permanently read-only and unable to grant new handoff authority. Imported canon comparisons ignore identity-only project-ID prefixes, allowing a fresh explicit send on an unchanged copy while still rejecting later canon edits. Historical MD/source IDs stay unchanged.

The doctor response capability flags gate the new consistency mode; old backends cannot silently claim to consult a story bible. The modal retains its existing request animation, draft protection and explicit diagnosis-to-opinion-to-send workflow. Version 0.8.0 was subsequently installed and restarted under explicit user authorization, with a separate recorded real-model acceptance.

### Craft checks (0.9.0)

`motivation`, `foreshadow` and `suspense` are available for both project formats and all existing valid scopes. Like continuity, they capture bounded same-work cross-scene passages, their truthful coverage and a whole-active-prose fingerprint. The 120,000-character total input limit still rejects before a model call. Captured context and validated basis quotes persist in reports and survive backup import as read-only history; stale handoff/generation/application guards are unchanged. General/rhythm/dialogue retain their original source behavior.

Every craft issue requires `certainty:'supported'|'suggestion'|'needs-context'|'conflict'`. `supported` identifies a text-grounded craft problem, not an objective contradiction; `suggestion` is an optional author choice. Both require exact target `evidence`. `conflict` additionally requires opposing `basis`, as before. Missing classifications and unanchored supported/suggestion claims reject the whole output. Missing-context questions may be unanchored and cannot hand off. Labels are retained in assistant opinion instructions, including suggestions' author-choice boundary. Old modes keep their original allowed certainty values and legacy archives remain valid.

Guidance separately covers goal/obstacle/choice/cost, explicit payoff commitments versus future plans and missing material, and reader/character knowledge, fair clues and reveal order. Intentional concealment, unfinished endings, delayed planned payoffs, irrational choices and dramatic irony are not automatically mistakes. Novel adaptation respects internal narration and POV; screenplay adaptation considers visible/audible/performable information and episodic context. These are curated product adaptations of existing doctor principles, not newly found upstream skills or guarantees of literary quality.

GET and POST advertise `capabilities.craftChecks:true`. The controller rejects unsupported craft modes before source flush or request, the dropdown disables them, and a retained unsupported selection shows an update message. No fallback to a different diagnosis occurs. The existing popup, pending animation and explicit collapsed-opinion workflow are reused. This implementation does not install, restart the host, call live models for acceptance or push upstream; those states must be reported separately.

Version 0.9.1 appends an explicit single-specialty output boundary after the shared comparison instructions for all craft modes, includes it in the 120,000-character budget, and records guidance v4. This addresses observed live-model scope drift without weakening evidence validation or changing manuscript permissions.

Version 0.9.2 resolves model offset drift for newly generated craft issues only: an otherwise well-formed integer range within the owned target body may be relocated to the unique literal occurrence of its nonblank quote in that same body. No fuzzy matching, whitespace normalization, other-scene search or out-of-range repair is allowed. Exact coordinates are retained as before, including valid repeated text. Ambiguous/absent quotes and malformed ranges reject. Archive parsing disables relocation and remains strict; canonical evidence and ordinary freshness/write guards are unchanged. This was verified by replaying an actual rejected Terra response (115..119 for “本部完。”) against old/new parsers; the exact source range is 116..120. Guidance provenance is v5.

Version 0.9.3 changes the model-output contract for the three craft checks to `evidence:{sceneId,quote}` or null. The quote must be a nonblank, unique, literal substring of that owned target body; the server derives and stores canonical `{sceneId,selection:{start,end,text}}`. It never searches another scene or normalizes/fuzzes text. Both quote and selection in one evidence object reject. Legacy selection-shaped craft responses remain compatible with 0.9.2 rules. General/continuity/dialogue/rhythm retain their previous wire contract. Archives only accept canonical selection-shaped evidence, so no import can gain quote-resolution authority. Existing exact revision anchors and stale guards remain unchanged. Guidance version is v6.

Version 0.9.4 aligns the illustrative JSON contract with the required craft fields: `certainty` is an independent property, with the complete enum in the example, and `basis` is explicitly an array of exact reference quotes (empty when unused). A captured real response had written `certainty: supported` only inside impact prose and was correctly rejected. The parser still rejects missing certainty; it does not infer authority from explanatory text. Guidance provenance is v7.
