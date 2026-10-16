# HomeoClinic MVP1 Architecture Design

Open `index.html` (fully static, works from disk) for the review version with all diagrams inline.

| Doc | Content |
|---|---|
| 01-legacy-analysis.md | What the existing 2018 Doctor Clinic app is, its data model, its problems, what to keep |
| 02-architecture-overview.md | Context, containers, components, threading, deployment, security, ADRs |
| 03-repertory-engine-design.md | Rubric search, scoring engine, pack format, content pipeline, citations, UI |
| 04-licensing-payments-design.md | MVP1 offline UPI QR + WhatsApp + emailed signed licence flow, licence formats, identity binding, Vendor Licence Tool, states; MVP2 backend and hosted UPI |
| 05-data-design.md | Conventions, search storage, migrations, backup format, legacy import |
| 06-review-questions.md | Decisions and additions needing your answer |

Diagrams: sources in `diagrams/src/*.puml`, rendered in `diagrams/svg/`. Rebuild everything with `./build.sh`.

Requirements: `../requirements/` (copy of the approved requirement set).
