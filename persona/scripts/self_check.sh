#!/usr/bin/env bash
set -euo pipefail
PYTHON_BIN="${PYTHON_BIN:-python3}"
"$PYTHON_BIN" -m py_compile scripts/sample_personas.py scripts/build_panel_report.py
"$PYTHON_BIN" scripts/sample_personas.py --dataset examples/example-personas.json --n 2 --output json >/tmp/korean-synthetic-consumer-personas.json
"$PYTHON_BIN" scripts/build_panel_report.py \
  --personas examples/example-personas.json \
  --product "Offline self-check product concept" \
  --mode full-report \
  --title "Self Check" \
  --output /tmp/korean-synthetic-consumer-report.md
test -s /tmp/korean-synthetic-consumer-personas.json
test -s /tmp/korean-synthetic-consumer-report.md
echo "self-check passed"
