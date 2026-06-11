#!/usr/bin/env python3
"""Enrich persona data with matching NIA AI case references and KOSIS civil servant stats."""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


_KOREAN_PARTICLES = re.compile(r"[은는이가을를의도에에서으로과와만까지도]")


def tokenize_korean(text: str) -> List[str]:
    if not text:
        return []
    raw = re.split(r"[\s,，、;；:：·]+", text)
    tokens: List[str] = []
    for chunk in raw:
        chunk = chunk.strip()
        if not chunk:
            continue
        cleaned = _KOREAN_PARTICLES.sub("", chunk)
        if not cleaned:
            continue
        parts = re.findall(r"[가-힣]+|[a-zA-Z0-9]+", cleaned)
        tokens.extend(p for p in parts if len(p) >= 2)
    return tokens


def score_case(persona_tokens: List[str], case: Dict[str, Any]) -> int:
    case_text = (case.get("title") or "") + " " + (case.get("summary") or "")
    case_lower = case_text.lower()
    score = 0
    for token in persona_tokens:
        if token.lower() in case_lower:
            score += 1
    return score


def match_top_cases(
    persona: Dict[str, Any],
    cases: List[Dict[str, Any]],
    top_n: int,
) -> List[Dict[str, Any]]:
    search_text = (persona.get("occupation") or "") + " " + (persona.get("pain_points") or "")
    persona_tokens = tokenize_korean(search_text)

    if not persona_tokens or not cases:
        return []

    scored = [(case, score_case(persona_tokens, case)) for case in cases]
    scored.sort(key=lambda x: x[1], reverse=True)

    results: List[Dict[str, Any]] = []
    for case, sc in scored[:top_n]:
        if sc <= 0:
            continue
        results.append({
            "title": case.get("title", ""),
            "url": case.get("url", ""),
            "relevance_score": sc,
        })
    return results


def load_nia_cases(path: Path) -> Optional[List[Dict[str, Any]]]:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        items = data.get("items", []) if isinstance(data, dict) else []
        return [item for item in items if isinstance(item, dict)]
    except Exception as exc:  # noqa: BLE001
        eprint("enrich_personas.py: failed to read NIA data: " + str(exc))
        return []


