# Content Registry (CONT-006)

Every repertory, materia medica or reference source must have a row here before `content-builder` will build it. Removing a row (and its pack) removes the content; no app code changes.

Channel `internal_eval` = team testing only, never in public builds (CONT-003, CONT-005). Channel `public` = allowed in public releases.

| Pack id | Type | Title / edition | Origin (URL + commit / checksum) | Licence | Channel | Permission status | Imported | Owner |
|---|---|---|---|---|---|---|---|---|
| eval-publicum | repertory | Repertorium Publicum v0.5 (English, Kent-derived), V. Polony 2008 | github.com/nondeterministic/oorep `oorep.sql.gz`, commit ac6dbb00ba60, sha256 0a20753505bd99e1... | GPL-3.0 (OpenRep) | internal_eval | Not cleared for closed-source distribution; legal review needed | 2026-10-15 | Nipun |
| eval-kent-de | repertory | Kent, Repertory of the Homoeopathic Materia Medica, German translation (2012) | same file | GPL-3.0 (OpenRep fork) | internal_eval | Not cleared for closed-source distribution; legal review needed | 2026-10-15 | Nipun |
| eval-boericke-mm | materia_medica | Boericke, Pocket Manual of Homoeopathic Materia Medica (1906) | same file | Not stated in dump; book public domain | internal_eval | Ask OOREP author for permission to use the conversion | 2026-10-15 | Nipun |
| eval-remedy-master | remedy_list | OOREP remedy list (2,432 remedies) | same file | GPL-3.0 (as part of dump) | internal_eval | Legal review needed | 2026-10-15 | Nipun |
| sample-starter | repertory | Hand-made starter sample (5 rubrics x 6 remedies, scoring fixtures) | written by us | proprietary (ours) | public | Cleared | to be created in M4 | Nipun |

## Known but not usable yet

| Source | Why not | What would unblock |
|---|---|---|
| OOREP English Kent (1897), Boger, Boenninghausen TPB, Hering, Roberts, Tyler; Allen, Clarke, Hering MM | Served on oorep.com but "not intended for any further redistribution" (OOREP FAQ) | Written permission from Andreas Bauer (OOREP author) |
| Kent 1897 original scans (public domain) | Needs OCR + proofreading | Content pipeline OCR importer (CONT-009 c) + proofreading effort |
| Synthesis, Complete Repertory, Murphy, Phatak | Copyrighted | Paid publisher licence (MVP2+) |
