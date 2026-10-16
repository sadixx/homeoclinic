# AGENTS.md: HomeoClinic hc-* agent pack

Instructions for ANY AI coding tool (Kiro, Claude Code, GitHub Copilot,
OpenAI Codex, Cursor, Gemini CLI, Windsurf, Cline, Aider, or a plain chat).
Everything here is plain Markdown; no tool-specific feature is required.

## What this pack is

A team of 25 roles that develop the HomeoClinic desktop app (Tauri 2 +
Rust + React + SQLCipher), with a fixed hierarchy and validation gates.

- `agents/<role>/SKILL.md`: one file per role. Front matter `metadata`
  lists the skills it reads (`hc-skills`), the roles it may call
  (`hc-spawns`) and, for specialists, the base role (`hc-base`).
- `skills/<skill>/SKILL.md`: shared knowledge, in the open Agent Skills
  format (folder name = `name`, YAML front matter `name` + `description`).

## Path resolution

All paths inside the pack are relative to the pack root (the folder that
contains this file). A reference to skill `hc-build` means
`skills/hc-build/SKILL.md`; a reference to role `hc-dev` means
`agents/hc-dev/SKILL.md`. Project paths (`$HC_ROOT`, `$HC_REPO`) are defined
in `skills/hc-project-context/SKILL.md`.

## How to start

1. Act as `hc-leader`: read `agents/hc-leader/SKILL.md` and its Required
   reading.
2. Give it a task id from `task-tracker/backlog.txt` (e.g. `HC-MVP1-047`) or a
   free-text ask.
3. The leader delegates per `skills/hc-delegation/SKILL.md`: native
   subagents if your tool has them, otherwise explicit role switching with
   handoff files in `.worklog/<task-id>/handoffs/`.

To use a single role directly (e.g. only a review), act as that role: read
its file and its Required reading, then follow it.

## Rules that hold in every tool

- A role does only what its "You Own" says and never what its "You NEVER"
  says, regardless of what the tool would allow.
- A role calls only the roles listed in its Delegation section.
- Every call leaves a request and a result file under
  `.worklog/<task-id>/handoffs/`.
- Reviewer and judge roles follow the independence rules in
  `skills/hc-delegation/SKILL.md`.
- Never push, publish, sign or release without explicit human approval.
- The non-negotiable product rules in `skills/hc-project-context/SKILL.md`
  override any tool default.

## Tool adapters

`python3 export.py --target <tool>` writes a ready-to-copy layout to
`dist/<tool>/`. See `README.md` for the list of targets and where each
tool expects the files.