def load_personas(path: Path) -> List[Dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    raise ValueError("Persona file must be a JSON array of persona objects")


def load_kosis_data(path: Path) -> Optional[Dict[str, Any]]:
    """Load KOSIS civil servant statistics. Returns None if file missing."""
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
        return None
    except Exception as exc:  # noqa: BLE001
        eprint("enrich_personas.py: failed to read KOSIS data: " + str(exc))
        return None


def safe_int(value: Any) -> int:
    try:
        return int(float(str(value).replace(",", "")))
    except (ValueError, TypeError):
        return 0


_GRADE_RE = re.compile(r"(\d)급")
_JOB_TYPE_MAP = {
    "일반직": "일반직",
    "정무직": "정무직",
    "별정직": "별정직",
    "특정직": "특정직",
}


def _find_grade_in_occupation(occupation: str) -> Optional[str]:
    """Extract grade number (e.g. '5') from occupation string like '5급 사무관'."""
    match = _GRADE_RE.search(occupation)
    if match:
        return match.group(1)
    return None


def extract_kosis_stats(kosis_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Extract summary stats from KOSIS tables for persona enrichment."""
    tables = kosis_data.get("tables") or []
    if not tables:
        return None

    grade_table = None
    job_table = None
    for table in tables:
        label = table.get("label", "")
        if label == "부처별_직급별_현원":
            grade_table = table
        elif label == "직종별_현원":
            job_table = table

    if not grade_table and not job_table:
        return None

    result: Dict[str, Any] = {}

    if grade_table:
        rows = grade_table.get("rows", [])
        years = sorted(
            (str(r.get("PRD_DE", "")) for r in rows if r.get("PRD_DE")),
            reverse=True,
        )
        latest_year = years[0] if years else None
        result["as_of_year"] = latest_year

        total = 0
        for row in rows:
            if (str(row.get("PRD_DE")) == latest_year
                    and row.get("C1_NM") == "합계"
                    and row.get("C2_NM") == "합계"
                    and row.get("ITM_NM") in ("현원", "전체 현원")):
                total = safe_int(row.get("DT"))
                break
        result["total_civil_servants"] = total

        grade_dist: List[Dict[str, Any]] = []
        grade_names = ["고위공무원", "3급", "4급", "5급", "6급", "7급", "8급", "9급"]
        for gname in grade_names:
            for row in rows:
                if (str(row.get("PRD_DE")) == latest_year
                        and row.get("C1_NM") == "합계"
                        and row.get("C2_NM") == gname
                        and row.get("ITM_NM") in ("현원", "전체 현원")):
                    count = safe_int(row.get("DT"))
                    grade_dist.append({"grade": gname, "count": count})
                    break
        result["grade_distribution"] = grade_dist

    if job_table:
        rows = job_table.get("rows", [])
        years = sorted(
            (str(r.get("PRD_DE", "")) for r in rows if r.get("PRD_DE")),
            reverse=True,
        )
        latest_year = years[0] if years else result.get("as_of_year")
        if "as_of_year" not in result:
            result["as_of_year"] = latest_year

        job_dist: List[Dict[str, Any]] = []
        target_types = ["일반직", "정무직", "고위공무원"]
        for jtype in target_types:
            for row in rows:
                if (str(row.get("PRD_DE")) == latest_year
                        and row.get("C1_NM") == jtype
                        and row.get("ITM_NM") in ("전체 현원", "현원")):
                    count = safe_int(row.get("DT"))
                    job_dist.append({"grade": jtype, "count": count})
                    break
        if "grade_distribution" not in result:
            result["grade_distribution"] = job_dist
        else:
            result["job_type_distribution"] = job_dist

    return result


def build_persona_grade_note(
    persona: Dict[str, Any],
    kosis_stats: Dict[str, Any],
) -> str:
    """Generate a one-line Korean note about the persona's grade in context."""
    occupation = persona.get("occupation") or ""
    grade_num = _find_grade_in_occupation(occupation)
    total = kosis_stats.get("total_civil_servants", 0)
    grade_dist = kosis_stats.get("grade_distribution", [])

    if not grade_num or not total or not grade_dist:
        if "과장" in occupation:
            return "과장급으로 일반적으로 4~5급에 해당하며, 전체 공무원의 소수를 차지합니다."
        if "부장" in occupation:
            return "부장급으로 공기업/준정부기관의 중간관리직에 해당합니다."
        if "담당관" in occupation:
            return "담당관급으로 부서 핵심 실무~관리직에 해당합니다."
        return "공무원 통계에서 직급 비율을 확인할 수 없습니다."

    grade_label = grade_num + "급"
    grade_count = 0
    for entry in grade_dist:
        if entry.get("grade") == grade_label:
            grade_count = entry["count"]
            break

    if grade_count <= 0:
        return grade_label + " 정보를 KOSIS 데이터에서 찾을 수 없습니다."

    pct = round(grade_count / total * 100, 2)
    note = (
        grade_label + " 공무원은 약 "
        + format(grade_count, ",") + "명으로, "
        + "전체 행정부 국가공무원(" + format(total, ",") + "명)의 "
        + str(pct) + "%를 차지합니다."
    )
    return note


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Enrich persona data with NIA AI cases and KOSIS civil servant stats."
    )
    parser.add_argument("--personas", default="examples/example-personas.json",
                        help="input persona JSON file")
    parser.add_argument("--nia-data", default="data/nia_ai_cases.json",
                        help="NIA AI cases JSON file")
    parser.add_argument("--kosis-data", default="data/kosis_civil_servant.json",
                        help="KOSIS civil servant statistics JSON file")
    parser.add_argument("--output", default="examples/example-personas-enriched.json",
                        help="output enriched persona JSON file")
    parser.add_argument("--top-n", type=int, default=3,
                        help="number of top matching NIA cases per persona")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)

    if args.top_n < 1:
        eprint("--top-n must be >= 1")
        return 2

    try:
        personas = load_personas(Path(args.personas))
    except Exception as exc:  # noqa: BLE001
        eprint("enrich_personas.py: failed to load personas: " + str(exc))
        return 1

    nia_path = Path(args.nia_data)
    cases = load_nia_cases(nia_path)

    kosis_raw = load_kosis_data(Path(args.kosis_data))
    kosis_stats = None
    if kosis_raw:
        kosis_stats = extract_kosis_stats(kosis_raw)
        if kosis_stats:
            total = kosis_stats.get("total_civil_servants", "?")
            year = kosis_stats.get("as_of_year", "?")
            eprint("KOSIS stats loaded: total=" + str(total) + " (as of " + str(year) + ")")
        else:
            eprint("KOSIS data loaded but no usable tables found.")
    else:
        eprint("Warning: KOSIS data file not found. Skipping KOSIS enrichment.")

    if cases is None:
        eprint(
            "Warning: NIA data file not found at '" + args.nia_data
            + "'. Saving personas without reference_cases."
        )
        enriched = personas
        enriched_count = 0
    else:
        eprint("Loaded " + str(len(cases)) + " NIA cases from '" + args.nia_data + "'.")
        enriched = []
        enriched_count = 0
        for persona in personas:
            top_matches = match_top_cases(persona, cases, args.top_n)
            new_persona = dict(persona)
            if top_matches:
                new_persona["reference_cases"] = top_matches
                enriched_count += 1
            if kosis_stats:
                new_persona["kosis_stats"] = dict(kosis_stats)
                new_persona["kosis_stats"]["persona_grade_note"] = build_persona_grade_note(
                    persona, kosis_stats
                )
            enriched.append(new_persona)

    output_path = Path(args.output)
    os.makedirs(output_path.parent or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(enriched, f, ensure_ascii=False, indent=2)

    eprint("Done. " + str(len(enriched)) + " personas saved to '" + args.output + "'.")
    eprint("  " + str(enriched_count) + "/" + str(len(personas)) + " enriched with reference_cases.")
    if kosis_stats:
        eprint("  " + str(len(enriched)) + "/" + str(len(personas)) + " enriched with kosis_stats.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
