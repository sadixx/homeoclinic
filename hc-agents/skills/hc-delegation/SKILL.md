---
name: hc-delegation
description: Tool-neutral delegation and handoff protocol for the hc-* agent pack. How a role invokes another role with native subagents (Kiro, Claude Code, Copilot, MeshClaw) or, in any AI tool without subagents, by explicit role switching, plus the handoff file format and the rules that keep reviewer roles independent. Read before delegating or returning work.
---

# hc-delegation: How roles call each other in any AI tool

The pack defines roles (`agents/<role>/SKILL.md`) and who may call whom
(each role's "Delegation" section and its `metadata.hc-spawns`). This file
defines HOW, independent of the tool.

## Pick the mode your tool supports

| Mode | Use when | How |
|---|---|---|
| A. Native subagent | The tool can start a child agent with its own instructions | Start the child with the role file as its instructions, pass the Task String (below). Examples: Kiro `subagent` / `--agent hc-<role>`; Claude Code subagents in `.claude/agents/`; GitHub Copilot custom agents in `.github/agents/`; MeshClaw `spawn_run`. |
| B. Parallel team | The tool supports persistent named agents with shared tasks | Same as A, but keep members alive across rounds (architect <-> unit-tester negotiation, e2e cell). |
| C. Role switching | Any chat or IDE tool without subagents (ChatGPT, Gemini, Cursor chat, Copilot chat, Codex without agents, a plain API) | One agent plays each role in turn, following the protocol below. |

If the tool supports A but forbids nested delegation (a child cannot start
its own child), the nearest ancestor that CAN delegate starts the
grandchildren itself, following the intermediate role's procedure
exactly. Example: in Claude Code, `hc-leader` drives the `hc-e2e-*` cell
directly by following `agents/hc-e2e-orchestrator/SKILL.md`.

Never use a mode to bypass the allow list: a role may only call the roles
listed in its own Delegation section, whatever mechanism is used.

## Task String (always passed to the callee)

```
role: <callee role name>
task-id: HC-MVP1-047
worklog-dir: <HC_REPO>/.worklog/HC-MVP1-047/
component-dir: <crate or UI module path>
output-dir: <where the callee writes artifacts>
input: <what to do, in one paragraph>
inputs-files: <paths the callee must read, e.g. original-prompt.md, diff path>
```

## Handoff files

Every call, in every mode, leaves a file trail so the work is resumable in
any tool and auditable by a human:

```
<worklog-dir>/handoffs/<NN>-<caller>-to-<callee>.md   request (the Task String)
<worklog-dir>/handoffs/<NN>-<callee>-result.md        result
```

`NN` is a two-digit sequence across the task. The result file starts with:

```
role: <callee>
status: done | blocked | failed
summary: <one line>
artifacts: <paths>
```

followed by the role's own required output (findings JSON, verdict table,
completion report, etc.).

## Mode C: role switching protocol

1. Announce the switch in one line: `=== ROLE: hc-unit-tester (handoff 03) ===`.
2. Read the callee's role file and its Required reading. From now until
   you switch back, ONLY that role's "You Own" and "You NEVER" apply. The
   caller's permissions do not carry over (e.g. while acting as
   `hc-code-reviewer` you must not edit files even though `hc-dev` could).
3. Do the work using only the inputs in the request file.
4. Write the result file.
5. Announce the switch back: `=== ROLE: hc-leader (resume after 03) ===`
   and continue the caller's procedure from the result file, not from
   memory of the work.

The leader's "never read source code" rule applies only while acting as
`hc-leader`.

## Independence rules (critical in mode C)

Reviewer and judge roles (`hc-code-reviewer`, `hc-guidelines-reviewer`,
`hc-requirements-reviewer`, `hc-e2e-analyzer`, `hc-release-gate`) must not
grade their own work. In order of preference:

1. Run them in a fresh session / fresh chat / separate model with only the
   request file and the diff.
2. If that is impossible, run them as a role switch but give them only the
   request file inputs, and state in `report.md`: "review performed in the
   same context as implementation (reduced independence)".

## Human checkpoints (every mode)

Stop and ask the human when a role reports `status: blocked`, when a
blocking scoping gap exists, before any push, and before any release
step. The tool's own approval prompts are in addition to these, never a
substitute.
