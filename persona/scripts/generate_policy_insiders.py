#!/usr/bin/env python3
"""Generate 300 Policy Insider personas from Nemotron base data and merge with existing 1000."""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


_NAME_RE = re.compile(r"^([가-힣]{2,4})(?:\s?씨)")


def extract_name(persona_text: str) -> str:
    m = _NAME_RE.search(persona_text)
    if m:
        return m.group(1)
    return "미상"


def load_report_data(path: str) -> List[Dict[str, Any]]:
    p = Path(path)
    if not p.exists():
        eprint("Warning: '{}' not found, skipping.".format(path))
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        items = data.get("items", []) if isinstance(data, dict) else []
        return [item for item in items if isinstance(item, dict)]
    except Exception as exc:
        eprint("Warning: failed to read '{}': {}".format(path, str(exc)))
        return []


_POLICY_INSIDER_ORGS = [
    "한국행정연구원",
    "한국개발연구원(KDI)",
    "국회입법조사처",
    "대통령자문정책기획위원회",
]

_POLICY_INSIDER_INSIGHTS = [
    "이 사업은 원래 공공기관이 직접 하려다가 민간 지원으로 바뀐 것",
    "89.8억 = 100억 미만으로 맞춘 것. 기재부 심층심사 기준이 100억",
    "공고 5월 3주, 선정 6월, 집행 12월 = 연말 실적 채우기 패턴",
]

_POLICY_INSIDER_OBJECTIONS = [
    "정책의 연속성이 보장되는가?",
    "전 정권에서도 비슷한 사업이 실패했다",
]

_BUDGET_AUTHORITY_INSIGHTS = [
    "직접 구축이면 인력 채용 + 5년 운영비. 민간 지원이면 책임 분산",
    "성과지표가 개발 종수인 건 우리가 그 기준으로 심사했기 때문",
    "올해 예산 집행률 맞추려면 6월 착수가 필요",
]

_BUDGET_AUTHORITY_OBJECTIONS = [
    "ROI를 증명할 수 있나요?",
    "내년 예산에 반영하겠다",
]

_LEGISLATIVE_ADVISOR_INSIGHTS = [
    "직접 구축이면 특혜 시비로 야당 국감 공세",
    "민간 지원으로 가면 민간 활력 프레임 가능",
    "실패해도 수행사 책임으로 돌릴 수 있는 구조",
]

_LEGISLATIVE_ADVISOR_OBJECTIONS = [
    "국감 대응 시나리오가 있는가?",
    "언론 프레임은 어떻게 할 것인가?",
]

_TYPE_CONFIG = {
    "policy-insider": {
        "grade": "전직 고위공무원단/3급",
        "orgs": _POLICY_INSIDER_ORGS,
        "insights": _POLICY_INSIDER_INSIGHTS,
        "objections": _POLICY_INSIDER_OBJECTIONS,
    },
    "budget-authority": {
        "grade": "4급 서기관",
        "orgs": ["기획재정부 예산실"],
        "insights": _BUDGET_AUTHORITY_INSIGHTS,
        "objections": _BUDGET_AUTHORITY_OBJECTIONS,
    },
    "legislative-advisor": {
        "grade": "보좌관",
        "orgs": ["국회 과방위"],
        "insights": _LEGISLATIVE_ADVISOR_INSIGHTS,
        "objections": _LEGISLATIVE_ADVISOR_OBJECTIONS,
    },
}


