# HomeoClinic documents

End-user documentation for HomeoClinic.

## user-guide/

Step-by-step "how to use" guides for doctors, one per release.

### Cumulative convention

Each release's guide is **cumulative**: it contains everything from the
previous releases plus the new features of that release.

| Guide | Covers |
|---|---|
| `HomeoClinic-User-Guide-R1.md` / `.pdf` | R0 + R1 (M0 + M1) |
| `HomeoClinic-User-Guide-R2.md` / `.pdf` | R0 + R1 + R2 (M0 + M1 + M2) |
| `HomeoClinic-User-Guide-R3.md` / `.pdf` | R0 + R1 + R2 + R3 (M0 + M1 + M2 + M3) |
| `HomeoClinic-User-Guide-R5.md` / `.pdf` | R0 to R3 + Settings (MS) + R5 Clinic basics (M8); development build, R4 not yet built |
| `HomeoClinic-User-Guide-R4.*` (future) | adds R4 prescriptions and printing |
| ... | ... |

When a new milestone ships, copy the previous edition to the new release
name, append the new milestone's sections, and rebuild the PDF. The PDF is a
generated artifact; the `.md` file is the editable source of truth.

### Rebuilding a PDF

```
python3 documents/user-guide/build_guide.py \
    documents/user-guide/HomeoClinic-User-Guide-R1.md
```

Requires `python3` with the `markdown` package and `wkhtmltopdf` (both in the
dev environment; see `docs/dev/environment.md`). The script renders
Markdown → styled HTML → PDF and writes `<name>.pdf` next to the `.md`.
