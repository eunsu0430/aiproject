#!/usr/bin/env python3
"""Classify ministry press releases into 5 behavioral archetypes via keyword matching."""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, List, Optional, Sequence


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


ARCHETYPES: Dict[str, Dict[str, Any]] = {
    "archetype_A": {
        "name": "예산절감형",
        "description": (
            "효율적 예산 집행을 최우선 가치로 삼는 재정 관료. "
            "민간 활력을 강조하며, 정부 직접 투자보다 유도 정책을 선호한다."
        ),
        "keyword_signals": [
            "효율적", "예산", "집행", "민간 활력", "책임",
            "재정", "절감", "투자", "유치", "효율화",
            "절약", "합리화", "재원", "부담",
        ],
    },
    "archetype_B": {
        "name": "성과쇼케이스형",
        "description": (
            "가시적 성과와 홍보를 우선시하는 관료. "
            "세계 최초, 국민 체감 등의 수식어를 활용하며, 지표 중심으로 성과를 관리한다."
        ),
        "keyword_signals": [
            "국민 체감", "세계 최초", "성과지표", "홍보", "성과",
            "최초", "글로벌", "선도", "달성", "혁신 도시",
            "벤치마킹", "KPI", "실적",
        ],
    },
    "archetype_C": {
        "name": "리스크회피형",
        "description": (
            "안전과 검증을 최우선하는 신중한 관료. "
            "단계적 추진과 신중한 검토를 강조하며, 실패 리스크를 극도로 회피한다."
        ),
        "keyword_signals": [
            "안전성", "검증", "단계적", "추진", "신중",
            "검토", "위험", "보안", "인증", "심의",
            "승인", "점검", "관리", "통제", "사전",
        ],
    },
    "archetype_D": {
        "name": "민간위탁선호형",
        "description": (
            "정부의 직접 역할을 최소화하고 민간 전문성에 의존하는 관료. "
            "생태계 조성과 지원 사업을 선호한다."
        ),
        "keyword_signals": [
            "민간", "전문성", "생태계", "조성", "지원",
            "사업", "위탁", "협력", "파트너십", "플랫폼",
            "오픈", "민관", "도입", "외부",
        ],
    },
    "archetype_E": {
        "name": "직접통제선호형",
        "description": (
            "정부가 직접 인프라를 구축하고 통제하는 것을 선호하는 관료. "
            "공공 인프라와 정부 주도를 강조한다."
        ),
        "keyword_signals": [
            "정부 주도", "공공", "인프라", "직접", "구축",
            "국가", "공공서비스", "관리", "운영", "체계",
            "시스템", "중앙", "통합",
        ],
    },
}

ARCHETYPE_ORDER = [
    "archetype_A", "archetype_B", "archetype_C",
    "archetype_D", "archetype_E",
]


def count_keyword_matches(
    text: str,
    keywords: List[str],
) -> List[str]:
    """Return list of keywords found in text."""
    return [kw for kw in keywords if kw in text]


def classify_release(
    text: str,
) -> List[str]:
    """Return archetype keys that match the given text."""
    scores: Dict[str, int] = {}
    matched_map: Dict[str, List[str]] = {}
    for key, spec in ARCHETYPES.items():
        matched = count_keyword_matches(text, spec["keyword_signals"])
        matched_map[key] = matched
        scores[key] = len(matched)

    # Tag all archetypes with >= 2 matches
    threshold_pass = [
        k for k in ARCHETYPE_ORDER if scores[k] >= 2
    ]
    if threshold_pass:
        return threshold_pass

    # Fallback: assign the archetype with highest score
    max_score = max(scores.values()) if scores else 0
    if max_score <= 0:
        return []

    return [k for k in ARCHETYPE_ORDER if scores[k] == max_score]


