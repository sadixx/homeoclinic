#!/usr/bin/env python3
"""Generate task-tracker exports (Markdown, CSV, JSON) from backlog.txt; validates requirement ids."""
import csv, json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent
REQ_DIR = ROOT.parent / "requirements"
TYPES = {"biz", "legal", "decision", "content", "design", "dev", "test", "ops", "doc"}
PRIOS = {"P0", "P1", "P2"}


def known_requirement_ids():
    ids = set()
    for f in REQ_DIR.glob("*.md"):
        ids.update(re.findall(r"^\| ([A-Z0-9]{2,5}-\d{3}) \|", f.read_text(encoding="utf-8"), re.M))
        ids.update(re.findall(r"Requirement ([A-Z]{2,5}-\d{3}) \(", f.read_text(encoding="utf-8")))
    return ids


def split_ids(text):
    return [] if text.strip() == "-" else [x.strip() for x in text.split(",") if x.strip()]


def parse():
    stages, errors = [], []
    stage = epic = feat = None
    for n, raw in enumerate((ROOT / "backlog.txt").read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        kind, _, rest = line.partition(" ")
        parts = [p.strip() for p in rest.split(" | ")]
        if kind == "STAGE" and len(parts) == 3:
            stage = {"code": parts[0], "name": parts[1], "goal": parts[2], "epics": []}
            stages.append(stage)
        elif kind == "EPIC" and len(parts) == 3 and stage:
            epic = {"milestone": parts[0], "name": parts[1], "depends": split_ids(parts[2]), "features": []}
            stage["epics"].append(epic)
        elif kind == "FEAT" and len(parts) == 2 and epic:
            feat = {"name": parts[0], "reqs": split_ids(parts[1]), "tasks": []}
            epic["features"].append(feat)
        elif kind == "TASK" and len(parts) == 6 and feat:
            t = {"type": parts[0], "priority": parts[1], "estimate_days": float(parts[2]),
                 "title": parts[3], "reqs": split_ids(parts[4]), "done_when": parts[5]}
            if t["type"] not in TYPES:
                errors.append(f"line {n}: unknown type {t['type']}")
            if t["priority"] not in PRIOS:
                errors.append(f"line {n}: unknown priority {t['priority']}")
            feat["tasks"].append(t)
        else:
            errors.append(f"line {n}: cannot parse: {line[:80]}")
    return stages, errors


def assign_ids(stages):
    for s in stages:
        tn = 0
        for ei, e in enumerate(s["epics"], 1):
            e["id"] = f"HC-{s['code']}-E{ei:02d}"
            for fi, f in enumerate(e["features"], 1):
                f["id"] = f"{e['id']}-F{fi:02d}"
                for t in f["tasks"]:
                    tn += 1
                    t["id"] = f"HC-{s['code']}-{tn:03d}"


def fmt_days(d):
    return f"{d:g}"


def stage_totals(s):
    tasks = [t for e in s["epics"] for f in e["features"] for t in f["tasks"]]
    by_p = {p: sum(t["estimate_days"] for t in tasks if t["priority"] == p) for p in sorted(PRIOS)}
    return tasks, by_p


def write_markdown(stages, out):
    out.mkdir(parents=True, exist_ok=True)
    for i, s in enumerate(stages):
        tasks, by_p = stage_totals(s)
        L = [f"# {s['name']}", "", s["goal"], "",
             f"Stage code: `{s['code']}`. Tasks: {len(tasks)}. Rough effort: "
             + ", ".join(f"{p} {fmt_days(v)} days" for p, v in by_p.items() if v) + ".", "",
             "Legend: `[type/priority/estimate days]`, Req = requirement ids in `requirements/`, Done = acceptance check.", "",
             "## Epics", "", "| Epic | Milestone | Depends on | Tasks | Days |", "|---|---|---|---|---|"]
        for e in s["epics"]:
            et = [t for f in e["features"] for t in f["tasks"]]
            L.append(f"| {e['id']} {e['name']} | {e['milestone']} | {', '.join(e['depends']) or '-'} | {len(et)} | {fmt_days(sum(t['estimate_days'] for t in et))} |")
        for e in s["epics"]:
            L += ["", f"## {e['id']}: {e['name']}", "",
                  f"Milestone: {e['milestone']}. Depends on: {', '.join(e['depends']) or '-'}."]
            for f in e["features"]:
                L += ["", f"### {f['id']}: {f['name']}", ""]
                if f["reqs"]:
                    L += [f"Requirements: {', '.join(f['reqs'])}", ""]
                for t in f["tasks"]:
                    L.append(f"- [ ] **{t['id']}** {t['title']} `[{t['type']}/{t['priority']}/{fmt_days(t['estimate_days'])}d]`")
                    meta = []
                    if t["reqs"]:
                        meta.append("Req: " + ", ".join(t["reqs"]))
                    meta.append("Done: " + t["done_when"])
                    L.append("  - " + ". ".join(meta))
        (out / f"{i:02d}-{s['code']}.md").write_text("\n".join(L) + "\n", encoding="utf-8")


def rows(stages):
    for s in stages:
        for e in s["epics"]:
            for f in e["features"]:
                for t in f["tasks"]:
                    desc = (f"{t['title']}\n\nDone when: {t['done_when']}\n"
                            f"Requirements: {', '.join(t['reqs']) or '-'}\n"
                            f"Stage: {s['name']}\nEpic: {e['id']} {e['name']} (milestone {e['milestone']})\n"
                            f"Feature: {f['id']} {f['name']}\nType: {t['type']}, priority {t['priority']}, "
                            f"estimate {fmt_days(t['estimate_days'])} days")
                    yield {"ID": t["id"], "Title": t["title"], "Stage": s["code"], "Epic ID": e["id"],
                           "Epic": e["name"], "Milestone": e["milestone"], "Feature ID": f["id"],
                           "Feature": f["name"], "Type": t["type"], "Priority": t["priority"],
                           "Estimate (days)": fmt_days(t["estimate_days"]),
                           "Requirements": ", ".join(t["reqs"]), "Done when": t["done_when"],
                           "Epic depends on": ", ".join(e["depends"]),
                           "Labels": ",".join([s["code"], e["milestone"], t["type"], t["priority"]]),
                           "Status": "To do", "Description": desc}


def write_csv(path, fieldnames, data):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(data)


def main():
    stages, errors = parse()
    known = known_requirement_ids()
    for s in stages:
        for e in s["epics"]:
            for f in e["features"]:
                for rid in f["reqs"] + [r for t in f["tasks"] for r in t["reqs"]]:
                    if rid not in known:
                        errors.append(f"unknown requirement id {rid} in {f['name']}")
    if errors:
        print("\n".join(sorted(set(errors))))
        sys.exit(1)
    assign_ids(stages)
    write_markdown(stages, ROOT / "markdown")
    all_rows = list(rows(stages))
    csv_dir = ROOT / "csv"
    csv_dir.mkdir(exist_ok=True)
    fields = list(all_rows[0].keys())
    write_csv(csv_dir / "all-tasks.csv", fields, all_rows)
    for s in stages:
        write_csv(csv_dir / f"tasks-{s['code']}.csv", fields, [r for r in all_rows if r["Stage"] == s["code"]])
    write_csv(csv_dir / "epics.csv", ["Epic ID", "Stage", "Epic", "Milestone", "Depends on", "Tasks", "Estimate (days)"],
              [{"Epic ID": e["id"], "Stage": s["code"], "Epic": e["name"], "Milestone": e["milestone"],
                "Depends on": ", ".join(e["depends"]),
                "Tasks": sum(len(f["tasks"]) for f in e["features"]),
                "Estimate (days)": fmt_days(sum(t["estimate_days"] for f in e["features"] for t in f["tasks"]))}
               for s in stages for e in s["epics"]])
    write_csv(csv_dir / "features.csv", ["Feature ID", "Epic ID", "Stage", "Feature", "Requirements", "Tasks"],
              [{"Feature ID": f["id"], "Epic ID": e["id"], "Stage": s["code"], "Feature": f["name"],
                "Requirements": ", ".join(f["reqs"]), "Tasks": len(f["tasks"])}
               for s in stages for e in s["epics"] for f in e["features"]])
    write_csv(csv_dir / "gitlab-issues.csv", ["title", "description"],
              [{"title": f"{r['ID']} {r['Title']}",
                "description": r["Description"] + "\n\n/label " + " ".join(f'~"{x}"' for x in r["Labels"].split(","))}
               for r in all_rows])
    (ROOT / "json").mkdir(exist_ok=True)
    (ROOT / "json" / "backlog.json").write_text(json.dumps(stages, indent=2, ensure_ascii=False), encoding="utf-8")
    for s in stages:
        tasks, by_p = stage_totals(s)
        print(f"{s['code']:7} epics={len(s['epics']):2} features={sum(len(e['features']) for e in s['epics']):3} "
              f"tasks={len(tasks):3} days=" + " ".join(f"{p}:{fmt_days(v)}" for p, v in by_p.items()))
    print(f"TOTAL tasks={len(all_rows)}")


if __name__ == "__main__":
    main()
