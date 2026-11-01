# Reminder task register
Design version: 1.1.0. API: manual v1 + additive assistant v1.
Initial baseline: 4b7592e7dd0e9fe49c8e0b0a014830a31682272d. Frozen BE/IPC baseline for CC: ab8d214892344be0639d2c801203c01587fa9b6d. Full task package: docs/handoffs/REM-001-FE.md. Target branch: main.

| ID | User outcome / scope | Owner | Dependency | Allowed paths | Acceptance / state |
| --- | --- | --- | --- | --- | --- |
| REM-001-BE | Manual tasks and preferences survive restart | Codex | Shared design/API v1 | packages/backend/**, packages/contracts/**, docs/**, root tooling, .github/** | Implemented; 15-test suite and independent review fix passed |
| REM-001-IPC | Renderer can call safe local backend | Codex | REM-001-BE | apps/desktop/main/**, backend tests | Real Electron/IPC/SQLite and restart passed in Windows CI 41271445062 |
| REM-001-FE | Add/list/edit/complete/reopen, undo, language settings | CC | Published BE/IPC baseline above | apps/desktop/renderer/** | PR #2 head 7bea041 reviewed and merged as d7ae2e4; 58 mock tests and real desktop checks passed |
| REM-001-INT | Complete Windows application loop | Codex | CC PR + BE | integration tooling/docs, coordinated fixes | Source desktop loop passed on ae93769; CI workflow/evidence delivered in PR #3; installer/release excluded |
| REM-001-FE-01 | Accurate settings conflict feedback when reload fails | CC | REM-001-FE; planning baseline cd1eaa070fa03b045998c91d513020055f3dc664 | apps/desktop/renderer/** | Complete: PR #5 head 8aef54c reviewed and merged as 505f886; 64 renderer tests, combined desktop CI 41273495145 passed. Conflict failure path is fixture-tested; API v1 unchanged |
| REM-001-INT-01 | Isolated desktop tests and reproducible dependency install | Codex | REM-001-INT; baseline e26220c1af15fee913b97dbc385ed5287fd332f1 | apps/desktop/main/**, tools/**, packages/backend/test/**, root tooling, docs/**, .github/** | Real dual-profile/lock probe, cleanup and desktop E2E passed run 41272786937; root lock adopted from npm output; final npm ci and all checks passed run 41273019591; PR #4 merged |
| REM-001-BE-01 | Preserve data during actual storage failure | Codex | REM-001-BE; baseline e26220c1af15fee913b97dbc385ed5287fd332f1 | packages/backend/**, tools/**, docs/**, .github/** | Actual VHD ENOSPC for create/update/settings, actual ACL denial, unchanged data/revisions and recovery passed run 41272786937; API v1 unchanged |
| REM-001-INT-02 | Ensure the desktop test command reports child failures | Codex | Baseline 505f886ed295ddb2f56dc07f52196874cefa51a7; API v1 unchanged | tools/**, packages/backend/test/**, docs/** | Deferred minor: add an executable-boundary regression that fails if root process.exitCode propagation is removed; current implementation reviewed correct and helper/child tests pass |
| REM-002 | Bilingual natural-language tasks | Codex + CC | REM-001-INT; baseline 9db390c; planning d2ec9a8 | See plan and cards below | In progress; backend PR #8, renderer PR #7, integration draft #9; live provider pending |
| REM-003 | Explicit, reliable reminders | Codex + CC | REM-001-INT | Future card | Running/closed/sleep verification required; not started |
| REM-004 | Deadline-respecting scheduling | Codex + CC | Task/time model | Future card | Not started |
| REM-005 | Recurrence instances | Codex + CC | Task/reminder model | Future card | Not started |
| REM-006 | Accounts and sync | Codex + CC | Sync design | Future card | Not started |
| REM-007 | Voice, screenshots, Windows sharing | Codex + CC | Capability validation | Future card | Not started |

## REM-002 cards
All cards use baseline `9db390c6cd37276845375c9768c8f17c49af3fc5`, shared design v1.1.0, `packages/contracts/api-v1.d.ts`, `docs/api-v1.md` and `docs/superpowers/plans/2026-11-01-rem-002.md`. Target: main.

| ID | User result / scope | Owner | Dependency | Allowed paths | Acceptance / state |
| --- | --- | --- | --- | --- | --- |
| REM-002-BE-01 | Atomic changes, durable replay and whole-batch undo | Codex | Existing store | packages/backend/** | Implemented with real SQLite and schema migration tests |
| REM-002-BE-02 | Bounded, sanitized DeepSeek protocol adapter | Codex | Shared contract | packages/backend/** | Fixture protocol/error/timeout tests pass; live key required for provider acceptance |
| REM-002-BE-03 | Bilingual receipts, safe target/time clarification | Codex | BE-01/02 | packages/backend/** | Interleaved DST choices and stale task snapshots regression-tested |
| REM-002-IPC | Encrypted local key and restricted assistant methods | Codex | BE-03 | apps/desktop/main/**, tools/**, backend tests | Passed actual DPAPI/vault restore and IPC/SQLite batch/restart/replay/undo, run 41287530839 at e7a04aaa; backend PR #8 |
| REM-002-FE | Assistant conversation, settings, clarification and undo | CC | Published d2ec9a8 planning contract; PR #8 backend | apps/desktop/renderer/** | PR #7 head 7f92769 blocked on whitespace duplicate-send and stale-choice lost-response defects; review 5727069372; awaiting CC fix |
| REM-002-INT | Complete natural-language task loop | Codex | Backend + reviewed CC head + configured key | tools/**, docs/**, .github/** | Draft #9 combines sources; fixture integration and live-provider evidence kept separate |

Order remains REM-002 -> REM-003 -> REM-004 -> REM-005. Do not mark later capabilities implemented based on model prose. Reminder acceptance must explicitly distinguish running/background/closed/sleep conditions.

All first-slice cards refer to docs/superpowers/specs/2026-10-31-reminder-design.md, packages/contracts/api-v1.d.ts, docs/api-v1.md, and docs/superpowers/plans/2026-10-31-rem-001.md. Frontend review is anchored to PR #2 head 7bea04129b8a8999868253b47cb55b2911c343fd. Source integration evidence is recorded in docs/verification/rem-001.md.

Known follow-ups: read-only dispatcher null-parameter validation, native date-picker OS locale, and executable-boundary coverage for the root test runner's exit code (REM-001-INT-02). Real Electron serialization, frontend integration, isolated test profiles and actual backend ACL/disk-full checks now pass. Root dependency lock is committed in PR #4 and verified through its final npm ci gate. Packaging, installation/upgrade/uninstall and release validation remain future work. The REM-001 manual-task source loop is accepted; no installable release is claimed. Detailed hardening evidence: docs/verification/rem-001-hardening.md.