def load_press_releases(path: str) -> List[Dict[str, Any]]:
    if not os.path.exists(path):
        eprint("Input file not found: " + path)
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as exc:
        eprint("Failed to read input: " + str(exc))
        return []

    if not isinstance(data, dict):
        eprint("Input JSON root must be an object with 'items' key.")
        return []

    items = data.get("items")
    if not isinstance(items, list):
        eprint("Input JSON 'items' must be a list.")
        return []

    return [item for item in items if isinstance(item, dict)]


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Classify press releases into behavioral archetypes."
    )
    parser.add_argument(
        "--input",
        default="data/ministry_press_releases.json",
        help="input press releases JSON file",
    )
    parser.add_argument(
        "--output",
        default="data/archetype_patterns.json",
        help="output archetype patterns JSON file",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)

    releases = load_press_releases(args.input)
    if not releases:
        eprint("No press releases loaded. Producing fallback output.")
        # Build fallback output with empty examples
        archetypes_out: Dict[str, Any] = {}
        for key, spec in ARCHETYPES.items():
            archetypes_out[key] = {
                "name": spec["name"],
                "description": spec["description"],
                "keyword_signals": spec["keyword_signals"],
                "frequency": 0,
                "examples": [],
            }
        output = {"archetypes": archetypes_out, "ministry_profiles": {}}
        os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        eprint("Fallback output saved to " + args.output)
        return 0

    eprint("Loaded " + str(len(releases)) + " press releases.")

    # Per-archetype tracking
    freq: Dict[str, int] = {k: 0 for k in ARCHETYPE_ORDER}
    examples_map: Dict[str, List[Dict[str, Any]]] = {
        k: [] for k in ARCHETYPE_ORDER
    }

    # Per-ministry tracking
    ministry_scores: Dict[str, Dict[str, int]] = {}

    for release in releases:
        title = release.get("title") or ""
        summary = release.get("summary") or ""
        ministry = release.get("ministry") or "unknown"
        text = title + " " + summary

        tags = classify_release(text)

        if not tags:
            # No match at all — skip (still count as processed)
            continue

        for tag in tags:
            freq[tag] += 1
            matched_kw = count_keyword_matches(
                text, ARCHETYPES[tag]["keyword_signals"]
            )
            entry = {
                "title": title,
                "ministry": ministry,
                "matched_keywords": matched_kw,
            }
            examples_map[tag].append(entry)

        # Ministry profile
        if ministry not in ministry_scores:
            ministry_scores[ministry] = {k: 0 for k in ARCHETYPE_ORDER}
        for tag in tags:
            ministry_scores[ministry][tag] += 1

    # Build archetype output with top-5 examples each
    archetypes_out: Dict[str, Any] = {}
    for key in ARCHETYPE_ORDER:
        spec = ARCHETYPES[key]
        exs = examples_map[key]
        # Sort by number of matched keywords descending, then take top 5
        exs.sort(key=lambda e: len(e["matched_keywords"]), reverse=True)
        top_exs = exs[:5]

        # Ensure at least 1 example per archetype via fallback
        if not top_exs:
            # Pick the first release as a fallback example
            first = releases[0]
            top_exs = [{
                "title": first.get("title") or "(no title)",
                "ministry": first.get("ministry") or "unknown",
                "matched_keywords": [],
            }]

        archetypes_out[key] = {
            "name": spec["name"],
            "description": spec["description"],
            "keyword_signals": spec["keyword_signals"],
            "frequency": freq[key],
            "examples": top_exs,
        }

    # Build ministry profiles
    ministry_profiles: Dict[str, Any] = {}
    for ministry, scores in ministry_scores.items():
        dominant = max(ARCHETYPE_ORDER, key=lambda k: scores[k])
        if scores[dominant] == 0:
            dominant = "archetype_A"
        ministry_profiles[ministry] = {
            "dominant_archetype": dominant,
            "scores": {k: scores[k] for k in ARCHETYPE_ORDER},
        }

    output = {
        "archetypes": archetypes_out,
        "ministry_profiles": ministry_profiles,
    }

    output_dir = os.path.dirname(args.output)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    eprint("Archetype classification saved to " + args.output)
    for key in ARCHETYPE_ORDER:
        eprint(
            "  " + key + " (" + ARCHETYPES[key]["name"] + "): "
            + str(freq[key]) + " releases"
        )
    eprint("Ministries profiled: " + str(len(ministry_profiles)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
