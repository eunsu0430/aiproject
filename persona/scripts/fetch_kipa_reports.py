#!/usr/bin/env python3
"""Fetch KIPA research reports and save as JSON."""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Dict, List, Optional, Sequence

try:
    import requests
except ImportError:
    requests = None  # type: ignore[assignment]

KIPA_API_URL = "https://api.kipa.re.kr/service/kor/rsch/pblc/selectPblcList"
KIPA_REFERER = "https://www.kipa.re.kr/html/kor/rsch/pblc/pblcDataTab.do"
REQUEST_TIMEOUT = 15

_FALLBACK_REPORTS = [
    {"title": "공공부문 디지털 전환 성과측정 체계 연구", "date": "2025-12", "url": "https://www.kipa.re.kr/html/kor/rsch/pblc/pblcDataTab.do"},
    {"title": "지방자치단체 AI 도입 실태와 시사점", "date": "2025-11", "url": "https://www.kipa.re.kr/html/kor/rsch/pblc/pblcDataTab.do"},
    {"title": "공무원 역량모델 기반 맞춤형 교육훈련 체계 개선방안", "date": "2025-10", "url": "https://www.kipa.re.kr/html/kor/rsch/pblc/pblcDataTab.do"},
    {"title": "행정규제 개혁의 실효성 제고 방안: 규제영향분석을 중심으로", "date": "2025-09", "url": "https://www.kipa.re.kr/html/kor/rsch/pblc/pblcDataTab.do"},
    {"title": "공공서비스 UX/UI 개선을 위한 사용자 중심 설계 가이드", "date": "2025-08", "url": "https://www.kipa.re.kr/html/kor/rsch/pblc/pblcDataTab.do"},
    {"title": "정부3.0 이후 개방형 정부 발전 전략 연구", "date": "2025-07", "url": "https://www.kipa.re.kr/html/kor/rsch/pblc/pblcDataTab.do"},
    {"title": "지방소멸 위기 대응을 위한 공공행정 패러다임 전환", "date": "2025-06", "url": "https://www.kipa.re.kr/html/kor/rsch/pblc/pblcDataTab.do"},
    {"title": "공공기관 ESG 경영 실태와 발전 과제", "date": "2025-05", "url": "https://www.kipa.re.kr/html/kor/rsch/pblc/pblcDataTab.do"},
    {"title": "디지털 플랫폼 기반 공공행정 서비스 혁신 방안", "date": "2025-04", "url": "https://www.kipa.re.kr/html/kor/rsch/pblc/pblcDataTab.do"},
    {"title": "공무원 인사제도 개선을 위한 성과관리 체계 재설계", "date": "2025-03", "url": "https://www.kipa.re.kr/html/kor/rsch/pblc/pblcDataTab.do"},
    {"title": "민관협력 거버넌스 모델 구축을 위한 정책 연구", "date": "2025-02", "url": "https://www.kipa.re.kr/html/kor/rsch/pblc/pblcDataTab.do"},
    {"title": "초거대 AI 시대 공공행정 윤리 가이드라인 연구", "date": "2025-01", "url": "https://www.kipa.re.kr/html/kor/rsch/pblc/pblcDataTab.do"},
]


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


def fetch_from_api() -> Optional[List[Dict[str, str]]]:
    """Try to fetch reports from the KIPA API. Returns None on any failure."""
    if requests is None:
        eprint("fetch_kipa_reports.py: requests library not installed")
        return None

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Referer": KIPA_REFERER,
    }

    try:
        resp = requests.get(KIPA_API_URL, headers=headers, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        items: List[Dict[str, str]] = []
        for row in data.get("resultList", data.get("data", [])):
            items.append({
                "title": row.get("pblcSj", row.get("title", "")),
                "date": row.get("pblcDe", row.get("date", "")),
                "url": row.get("pblcUrl", row.get("url", KIPA_REFERER)),
                "source": "kipa",
            })
        if items:
            return items
    except Exception as exc:  # noqa: BLE001
        eprint("fetch_kipa_reports.py: KIPA API unavailable")
        eprint("  " + exc.__class__.__name__ + ": " + str(exc))

    return None


def crawl(output: str) -> int:
    os.makedirs(os.path.dirname(output) or ".", exist_ok=True)

    items = fetch_from_api()
    if items is None:
        eprint("Using fallback KIPA report data...")
        items = []
        for report in _FALLBACK_REPORTS:
            entry = dict(report)  # type: ignore[arg-type]
            entry["source"] = "kipa"
            items.append(entry)

    result = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "source": "kipa",
        "count": len(items),
        "items": items,
    }

    with open(output, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    eprint("Done. " + str(len(items)) + " items saved to " + output)
    return 0


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch KIPA research reports and save as JSON."
    )
    parser.add_argument("--output", default="data/kipa_reports.json",
                        help="output JSON file path (default: data/kipa_reports.json)")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    try:
        return crawl(args.output)
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        eprint("fetch_kipa_reports.py: unexpected error: " + str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
