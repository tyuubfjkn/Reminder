# REM-001 hardening implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task. The user delegated implementation and authorized this cleanup; proceed inline, then obtain independent whole-branch review.

**Goal:** Finish the agreed manual-task cleanup without adding product features.
**Architecture:** Existing local Electron/SQLite and renderer API remain unchanged. Isolate test profiles through the real main entry point; enforce deterministic dependency installation and exercise actual storage failures.
**Tech Stack:** Electron 45.2.1, Node 24.16.0, npm, PowerShell, SQLite, existing React renderer.
**Spec:** docs/superpowers/specs/2026-10-31-reminder-design.md v1.0.1; API v1.0.0.
**Baseline:** e26220c1af15fee913b97dbc385ed5287fd332f1. Target main. Codex branch codex/rem-001-hardening; CC uses a separate checkout/branch.

## Global constraints
- No installer, AI, notifications or schema migration.
- Codex changes main/backend/root tooling/docs/CI; CC changes apps/desktop/renderer/**.
- Never use personal storage or a physical volume for fault injection.
- Preserve saved data, error sanitization and revision checks.

## Review focus
- Invalid profile override must never fall back to personal data (Task 1).
- A second profile must not be blocked by the first profile's lock (Task 1 real probe).
- Child test failure must propagate and cleanup must target only a generated profile (Task 1 runner).
- Full disk can make transaction rollback itself fail; original data and later writes must recover (Task 2).
- A failed settings reload is not a successful refresh; locale stays usable (Task 3).

### Task 1: REM-001-INT-01 isolated profile and locked runtime (Codex)
Files: apps/desktop/main/profile.mjs (new), main.mjs; packages/backend/test/profile.test.mjs (new); tools/run-desktop-e2e.mjs and tools/profile-probe.mjs (new); root package.json/package-lock.json; .github/workflows/desktop.yml; README.md.
Interface: configureUserData(app, override) sets userData/sessionData before lock/ready; returns chosen directory or undefined. REMINDER_USER_DATA_DIR is development-only and absolute. Runner uses a new temporary directory, verifies real Electron paths, launches existing renderer E2E, preserves nonzero exit status, then removes only its own directory.
- [x] Write behavioral tests for default/absolute/relative/empty/packaged/failed-directory creation; run RED.
- [x] Implement minimal profile configuration and wire real main; run npm test GREEN.
- [x] Generate npm lock on network-enabled CI, capture exact bytes; commit and verify npm ci.
- [x] Run real profile probe (including independent simultaneous profiles), full renderer E2E and cleanup failure path on Windows; capture evidence and commit.

### Task 2: REM-001-BE-01 real storage fault validation (Codex)
Files: tools/storage-faults.ps1 and tools/storage-faults.mjs (new), workflow, backend tests/store only if reproduced defects require fixes.
Interface: PowerShell creates/attaches only its unique 64 MiB VHD, validates drive identity, invokes Node probe, restores ACL/detaches in finally. Node operates only in the supplied marked fixture.
- [x] On a temporary database, deny write access; confirm an independent raw write actually fails, openStore returns STORAGE_ERROR, and reopening after ACL restoration preserves contents.
- [x] Fill the dedicated VHD to actual ENOSPC, invoke real task create/update/settings update through dispatcher, assert sanitized failure and no partial revision/content changes.
- [x] Release filler, reopen and compare records/settings; verify a subsequent explicit write succeeds. Run in Windows CI; never label a skipped or simulated test as verified.
- [x] If production fails assertions, record RED, fix only the root cause, rerun whole backend suite and fault test. Commit evidence.

### Task 3: REM-001-FE-01 settings conflict feedback (CC)
Files: apps/desktop/renderer/** only. Consumes unchanged settings.get/update Result contract.
- [x] Publish shared design/plan/handoff first and supply exact commit to CC.
- [x] CC reproduces CONFLICT + failing reload (Result error and thrown promise); localized error says latest settings could not load, old settings remain. Successful reload still adopts latest settings.
- [x] CC runs renderer suite/typecheck/build and PRs to main. Codex reviews concrete head, combines with hardened main, verifies and merges. If CC cannot be called, provide the published handoff for forwarding and accurately leave this task pending.

### Delivery
- [x] Independent review, fix important findings with RED/GREEN evidence, verify final-head CI, merge authorized PR.
- [x] Update docs/tasks.md and docs/verification/rem-001-hardening.md with separate mock/backend/real desktop results and remaining limitations.

## Completion record

Tasks 1–2 delivered in PR #4 (final full CI 41273019591). Task 3 delivered in PR #5 (combined full CI 41273495145). Codex inspected CC's concrete commit; CC's reported RED/mutation evidence is distinct from CI's independently observed GREEN tests. No production storage defect was found, so the conditional backend-fix step required no code change. Deferred non-blocking coverage: REM-001-INT-02. Scope and evidence limits are in docs/verification/rem-001-hardening.md.
