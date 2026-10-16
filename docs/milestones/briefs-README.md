# Release briefs index (HC-MVP1-006)

Ten self-contained briefs, one per release, in release order R0 to R9. Each
brief carries its own doctor outcome, scope, task ids, screens, verbatim demo
script, requirement ids, out-of-scope and entry/exit criteria. The
authoritative release plan, release table and demo scripts live in
[`README.md`](README.md) (not overwritten by this task).

| Brief | Release | Milestone(s) | Doctor outcome (one line) |
|---|---|---|---|
| [R0-brief.md](R0-brief.md) | R0 Walking skeleton | M0 | Install, open the app, see the shell, nav and an empty Today. |
| [R1-brief.md](R1-brief.md) | R1 Set up and protect | M1 | Run first-run wizard (dev trial), lock/unlock with PIN, back up to USB and restore. |
| [R2-brief.md](R2-brief.md) | R2 Patient register | M2 | Register patients with photo, find anyone instantly, open dashboard, edit, recycle bin. |
| [R3-brief.md](R3-brief.md) | R3 Paper replacement | M3 | Take a full case, record follow-ups, see who is due today. |
| [R4-brief.md](R4-brief.md) | R4 Consultation complete | M7 | Prescribe, print A5 or letterhead, save PDF, share on WhatsApp. |
| [R5-brief.md](R5-brief.md) | R5 Clinic Basics | M8 | Bill, take partial payment, see dues, daily collection report (early-pilot build). |
| [R6-brief.md](R6-brief.md) | R6 Repertory reading | M4 + M5 | Search rubrics, browse repertory, read Materia Medica (internal build). |
| [R7-brief.md](R7-brief.md) | R7 Repertorisation | M6 | Send symptoms from case, analyse, prescribe from result, cite. |
| [R8-brief.md](R8-brief.md) | R8 Licence and purchase | M9 | Trial, Buy with UPI QR, import licence, expiry goes read-only. |
| [R9-brief.md](R9-brief.md) | R9 Release candidate | M10 | Everything above on the hardened, signed build (all 13 acceptance flows). |

## Why releases, not per-milestone files

The backlog's original task HC-MVP1-006 asked for one brief per milestone
(M0 to M10, 11 files). That shape predates
[ADR-0002](../adr/0002-working-software-every-milestone.md), which regroups the
milestones into releases so a complete consultation comes first. The key
consequences:

- Milestone build order changes to `M0 -> M1 -> M2 -> M3 -> M7 -> M8 -> M4 -> M5 -> M6 -> M9 -> M10`.
- Each milestone ends in a release `R<n>`, and **R6 spans two milestones (M4 + M5)**,
  so the eleven milestones collapse to ten releases.

Per the leader decision, these briefs are authored **per release (R0 to R9)**,
each stating its milestone mapping:

| Release | Milestone(s) |
|---|---|
| R0 | M0 |
| R1 | M1 |
| R2 | M2 |
| R3 | M3 |
| R4 | M7 |
| R5 | M8 |
| R6 | M4 + M5 |
| R7 | M6 |
| R8 | M9 |
| R9 | M10 |

## Demo scripts are the E2E regression gate

Each brief copies its release's demo script **verbatim** from
[`README.md`](README.md). Per **R-DEL-005**
([`docs/rules/delivery.md`](../rules/delivery.md)), a milestone counts as done
only when its demo script runs as an E2E spec tagged `@tier regression` and
passes on Windows and Linux, together with every earlier demo. From R1 onward,
an upgrade install over the previous release must open its data
(**R-DEL-004**), verified by the upgrade-path harness HC-MVP1-226.
