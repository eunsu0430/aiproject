#!/usr/bin/env python3
"""Sample Korean synthetic personas from Hugging Face with graceful offline behavior."""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

DEFAULT_DATASET = "nvidia/Nemotron-Personas-Korea"

FIELD_ALIASES = {
    "region": ["region", "location", "residence", "address", "city", "province", "sido", "area", "거주", "지역"],
    "occupation": ["occupation", "job", "profession", "work", "career", "직업", "일"],
    "persona_type": ["persona_type", "type", "segment", "cluster", "persona", "성향", "유형"],
    "life_stage": ["life_stage", "lifestage", "age_group", "stage", "family", "marital", "생애", "라이프", "연령"],
}
DISPLAY_KEYS = [
    "name", "age", "gender", "region", "occupation", "persona_type", "life_stage", "income",
    "description", "persona", "summary", "background", "goals", "pain_points", "interests",
]


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


def normalize(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


def flatten_record(record: Dict[str, Any], prefix: str = "") -> Dict[str, Any]:
    flat: Dict[str, Any] = {}
    for key, value in record.items():
        full_key = f"{prefix}.{key}" if prefix else str(key)
        if isinstance(value, dict):
            flat.update(flatten_record(value, full_key))
        else:
            flat[full_key] = value
    return flat


def infer_field(record: Dict[str, Any], aliases: Sequence[str]) -> Optional[str]:
    keys = list(record.keys())
    lowered = {k.lower(): k for k in keys}
    for alias in aliases:
        a = alias.lower()
        if a in lowered:
            return lowered[a]
    for key in keys:
        lk = key.lower()
        if any(alias.lower() in lk for alias in aliases):
            return key
    return None


def record_text(record: Dict[str, Any]) -> str:
    return "\n".join(f"{k}: {normalize(v)}" for k, v in record.items())


def matches_filter(record: Dict[str, Any], logical_field: str, wanted: Optional[str]) -> bool:
    if not wanted:
        return True
    aliases = FIELD_ALIASES[logical_field]
    field = infer_field(record, aliases)
    haystack = normalize(record.get(field)) if field else record_text(record)
    return wanted.casefold() in haystack.casefold()


def matches_query(record: Dict[str, Any], query: Optional[str]) -> bool:
    if not query:
        return True
    terms = [t for t in re.split(r"\s+", query.strip()) if t]
    haystack = record_text(record).casefold()
    return all(term.casefold() in haystack for term in terms)


def compact_record(record: Dict[str, Any]) -> Dict[str, Any]:
    flat = flatten_record(record)
    compact: Dict[str, Any] = {}
    for logical, aliases in FIELD_ALIASES.items():
        field = infer_field(flat, aliases)
        if field and flat.get(field) not in (None, ""):
            compact[logical] = flat[field]
    for key in DISPLAY_KEYS:
        field = infer_field(flat, [key])
        if field and field not in compact and flat.get(field) not in (None, ""):
            compact[field] = flat[field]
    if not compact:
        # Keep a short text source for changing schemas without shipping huge rows.
        compact["source_excerpt"] = record_text(flat)[:1200]
    return compact


def load_from_json(path: Path) -> List[Dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        for key in ("personas", "items", "rows", "data"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
    if not isinstance(data, list):
        raise ValueError("JSON input must be a list or an object with personas/items/rows/data list")
    return [item for item in data if isinstance(item, dict)]


def load_from_hf(dataset_id: str, cache_dir: Optional[str]) -> Iterable[Dict[str, Any]]:
    try:
        from datasets import load_dataset  # type: ignore
    except ImportError:
        raise RuntimeError(
            "Missing optional package 'datasets'. Install with:\n"
            "  python -m pip install -r requirements.txt\n"
            "or sample offline with --dataset examples/example-personas.json"
        )

    try:
        ds = load_dataset(dataset_id, split="train", cache_dir=cache_dir)
    except Exception as exc:  # noqa: BLE001 - convert to user-friendly CLI error
        raise RuntimeError(
            f"Could not load Hugging Face dataset '{dataset_id}'.\n"
            "Check network access, Hugging Face availability, and dataset permissions.\n"
            "For offline testing, run: --dataset examples/example-personas.json\n"
            f"Original error: {exc.__class__.__name__}: {exc}"
        )

    # Return the iterable dataset directly. Sampling below uses reservoir sampling so the CLI does
    # not materialize the full Hugging Face dataset in memory.
    return (dict(row) for row in ds)


def try_duckdb_note(cache_dir: Optional[str]) -> Optional[str]:
    if not cache_dir:
        return None
    try:
        import duckdb  # type: ignore  # noqa: F401
        return "duckdb available; cache-dir reserved for future parquet cache workflows"
    except ImportError:
        return None


def sample_records(records: Iterable[Dict[str, Any]], args: argparse.Namespace) -> List[Dict[str, Any]]:
    rng = random.Random(args.seed)
    sample: List[Dict[str, Any]] = []
    matched_count = 0
    for record in records:
        flat = flatten_record(record)
        if not (
            matches_filter(flat, "region", args.region)
            and matches_filter(flat, "occupation", args.occupation)
            and matches_filter(flat, "persona_type", args.persona_type)
            and matches_filter(flat, "life_stage", args.life_stage)
            and matches_query(flat, args.query)
        ):
            continue
        matched_count += 1
        compact = compact_record(flat)
        if len(sample) < args.n:
            sample.append(compact)
        else:
            replace_at = rng.randrange(matched_count)
            if replace_at < args.n:
                sample[replace_at] = compact
    rng.shuffle(sample)
    return sample


def to_markdown(personas: Sequence[Dict[str, Any]], dataset: str) -> str:
    lines = [f"# Sampled Personas", "", f"Dataset/source: `{dataset}`", ""]
    if not personas:
        return "\n".join(lines + ["No personas matched the filters."])
    for idx, persona in enumerate(personas, 1):
        title = persona.get("name") or persona.get("persona") or persona.get("occupation") or f"Persona {idx}"
        lines += [f"## {idx}. {title}", ""]
        for key, value in persona.items():
            lines.append(f"- **{key}**: {normalize(value)}")
        lines.append("")
    return "\n".join(lines)


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sample Korean synthetic personas from nvidia/Nemotron-Personas-Korea or a local JSON file."
    )
    parser.add_argument("--dataset", default=DEFAULT_DATASET, help="Hugging Face dataset id or local JSON file path")
    parser.add_argument("--n", type=int, default=5, help="number of personas to sample")
    parser.add_argument("--seed", type=int, default=42, help="random seed")
    parser.add_argument("--region", help="best-effort region/location filter")
    parser.add_argument("--occupation", help="best-effort occupation/job filter")
    parser.add_argument("--persona-type", dest="persona_type", help="best-effort persona/segment/type filter")
    parser.add_argument("--life-stage", dest="life_stage", help="best-effort life-stage/age/family filter")
    parser.add_argument("--query", help="free-text AND query over the record")
    parser.add_argument("--output", choices=["json", "markdown"], default="json")
    parser.add_argument("--cache-dir", help="optional Hugging Face cache directory; DuckDB/parquet cache may use this later")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    if args.n < 1:
        eprint("--n must be >= 1")
        return 2

    source_path = Path(args.dataset)
    try:
        if source_path.exists():
            records = load_from_json(source_path)
        else:
            note = try_duckdb_note(args.cache_dir)
            if note:
                eprint(f"Note: {note}")
            records = load_from_hf(args.dataset, args.cache_dir)
        personas = sample_records(records, args)
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        eprint("sample_personas.py: unable to sample personas.")
        eprint(str(exc))
        return 1

    if args.output == "json":
        print(json.dumps(personas, ensure_ascii=False, indent=2))
    else:
        print(to_markdown(personas, args.dataset))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
