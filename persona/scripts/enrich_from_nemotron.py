#!/usr/bin/env python3
"""Enrich handong personas with Nemotron-Personas-Korea demographic data."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from datasets import load_dataset


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


_OCCUPATION_KEYWORDS = [
    "공무원",
    "행정",
    "사무",
    "공공기관",
    "국가",
    "지방자치",
]


def occupation_matches(occupation: str) -> bool:
    occ_lower = occupation.lower()
    return any(kw in occ_lower for kw in _OCCUPATION_KEYWORDS)


# handong uses 남성/여성, Nemotron uses 남자/여자
_SEX_MAP = {
    "남성": "남자",
    "여성": "여자",
}


def map_sex(handong_gender: str) -> Optional[str]:
    return _SEX_MAP.get(handong_gender)


_EDU_RANK = {
    "무학": 0,
    "초등학교": 1,
    "중학교": 2,
    "고등학교": 3,
    "2~3년제 전문대학": 4,
    "4년제 대학교": 5,
    "대학원(석·박사)": 6,
}


def edu_score(education_level: str) -> int:
    """1 if education typical for civil servants (4년제+), else 0."""
    rank = _EDU_RANK.get(education_level, 0)
    return 1 if rank >= 5 else 0


def match_score(
    handong: Dict[str, Any],
    nemotron: Dict[str, Any],
) -> Optional[int]:
    """Eligibility: same sex, age within ±5. Lower score = better match."""
    target_sex = map_sex(handong.get("gender", ""))
    if target_sex is None:
        return None
    if nemotron.get("sex") != target_sex:
        return None

    h_age = handong.get("age")
    n_age = nemotron.get("age")
    if h_age is None or n_age is None:
        return None
    age_diff = abs(int(h_age) - int(n_age))
    if age_diff > 5:
        return None

    # age distance *2, minus education bonus → prefer closer age + higher edu
    return age_diff * 2 - edu_score(nemotron.get("education_level", ""))


def find_best_match(
    handong_persona: Dict[str, Any],
    nemotron_records: List[Dict[str, Any]],
    used_uuids: set,
) -> Optional[Dict[str, Any]]:
    best = None
    best_score = None

    for rec in nemotron_records:
        uuid = rec.get("uuid", "")
        if uuid in used_uuids:
            continue
        sc = match_score(handong_persona, rec)
        if sc is None:
            continue
        if best_score is None or sc < best_score:
            best = rec
            best_score = sc

    return best


_MERGE_FIELDS = {
    "nemotron_uuid": "uuid",
    "demographic_background": "cultural_background",
    "life_persona": "persona",
    "province": "province",
    "district": "district",
    "marital_status": "marital_status",
    "housing_type": "housing_type",
    "education_level": "education_level",
}


def merge_nemotron(
    handong_persona: Dict[str, Any],
    nemotron_record: Dict[str, Any],
) -> Dict[str, Any]:
    merged = dict(handong_persona)
    for target_key, source_key in _MERGE_FIELDS.items():
        value = nemotron_record.get(source_key)
        if value is not None:
            merged[target_key] = value
    return merged


def load_handong_personas(path: Path) -> List[Dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    raise ValueError("Persona file must be a JSON array of persona objects")


def fetch_nemotron_civil_servants(max_records: int) -> List[Dict[str, Any]]:
    eprint("Loading Nemotron-Personas-Korea (streaming=True) ...")
    ds = load_dataset("nvidia/Nemotron-Personas-Korea", streaming=True)
    train = ds["train"]

    collected: List[Dict[str, Any]] = []
    scanned = 0

    for row in train:
        scanned += 1
        occ = row.get("occupation", "")
        if not occupation_matches(occ):
            continue

        collected.append(dict(row))

        if len(collected) >= max_records:
            break

        if scanned % 50000 == 0:
            eprint(
                "  scanned {:,} rows, collected {:,}/{:,}".format(
                    scanned, len(collected), max_records
                )
            )

    eprint(
        "  Done. Scanned {:,} rows, collected {:,} civil-servant records.".format(
            scanned, len(collected)
        )
    )
    return collected


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Enrich handong personas with Nemotron-Personas-Korea demographics."
    )
    parser.add_argument(
        "--personas",
        default="examples/example-personas-100-enriched.json",
        help="input handong persona JSON file",
    )
    parser.add_argument(
        "--output",
        default="examples/example-personas-100-nemotron.json",
        help="output merged persona JSON file",
    )
    parser.add_argument(
        "--nemotron-cache",
        default="data/nemotron_civil_servants.json",
        help="path to save/load raw Nemotron filtered records",
    )
    parser.add_argument(
        "--max-nemotron",
        type=int,
        default=200,
        help="max Nemotron civil-servant records to collect",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)

    try:
        personas = load_handong_personas(Path(args.personas))
    except Exception as exc:
        eprint("Failed to load personas: " + str(exc))
        return 1

    eprint("Loaded {:,} handong personas from '{}'".format(len(personas), args.personas))

    nemotron_cache = Path(args.nemotron_cache)

    if nemotron_cache.exists():
        eprint("Loading cached Nemotron records from '{}' ...".format(args.nemotron_cache))
        nemotron_records = json.loads(nemotron_cache.read_text(encoding="utf-8"))
        eprint("  {:,} records loaded from cache.".format(len(nemotron_records)))
    else:
        nemotron_records = fetch_nemotron_civil_servants(args.max_nemotron)

        os.makedirs(nemotron_cache.parent or ".", exist_ok=True)
        nemotron_cache.write_text(
            json.dumps(nemotron_records, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        eprint("Saved {:,} records to '{}'".format(len(nemotron_records), args.nemotron_cache))

    if not nemotron_records:
        eprint("No Nemotron records found. Exiting without merging.")
        return 1

    used_uuids: set = set()
    merged_personas: List[Dict[str, Any]] = []
    merged_count = 0

    for persona in personas:
        match = find_best_match(persona, nemotron_records, used_uuids)

        if match is not None:
            used_uuids.add(match.get("uuid", ""))
            merged = merge_nemotron(persona, match)
            merged_count += 1
        else:
            merged = dict(persona)

        merged_personas.append(merged)

    output_path = Path(args.output)
    os.makedirs(output_path.parent or ".", exist_ok=True)
    output_path.write_text(
        json.dumps(merged_personas, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    eprint("")
    eprint("=== Summary ===")
    eprint("  Handong personas:       {:>5,}".format(len(personas)))
    eprint("  Nemotron records:       {:>5,}".format(len(nemotron_records)))
    eprint("  Merged with Nemotron:   {:>5,} / {:,}".format(merged_count, len(personas)))
    eprint("  No match (skipped):     {:>5,}".format(len(personas) - merged_count))
    eprint("  Output: '{}'".format(args.output))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
