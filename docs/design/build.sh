#!/usr/bin/env bash
# Render all PlantUML diagrams to SVG, then rebuild the static review site.
set -euo pipefail
cd "$(dirname "$0")"
PLANTUML_JAR="${PLANTUML_JAR:-$HOME/metadatahandler-mastery/tools/plantuml.jar}"
java -jar "$PLANTUML_JAR" -tsvg -o ../svg diagrams/src/*.puml
/usr/bin/python3 build_site.py
