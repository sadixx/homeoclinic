#!/usr/bin/env python3
"""Build the static review site design/index.html (inline SVG, inline CSS, no external deps)."""
import pathlib, re, html
import markdown

ROOT = pathlib.Path(__file__).resolve().parent
DOCS = ["README.md", "01-legacy-analysis.md", "02-architecture-overview.md",
        "03-repertory-engine-design.md", "04-licensing-payments-design.md",
        "05-data-design.md", "06-review-questions.md"]
SVG_DIR = ROOT / "diagrams" / "svg"


def clean_svg(text):
    # Keep viewBox only, scale to column width without distortion.
    text = re.sub(r"<\?xml[^>]*\?>", "", text)
    m = re.search(r"<svg\b[^>]*>", text)
    tag = m.group(0)
    new = re.sub(r'\s(width|height|style|preserveAspectRatio)="[^"]*"', "", tag)
    new = new.replace("<svg", '<svg width="100%" preserveAspectRatio="xMidYMid meet" style="height:auto;max-width:100%"', 1)
    return text.replace(tag, new, 1)


def title_of(svg_name):
    return svg_name[:-4].split("-", 1)[1].replace("-", " ").capitalize()


def doc_html(md_text):
    # Turn diagram path references into in-page links to the figure.
    md_text = re.sub(r"`diagrams/svg/([\w-]+)\.svg`", r"[diagram \1](#fig-\1)", md_text)
    md_text = re.sub(r"`\.\./requirements/([\w.-]+)`", r"`requirements/\1`", md_text)
    return markdown.markdown(md_text, extensions=["tables", "fenced_code"])


def main():
    nav, body = [], []
    for d in DOCS:
        sid = "doc-" + d[:-3]
        text = (ROOT / d).read_text(encoding="utf-8")
        h1 = re.search(r"^# (.+)$", text, re.M).group(1)
        nav.append(f'<a href="#{sid}">{html.escape(h1)}</a>')
        body.append(f'<section id="{sid}">{doc_html(text)}</section>')
    nav.append('<a href="#diagrams"><b>Diagrams</b></a>')
    figs = []
    for svg in sorted(SVG_DIR.glob("*.svg")):
        stem = svg.stem
        nav.append(f'<a class="sub" href="#fig-{stem}">{html.escape(title_of(svg.name))}</a>')
        figs.append(f'<figure id="fig-{stem}"><figcaption>Figure {stem[:2]}: {html.escape(title_of(svg.name))}'
                    f' <span class="src">(source: diagrams/src/{stem}.puml)</span></figcaption>'
                    f'{clean_svg(svg.read_text(encoding="utf-8"))}</figure>')
    body.append('<section id="diagrams"><h1>Diagrams</h1>' + "".join(figs) + "</section>")

    css = """
    body{margin:0;font:15px/1.55 system-ui,Segoe UI,Roboto,sans-serif;color:#1d2433;background:#fff}
    nav{position:fixed;top:0;left:0;bottom:0;width:270px;overflow:auto;background:#f4f6fa;border-right:1px solid #dde3ec;padding:16px}
    nav a{display:block;color:#1f4e8c;text-decoration:none;padding:3px 0}
    nav a.sub{padding-left:14px;font-size:13px}
    nav h2{font-size:16px;margin:0 0 10px}
    main{margin-left:302px;padding:24px 40px;max-width:1150px}
    section{border-bottom:2px solid #e8ecf2;padding-bottom:24px;margin-bottom:24px}
    table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}
    th,td{border:1px solid #d5dbe5;padding:6px 8px;text-align:left;vertical-align:top}
    th{background:#eef2f8}
    code{background:#f1f3f6;padding:1px 4px;border-radius:3px;font-size:13px}
    pre{background:#f6f8fa;border:1px solid #e1e4e8;padding:10px;white-space:pre-wrap;word-break:break-word}
    pre code{background:none;padding:0}
    figure{margin:24px 0;border:1px solid #dde3ec;border-radius:6px;padding:12px}
    figcaption{font-weight:600;margin-bottom:8px}
    .src{font-weight:400;color:#667;font-size:12px}
    @media print{nav{display:none} main{margin:0;max-width:none;padding:0} figure{page-break-inside:avoid}}
    """
    page = (f'<!doctype html><html lang="en"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>HomeoClinic MVP1 Architecture Design</title><style>{css}</style></head><body>'
            f'<nav><h2>HomeoClinic MVP1 Design</h2>{"".join(nav)}</nav><main>{"".join(body)}</main></body></html>')
    (ROOT / "index.html").write_text(page, encoding="utf-8")
    print(f"index.html written: {len(DOCS)} docs, {len(figs)} diagrams")


if __name__ == "__main__":
    main()
