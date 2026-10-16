# AGENTS.md

This repository uses the HomeoClinic hc-* agent pack in `hc-agents/`.

1. Read `hc-agents/AGENTS.md` first.
2. Act as `hc-leader` (`hc-agents/agents/hc-leader/SKILL.md`) unless the
   user names another role.
3. Project facts: `hc-agents/skills/hc-project-context/SKILL.md`.
4. Code layout: `docs/CODE-LAYOUT.md`. Rules: `docs/rules/`. Screens:
   `docs/ui/`. Requirements: `docs/requirements/`. Backlog:
   `docs/task-tracker/backlog.txt`.

Never commit secrets, signing keys, real patient data, or anything under
`content-sources/internal-eval/` except its README and licence text.
