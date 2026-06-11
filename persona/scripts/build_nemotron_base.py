#!/usr/bin/env python3
"""Build 1,000 public-servant personas using Nemotron-Personas-Korea as the base.

Architecture: Nemotron (demographic realism) → + handong objection patterns
→ + NIA real data context = personas for AX consulting.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from datasets import load_dataset


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


# ── Occupation filtering ──────────────────────────────────────────────────

_OCCUPATION_KEYWORDS = [
    "공무원", "행정", "사무직", "공공기관", "국가직", "지방직",
    "공기업", "정부", "교육청", "군인", "경찰", "소방",
]


def occupation_matches(occupation: str) -> bool:
    return any(kw in occupation for kw in _OCCUPATION_KEYWORDS)


# ── Field extraction ──────────────────────────────────────────────────────

_BASE_FIELDS = [
    "uuid", "persona", "professional_persona", "cultural_background",
    "career_goals_and_ambitions", "sex", "age", "marital_status",
    "family_type", "housing_type", "education_level", "occupation",
    "district", "province",
]


def extract_base(record: Dict[str, Any]) -> Dict[str, Any]:
    return {k: record.get(k, "") for k in _BASE_FIELDS}


# ── Name extraction ───────────────────────────────────────────────────────
# Nemotron persona text starts with "홍길동 씨는 ..." — extract the name.

_NAME_RE = re.compile(r"^([가-힣]{2,4})(?:\s?씨)")


def extract_name(persona_text: str) -> str:
    m = _NAME_RE.search(persona_text)
    if m:
        return m.group(1)
    return "미상"


# ── Persona type (rule-based) ─────────────────────────────────────────────

_CAUTIOUS_KEYWORDS = ("감사", "감찰", "고위")
_SECURITY_KEYWORDS = ("정보", "전산", "시스템", "소방")
_BUDGET_KEYWORDS = ("예산", "재무", "회계", "조세", "관세", "병무")


def assign_persona_type(age: int, occupation: str) -> str:
    if age >= 50 or any(k in occupation for k in _CAUTIOUS_KEYWORDS):
        return "cautious-gatekeeper"
    if any(k in occupation for k in _SECURITY_KEYWORDS):
        return "security-blocker"
    if any(k in occupation for k in _BUDGET_KEYWORDS):
        return "budget-guardian"
    if age <= 35:
        return "innovation-champion"
    return "practical-executor"


# ── Tech savviness ────────────────────────────────────────────────────────

def assign_tech_savviness(age: int) -> int:
    if age >= 55:
        base = random.randint(1, 2)
    elif age >= 45:
        base = random.randint(2, 3)
    elif age >= 35:
        base = random.randint(3, 4)
    else:
        base = random.randint(4, 5)
    return max(1, min(5, base + random.choice([-1, 0, 0, 1])))


# ── Objections ────────────────────────────────────────────────────────────

_OBJECTIONS = {
    "cautious-gatekeeper": [
        "검증된 레퍼런스가 없다",
        "감사원 지적 리스크가 있다",
        "전례가 없는 방식이라 승인이 어렵다",
    ],
    "security-blocker": [
        "망분리 환경에서 SaaS는 불가합니다",
        "CSAP 인증이 없으면 도입 불가",
        "개인정보 외부 전송 불가",
    ],
    "budget-guardian": [
        "예산 편성이 안 돼 있다",
        "ROI를 수치로 증명해달라",
        "내년 예산에 반영하겠다",
    ],
    "practical-executor": [
        "현업이 실제로 쓸 수 있나요?",
        "기존 시스템과 연동되나요?",
        "교육 비용과 시간이 얼마나 드나요?",
    ],
    "innovation-champion": [
        "국회 보고용 성과지표를 만들어줄 수 있나요?",
        "언론에 낼 수 있는 사례가 있나요?",
    ],
}


# ── Pain points ───────────────────────────────────────────────────────────

_PAIN_POINTS = {
    "cautious-gatekeeper": [
        ["감사원 지적 이력", "전임자 실패 사례", "결재권자의 보수적 성향"],
        ["법적 근거 불충분", "사후 평가 기준 미비", "선례 부재"],
    ],
    "security-blocker": [
        ["망연계 사고 이력", "침해사고 대응 인력 부족", "보안 인증 갱신 주기"],
        ["내부망 데이터 유출 사례", "CSAP 갱신 부담", "외부 클라우드 불신"],
    ],
    "budget-guardian": [
        ["예산 삭감 압박", "회계검사 지적 사항", "다년도 계약 리스크"],
        ["집행 잔액 관리", "타 부서 중복 예산", "성과 지표 부재"],
    ],
    "practical-executor": [
        ["기존 시스템 호환성", "현업 교육 부담", "부서 간 일정 조율"],
        ["전산 인력 부족", "업무 전환 기간", "사용자 저항"],
    ],
    "innovation-champion": [
        ["조직 내 보수적 저항", "디지털 역량 격차", "성과 가시화 압박"],
        ["상급부처 보고 부담", "인력 충원 한계", "기술 검증 기간"],
    ],
}


def assign_pain_points(persona_type: str) -> List[str]:
    clusters = _PAIN_POINTS.get(persona_type, _PAIN_POINTS["practical-executor"])
    cluster = random.choice(clusters)
    return cluster[:random.randint(2, 3)]


# ── Goals ─────────────────────────────────────────────────────────────────

_GOALS = {
    "cautious-gatekeeper": [
        "감사 지적 없이 안전하게 시스템 도입 완료",
        "보안 적합성 심의 일회 통과",
        "상위 결재선의 신뢰 확보",
    ],
    "security-blocker": [
        "보안 인증 요건 선제 확보",
        "망분리 환경에서 안전한 서비스 운영",
        "침해사고 발생 시 대응 체계 구축",
    ],
    "budget-guardian": [
        "한정 예산 내 최대 효과 달성",
        "집행 실적 근거 자료 확보",
        "회계검사 대비 완벽한 문서화",
    ],
    "practical-executor": [
        "현업이 직접 활용 가능한 시스템 구축",
        "업무 프로세스 개선 효과 정량화",
        "부서 내 디지털 전환 선도",
    ],
    "innovation-champion": [
        "공공 AI 도입 성공 사례 창출",
        "조직 문화 혁신 주도",
        "성과 보고용 지표 체계 확립",
    ],
}


# ── Grade inference ───────────────────────────────────────────────────────

_GRADE_TABLE: List[Tuple[int, List[str]]] = [
    (58, ["고위공무원단", "3급 부이사관"]),
    (51, ["4급 서기관", "3급 부이사관"]),
    (43, ["5급 사무관", "4급 서기관"]),
    (36, ["6급 주무관", "5급 사무관"]),
    (30, ["7급 주무관", "8급 주무관"]),
    (0, ["9급 주무관"]),
]


def assign_grade(age: int) -> str:
    for threshold, grades in _GRADE_TABLE:
        if age >= threshold:
            return random.choice(grades)
    return "9급 주무관"


# ── Org / org_type inference ──────────────────────────────────────────────

def assign_org(occupation: str, province: str, district: str) -> Tuple[str, str]:
    if "경찰" in occupation:
        return "경찰청", "중앙부처"
    if "소방" in occupation:
        return province + " 소방본부", "광역자치단체"
    if "교육청" in occupation:
        return district + " 교육청", "교육청"
    if "군" in occupation or "국방" in occupation:
        return "국방부", "중앙부처"
    return province + " 청", "광역자치단체"


# ── NIA case matching (same logic as enrich_personas.py) ──────────────────

_PARTICLES = re.compile(r"[은는이가을를의도에에서으로과와만까지도]")


def tokenize_korean(text: str) -> List[str]:
    if not text:
        return []
    raw = re.split(r"[\s,，、;；:：·]+", text)
    tokens: List[str] = []
    for chunk in raw:
        chunk = chunk.strip()
        if not chunk:
            continue
        cleaned = _PARTICLES.sub("", chunk)
        if not cleaned:
            continue
        parts = re.findall(r"[가-힣]+|[a-zA-Z0-9]+", cleaned)
        tokens.extend(p for p in parts if len(p) >= 2)
    return tokens


def score_case(tokens: List[str], case: Dict[str, Any]) -> int:
    case_text = ((case.get("title") or "") + " " + (case.get("summary") or "")).lower()
    return sum(1 for t in tokens if t.lower() in case_text)


def match_top_cases(
    occupation: str,
    cases: List[Dict[str, Any]],
    top_n: int,
) -> List[Dict[str, Any]]:
    tokens = tokenize_korean(occupation)
    if not tokens or not cases:
        return []
    scored = [(case, score_case(tokens, case)) for case in cases]
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


# ── Data loading ──────────────────────────────────────────────────────────

def load_nia_cases(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        eprint("Warning: NIA data not found at '{}'".format(str(path)))
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        items = data.get("items", []) if isinstance(data, dict) else []
        return [item for item in items if isinstance(item, dict)]
    except Exception as exc:
        eprint("Failed to read NIA data: " + str(exc))
        return []


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
            eprint("  scanned {:,} rows, collected {:,}/{:,}".format(
                scanned, len(collected), max_records))

    eprint("  Done. Scanned {:,} rows, collected {:,} records.".format(
        scanned, len(collected)))
    return collected


# ── Persona builder ───────────────────────────────────────────────────────

def build_persona(
    nemotron: Dict[str, Any],
    nia_cases: List[Dict[str, Any]],
) -> Dict[str, Any]:
    base = extract_base(nemotron)
    age = int(base.get("age", 40))
    occupation = base.get("occupation", "")
    province = base.get("province", "")
    district = base.get("district", "")

    persona_type = assign_persona_type(age, occupation)
    org, org_type = assign_org(occupation, province, district)
    refs = match_top_cases(occupation, nia_cases, 3)

    return {
        "name": extract_name(base.get("persona", "")),
        "age": age,
        "sex": base.get("sex", ""),
        "province": province,
        "district": district,
        "occupation": occupation,
        "education_level": base.get("education_level", ""),
        "marital_status": base.get("marital_status", ""),
        "family_type": base.get("family_type", ""),
        "housing_type": base.get("housing_type", ""),
        "grade": assign_grade(age),
        "org": org,
        "org_type": org_type,
        "persona_type": persona_type,
        "tech_savviness": assign_tech_savviness(age),
        "objections": _OBJECTIONS.get(persona_type, []),
        "pain_points": assign_pain_points(persona_type),
        "goals": _GOALS.get(persona_type, _GOALS["practical-executor"]),
        "nemotron_uuid": base.get("uuid", ""),
        "life_persona": base.get("persona", ""),
        "professional_persona": base.get("professional_persona", ""),
        "demographic_background": base.get("cultural_background", ""),
        "career_goals_and_ambitions": base.get("career_goals_and_ambitions", ""),
        "reference_cases": refs,
    }


# ── CLI ───────────────────────────────────────────────────────────────────

def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build Nemotron-base public servant personas with handong patterns."
    )
    parser.add_argument(
        "--nemotron-cache", default="data/nemotron_civil_base.json",
        help="path to cache filtered Nemotron records",
    )
    parser.add_argument(
        "--nia-data", default="data/nia_all_cases.json",
        help="NIA cases JSON file (154 cases for best matching)",
    )
    parser.add_argument(
        "--output", default="examples/example-personas-1000-nemotron.json",
        help="output file for full personas",
    )
    parser.add_argument(
        "--sample-output", default="examples/example-personas-100-nemotron-sample.json",
        help="output file for 100-persona sample",
    )
    parser.add_argument(
        "--max-records", type=int, default=1000,
        help="max Nemotron records to collect",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    random.seed(42)
    args = parse_args(argv)

    cache = Path(args.nemotron_cache)
    if cache.exists():
        eprint("Loading cached Nemotron records from '{}' ...".format(str(cache)))
        nemotron_records = json.loads(cache.read_text(encoding="utf-8"))
        eprint("  {:,} records loaded.".format(len(nemotron_records)))
    else:
        nemotron_records = fetch_nemotron_civil_servants(args.max_records)
        os.makedirs(cache.parent or ".", exist_ok=True)
        cache.write_text(
            json.dumps(nemotron_records, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        eprint("Saved {:,} records to '{}'".format(len(nemotron_records), str(cache)))

    nia_cases = load_nia_cases(Path(args.nia_data))
    if nia_cases:
        eprint("Loaded {:,} NIA cases.".format(len(nia_cases)))

    eprint("Building {:,} personas ...".format(len(nemotron_records)))
    personas: List[Dict[str, Any]] = []
    for rec in nemotron_records:
        personas.append(build_persona(rec, nia_cases))

    output_path = Path(args.output)
    os.makedirs(output_path.parent or ".", exist_ok=True)
    output_path.write_text(
        json.dumps(personas, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    sample_path = Path(args.sample_output)
    os.makedirs(sample_path.parent or ".", exist_ok=True)
    sample_path.write_text(
        json.dumps(personas[:100], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    type_counts: Dict[str, int] = {}
    province_counts: Dict[str, int] = {}
    total_tech = 0
    ref_count = 0
    for p in personas:
        pt = p.get("persona_type", "?")
        type_counts[pt] = type_counts.get(pt, 0) + 1
        prov = p.get("province", "?")
        province_counts[prov] = province_counts.get(prov, 0) + 1
        total_tech += p.get("tech_savviness", 0)
        if p.get("reference_cases"):
            ref_count += 1

    avg_tech = total_tech / len(personas) if personas else 0
    top_provinces = sorted(province_counts.items(), key=lambda x: x[1], reverse=True)[:5]

    eprint("")
    eprint("=== Summary ===")
    eprint("  Total personas built:   {:,}".format(len(personas)))
    eprint("  With NIA references:    {:,}".format(ref_count))
    eprint("")
    eprint("  Persona type distribution:")
    for pt, cnt in sorted(type_counts.items(), key=lambda x: x[1], reverse=True):
        eprint("    {:<25s} {:>5,}".format(pt, cnt))
    eprint("")
    eprint("  Province distribution (top 5):")
    for prov, cnt in top_provinces:
        eprint("    {:<15s} {:>5,}".format(prov, cnt))
    eprint("")
    eprint("  Average tech_savviness:  {:.2f}".format(avg_tech))
    eprint("")
    eprint("  Full output:  '{}'".format(args.output))
    eprint("  Sample output: '{}'".format(args.sample_output))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
