#!/usr/bin/env python3
"""Render a HomeoClinic user-guide Markdown file to a styled PDF.

Usage:
    python3 build_guide.py HomeoClinic-User-Guide-R1.md

Pipeline: Markdown -> HTML (python-markdown) -> PDF (wkhtmltopdf).
Both tools ship in the dev environment (see docs/dev/environment.md).
This keeps the Markdown file the single editable source of truth; the PDF
is a generated artifact rebuilt whenever the guide changes. The cumulative
convention (R2 = R0+R1+R2, etc.) is handled by the Markdown content, not
this script.
"""
import subprocess
import sys
from pathlib import Path

import markdown

CSS = """
@page { size: A4; margin: 20mm 18mm; }
body { font-family: 'DejaVu Sans', 'Noto Sans', Arial, sans-serif;
       font-size: 11pt; line-height: 1.5; color: #1a1a1a; }
h1 { font-size: 22pt; color: #0b5; border-bottom: 2px solid #0b5;
     padding-bottom: 4px; }
h2 { font-size: 15pt; margin-top: 22px; color: #084; }
h3 { font-size: 12.5pt; margin-top: 16px; color: #222; }
code { background: #f2f2f2; padding: 1px 4px; border-radius: 3px;
       font-family: 'DejaVu Sans Mono', monospace; font-size: 10pt; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; }
th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left;
         font-size: 10.5pt; }
th { background: #eef7f1; }
blockquote { border-left: 4px solid #0b5; margin: 10px 0; padding: 4px 12px;
             background: #f6fbf8; color: #333; }
hr { border: none; border-top: 1px solid #ddd; margin: 18px 0; }
"""


def build(md_path: Path) -> Path:
    pdf_path = md_path.with_suffix(".pdf")
    html_body = markdown.markdown(
        md_path.read_text(encoding="utf-8"),
        extensions=["tables", "fenced_code", "toc", "sane_lists"],
    )
    html = (
        f"<!doctype html><html><head><meta charset='utf-8'>"
        f"<style>{CSS}</style></head><body>{html_body}</body></html>"
    )
    html_path = md_path.with_suffix(".html")
    html_path.write_text(html, encoding="utf-8")
    try:
        subprocess.run(
            [
                "wkhtmltopdf",
                "--enable-local-file-access",
                "--encoding",
                "utf-8",
                str(html_path),
                str(pdf_path),
            ],
            check=True,
            capture_output=True,
        )
    finally:
        html_path.unlink(missing_ok=True)
    return pdf_path


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: build_guide.py <guide.md>")
    src = Path(sys.argv[1])
    if not src.is_file():
        sys.exit(f"not found: {src}")
    out = build(src)
    print(f"wrote {out} ({out.stat().st_size} bytes)")
