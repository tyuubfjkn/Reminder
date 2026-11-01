# Reminder collaboration
Codex owns product design, contracts, backend, Electron main/preload, root tooling, integration and releases. Claude Code owns renderer and renderer tests.
Read docs/superpowers/specs/2026-10-31-reminder-design.md and packages/contracts/api-v1.d.ts before implementation. Contract version: 1.0.0.
Use independent checkouts and short-lived branches. Target main through PRs. Never switch branches in another agent's directory.
Task cards live in docs/tasks.md. CC handoffs live in docs/handoffs/. Only Codex changes shared contracts; request changes through the PR.
Run npm test for backend changes. Desktop integration and packaging require separate evidence; never report mocks as real persistence.
No secrets, databases, generated dependencies or build outputs in Git. Preserve LICENSE.
Use Superpowers when installed; report unavailable skills honestly.