def build_policy_persona(
    nemotron: Dict[str, Any],
    persona_type: str,
    kdi_titles: List[str],
    kipa_titles: List[str],
    idx: int,
) -> Dict[str, Any]:
    cfg = _TYPE_CONFIG[persona_type]
    org = random.choice(cfg["orgs"])

    ref_idx = idx
    reports: List[Dict[str, str]] = []
    if kdi_titles:
        reports.append({"title": kdi_titles[ref_idx % len(kdi_titles)], "source": "kdi"})
    if kipa_titles:
        reports.append({"title": kipa_titles[ref_idx % len(kipa_titles)], "source": "kipa"})

    return {
        "name": extract_name(nemotron.get("persona", "")),
        "age": int(nemotron["age"]),
        "sex": nemotron["sex"],
        "province": nemotron["province"],
        "district": nemotron["district"],
        "occupation": nemotron["occupation"],
        "education_level": nemotron["education_level"],
        "marital_status": nemotron["marital_status"],
        "family_type": nemotron["family_type"],
        "housing_type": nemotron["housing_type"],
        "grade": cfg["grade"],
        "org": org,
        "persona_type": persona_type,
        "insight_patterns": list(cfg["insights"]),
        "objections": list(random.sample(cfg["objections"], 2)),
        "reference_reports": reports,
        "nemotron_uuid": nemotron["uuid"],
        "life_persona": nemotron["persona"],
        "professional_persona": nemotron.get("professional_persona", ""),
        "demographic_background": nemotron.get("cultural_background", ""),
    }


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate 300 Policy Insider personas from Nemotron base data."
    )
    parser.add_argument("--base", default="data/nemotron_civil_base.json")
    parser.add_argument("--kdi-data", default="data/kdi_reports.json")
    parser.add_argument("--kipa-data", default="data/kipa_reports.json")
    parser.add_argument("--existing", default="examples/example-personas-1000-nemotron.json")
    parser.add_argument("--output", default="examples/example-personas-policy-300.json")
    parser.add_argument("--full-output", default="examples/example-personas-1300-full.json")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    random.seed(42)
    args = parse_args(argv)

    base_path = Path(args.base)
    if not base_path.exists():
        eprint("Error: Nemotron base data not found at '{}'".format(str(base_path)))
        return 1
    base_data = json.loads(base_path.read_text(encoding="utf-8"))
    eprint("Loaded {:,} Nemotron base records.".format(len(base_data)))

    filtered = [
        rec for rec in base_data
        if 35 <= int(rec.get("age", 0)) <= 65
        and (
            "대학원" in rec.get("education_level", "")
            or "4년제" in rec.get("education_level", "")
        )
    ]
    eprint("Filtered to {:,} records (age 35-65, 대학원 or 4년제).".format(len(filtered)))

    if len(filtered) < 300:
        eprint("Error: only {:,} matching records (need 300).".format(len(filtered)))
        return 1

    selected = filtered[:300]

    kdi_items = load_report_data(args.kdi_data)
    kdi_titles = [item.get("title", "") for item in kdi_items if item.get("title")]
    eprint("KDI reports: {:,}".format(len(kdi_titles)))

    kipa_items = load_report_data(args.kipa_data)
    kipa_titles = [item.get("title", "") for item in kipa_items if item.get("title")]
    eprint("KIPA reports: {:,}".format(len(kipa_titles)))

    types = ["policy-insider"] * 100 + ["budget-authority"] * 100 + ["legislative-advisor"] * 100
    policy_personas: List[Dict[str, Any]] = []
    for i, (rec, ptype) in enumerate(zip(selected, types)):
        policy_personas.append(build_policy_persona(rec, ptype, kdi_titles, kipa_titles, i))

    output_path = Path(args.output)
    os.makedirs(output_path.parent or ".", exist_ok=True)
    output_path.write_text(
        json.dumps(policy_personas, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    existing_path = Path(args.existing)
    existing: List[Dict[str, Any]] = []
    if existing_path.exists():
        existing = json.loads(existing_path.read_text(encoding="utf-8"))
        eprint("Loaded {:,} existing personas.".format(len(existing)))

    merged = existing + policy_personas
    full_path = Path(args.full_output)
    os.makedirs(full_path.parent or ".", exist_ok=True)
    full_path.write_text(
        json.dumps(merged, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    type_counts: Dict[str, int] = {}
    for p in policy_personas:
        pt = p.get("persona_type", "?")
        type_counts[pt] = type_counts.get(pt, 0) + 1

    eprint("")
    eprint("=== Summary ===")
    eprint("  Total policy personas built: {:,}".format(len(policy_personas)))
    eprint("  Distribution by persona_type:")
    for pt, cnt in sorted(type_counts.items(), key=lambda x: x[1], reverse=True):
        eprint("    {:<25s} {:>5,}".format(pt, cnt))
    eprint("  Total merged (existing + new): {:,}".format(len(merged)))
    eprint("")
    eprint("  Policy output:  '{}'".format(args.output))
    eprint("  Full output:    '{}'".format(args.full_output))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
