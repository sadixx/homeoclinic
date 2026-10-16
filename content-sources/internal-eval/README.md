# INTERNAL EVALUATION CONTENT: DO NOT DISTRIBUTE

Files in this folder are for team testing of the repertory engine only. They must never be included in a public build, installer or download (CONT-003, CONT-005). Licences and permission status are tracked in `../REGISTRY.md`.

## oorep/

- `oorep.sql.gz`: PostgreSQL dump from github.com/nondeterministic/oorep (commit ac6dbb00ba60), downloaded 2026-10-15. Contains repertories `publicum` (English) and `kent-de` (German), Boericke materia medica, and the remedy list. User/account tables in the dump are empty and are ignored by the importer.
- `LICENSE-GPL-3.0.txt`: licence of the OOREP repository.
- `SOURCE_COMMIT.txt`: upstream commit the dump was taken from.
