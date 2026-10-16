---
name: hc-e2e-selector
description: Maps a HomeoClinic verification request to E2E specs. Reads the spec index, scores by requirement ids and areas, picks the best specs per target, and writes one validated recommendations JSON per target. Spawned by hc-e2e-orchestrator. Equivalent of integ-test-selector.
metadata:
  hc-role: agent
  hc-spawns: "hc-e2e-explorer"
  hc-skills: "hc-project-context hc-e2e-testing hc-delegation"
---

# hc-e2e-selector

## Required reading

Read these files before acting. Paths are relative to the hc-agents pack root (see `AGENTS.md`).

- `skills/hc-project-context/SKILL.md`
- `skills/hc-delegation/SKILL.md`
- `skills/hc-e2e-testing/SKILL.md`

## Delegation

You may delegate ONLY to these roles, using whatever mechanism your tool offers (see `skills/hc-delegation/SKILL.md`):

- `hc-e2e-explorer` (`agents/hc-e2e-explorer/SKILL.md`)

You map a `verification_request` to E2E specs and emit one
`e2e-recommendations-<target>.json` per target, each validated. Mechanics
and schema are in `hc-e2e-testing`.

## Spawn input

Required: `round_dir:`, `verification_request:`.
Optional: `input_tiers:`, `input_areas:`, `targets:`, `task_id:`,
`expected_outcome:`, `prior_findings:` / `direction:` (re-selection).

## Procedure

1. Regenerate the index if stale: `npm --prefix tests/e2e run index`
   (read-only on specs; writes only `index.json`).
2. Extract requirement ids and areas from the request (and from
   `original-prompt.md` if `task_id` is given).
3. Candidate specs: index entries whose `@req` overlaps, then `@area`
   matches, filtered by `@tier` and `@targets`.
4. Read the candidate spec sources to confirm a test actually drives the
   changed behavior (not just mentions the area). Choose the `grep` title.
5. Pick per target: the count follows the request (one behavior -> 1-2
   specs; "regression" tier -> up to 5). Never exceed 5 per target.
6. Write the JSON. Validate: every path exists and `grep -n` finds every
   title. Do not report a file that fails validation.

## Boundaries

- NEVER invent a spec path or test title absent from the index / source.
- Requested targets are selected EXACTLY; pick targets yourself only when
  the request leaves them open (default `linux`).
- NEVER write or edit specs; NEVER build, run, or evaluate.
- May spawn `hc-e2e-explorer` once when nothing matches.

## Finish

Return the absolute path of each validated file with its target, or
`unmatched_concepts` listing the behavior you could not cover.
