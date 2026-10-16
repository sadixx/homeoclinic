#!/usr/bin/env python3
"""Validate the hc-* pack and export it for any AI tool.

Usage: python3 export.py --target kiro|claude|copilot|generic|bundle|all
Output goes to dist/<target>/. Nothing is installed; copy or link it yourself.
"""
import argparse
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
PACK_DIRNAME = "hc-agents"  # folder name the pack has inside a target repo
NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
RBKS_LEADER = Path.home() / ".kiro/agents/RBKS-FwBuilders-leader.json"
FALLBACK_DENY = [
    r".*git\s+.*push\s+.*[\s:]\+?(main|master|release/.*)(\s.*|$)",
    r".*git\s+.*push\s+.*--force.*",
    r"git reset --hard.*",
    r"rm -rf /.*",
    r"rm -rf ~.*",
    r".*cat.*/\.ssh/.*",
    r".*cat.*/\.aws/.*",
    r"curl .* \| (ba)?sh",
    r"DROP TABLE.*",
]


def parse(path: Path) -> dict:
    """Split a SKILL.md into front matter fields and body (minimal YAML: scalars + one metadata map)."""
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        sys.exit(f"ERROR {path}: missing YAML front matter")
    fields, meta = {}, {}
    in_meta = False
    for line in m.group(1).splitlines():
        if line.startswith("metadata:"):
            in_meta = True
            continue
        if in_meta and line.startswith("  "):
            k, _, v = line.strip().partition(":")
            meta[k] = v.strip().strip('"')
            continue
        in_meta = False
        k, _, v = line.partition(":")
        fields[k.strip()] = v.strip()
    return {"name": fields.get("name", ""), "description": fields.get("description", ""),
            "meta": meta, "body": m.group(2).strip(), "path": path}


def load() -> tuple[dict, dict]:
    agents = {p.parent.name: parse(p) for p in sorted((ROOT / "agents").glob("*/SKILL.md"))}
    skills = {p.parent.name: parse(p) for p in sorted((ROOT / "skills").glob("*/SKILL.md"))}
    return agents, skills


def validate(agents: dict, skills: dict) -> None:
    errors = []
    for kind, items in (("agent", agents), ("skill", skills)):
        for d, s in items.items():
            if s["name"] != d:
                errors.append(f"{kind} {d}: name '{s['name']}' must equal folder name")
            if not NAME_RE.match(s["name"]) or len(s["name"]) > 64:
                errors.append(f"{kind} {d}: invalid Agent Skills name")
            if not 0 < len(s["description"]) <= 1024:
                errors.append(f"{kind} {d}: description must be 1..1024 chars")
            if "\u2014" in s["path"].read_text(encoding="utf-8"):
                errors.append(f"{kind} {d}: contains an em dash")
    for d, a in agents.items():
        for c in a["meta"].get("hc-spawns", "").split():
            if c not in agents:
                errors.append(f"agent {d}: unknown spawn target {c}")
        for s in a["meta"].get("hc-skills", "").split():
            if s not in skills:
                errors.append(f"agent {d}: unknown skill {s}")
        base = a["meta"].get("hc-base")
        if base and base not in agents:
            errors.append(f"agent {d}: unknown base {base}")
    if errors:
        sys.exit("\n".join(["validation failed:"] + errors))
    print(f"validated {len(agents)} agents, {len(skills)} skills")


def prompt_for(a: dict, agents: dict, pack_root: str) -> str:
    """Role prompt for tools that take instructions inline: pack root line + body (+ base contract)."""
    head = (f"Pack root: `{pack_root}`. All `agents/...` and `skills/...` paths below are relative "
            f"to it. Read `{pack_root}/AGENTS.md` once per session.\n\n")
    body = a["body"]
    base = a["meta"].get("hc-base")
    if base:
        body += f"\n\n---\n\n# Base contract ({base})\n\n" + agents[base]["body"]
    return head + body


def copy_pack(dest: Path) -> None:
    target = dest / PACK_DIRNAME
    shutil.rmtree(target, ignore_errors=True)
    shutil.copytree(ROOT, target, ignore=shutil.ignore_patterns("dist", "__pycache__", "*.pyc"))


def copy_skills(skills: dict, dest: Path) -> None:
    for name in skills:
        shutil.copytree(ROOT / "skills" / name, dest / name, dirs_exist_ok=True)


def md_agent(a: dict, agents: dict, pack_root: str) -> str:
    desc = a["description"].replace('"', "'")
    return f'---\nname: {a["name"]}\ndescription: "{desc}"\n---\n\n{prompt_for(a, agents, pack_root)}\n'


def export_kiro(agents, skills, out):
    deny = FALLBACK_DENY
    try:
        deny = json.loads(RBKS_LEADER.read_text())["toolsSettings"]["shell"]["deniedCommands"]
    except (OSError, KeyError, json.JSONDecodeError):
        pass
    for name, a in agents.items():
        spawns = a["meta"].get("hc-spawns", "").split()
        res = [f"skill://{ROOT / 'skills' / s / 'SKILL.md'}" for s in a["meta"].get("hc-skills", "").split()]
        res.append(f"skill://{ROOT / 'skills' / 'hc-delegation' / 'SKILL.md'}")
        rules = [{"capability": "fs_read", "effect": "allow"}]
        if spawns:
            rules.append({"capability": "subagent", "effect": "allow", "match": spawns})
        rules.append({"capability": "subagent", "effect": "deny", "match": ["*"], "exclude": spawns})
        cfg = {
            "name": name,
            "description": a["description"],
            "prompt": prompt_for(a, agents, str(ROOT)),
            "includeMcpJson": False,
            "resources": sorted(set(res)),
            "tools": ["@builtin"] + [f"subagent/{c}" for c in spawns] + (["subagent"] if spawns else []),
            "allowedTools": ["fs_read"],
            "permissions": {"rules": rules},
            "toolsSettings": {
                "shell": {"deniedCommands": deny},
                "execute_bash": {"deniedCommands": deny},
                **({"subagent": {"trustedAgents": spawns, "availableAgents": spawns}} if spawns else {}),
            },
        }
        (out / f"HomeoClinic-{name}.json").write_text(json.dumps(cfg, indent=1, ensure_ascii=False) + "\n")


def export_claude(agents, skills, out):
    (out / ".claude/agents").mkdir(parents=True)
    for name, a in agents.items():
        (out / ".claude/agents" / f"{name}.md").write_text(md_agent(a, agents, PACK_DIRNAME))
    copy_skills(skills, out / ".claude/skills")
    copy_pack(out)


def export_copilot(agents, skills, out):
    (out / ".github/agents").mkdir(parents=True)
    for name, a in agents.items():
        (out / ".github/agents" / f"{name}.agent.md").write_text(md_agent(a, agents, PACK_DIRNAME))
    copy_skills(skills, out / ".github/skills")
    copy_pack(out)


def export_generic(agents, skills, out):
    copy_pack(out)
    pointer = (f"# AGENTS.md\n\nThis repository uses the HomeoClinic hc-* agent pack in `{PACK_DIRNAME}/`.\n"
               f"Read `{PACK_DIRNAME}/AGENTS.md` first, then act as `hc-leader` "
               f"(`{PACK_DIRNAME}/agents/hc-leader/SKILL.md`) unless the user names another role.\n")
    (out / "AGENTS.md").write_text(pointer)
    (out / "GEMINI.md").write_text(pointer.replace("# AGENTS.md", "# GEMINI.md"))
    copy_skills(skills, out / ".agents/skills")


def export_bundle(agents, skills, out):
    parts = ["# HomeoClinic hc-* agent pack (single-file bundle)\n",
             "Paste this whole file into any AI chat. Sections marked `=== FILE: <path> ===` are the pack files; "
             "paths are relative to the pack root. Start by acting as `hc-leader`.\n"]
    files = [ROOT / "AGENTS.md"] + [s["path"] for s in skills.values()] + [a["path"] for a in agents.values()]
    for f in files:
        parts.append(f"\n=== FILE: {f.relative_to(ROOT)} ===\n\n{f.read_text(encoding='utf-8').strip()}\n")
    (out / "hc-agents-bundle.md").write_text("".join(parts))


TARGETS = {"kiro": export_kiro, "claude": export_claude, "copilot": export_copilot,
           "generic": export_generic, "bundle": export_bundle}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", default="all", choices=[*TARGETS, "all"])
    args = ap.parse_args()
    agents, skills = load()
    validate(agents, skills)
    for t in TARGETS if args.target == "all" else [args.target]:
        out = DIST / t
        shutil.rmtree(out, ignore_errors=True)
        out.mkdir(parents=True)
        TARGETS[t](agents, skills, out)
        print(f"exported {t} -> {out}")


if __name__ == "__main__":
    main()
