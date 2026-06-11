#!/usr/bin/env python3
"""Fetch public bid data from the Korean G2B (나라장터) open API and save as JSON."""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence

import requests

API_URL = "https://apis.data.go.kr/1230000/BidPublicInfoService04/getBidPblancListInfoServc"
DEFAULT_KEYWORDS = ["AI", "인공지능", "디지털전환", "AX사업", "클라우드"]
REQUEST_TIMEOUT = 30


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


def fetch_keyword(
    keyword: str,
    api_key: str,
    start_date: str,
    end_date: str,
    num_rows: int = 100,
) -> List[Dict[str, Any]]:
    """Fetch bid notices for a single keyword from G2B API."""
    params: Dict[str, str] = {
        "serviceKey": api_key,
        "numOfRows": str(num_rows),
        "pageNo": "1",
        "type": "json",
        "inqryDiv": "1",
        "inqryBgnDt": start_date,
        "inqryEndDt": end_date,
        "keyword": keyword,
    }
    try:
        resp = requests.get(API_URL, params=params, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
    except requests.exceptions.HTTPError as exc:
        eprint(f"fetch_g2b_data.py: HTTP error for keyword '{keyword}'")
        eprint(f"  {exc}")
        return []
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        eprint(f"fetch_g2b_data.py: failed to fetch keyword '{keyword}'")
        eprint(f"  {exc.__class__.__name__}: {exc}")
        return []

    # G2B API returns { response: { body: { items: [...] } } }
    try:
        items = data["response"]["body"]["items"]["item"]
        if not isinstance(items, list):
            items = [items]
        return items
    except (KeyError, TypeError):
        # No items or unexpected structure
        return []


def deduplicate(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Deduplicate items by bidNtceNo field, keeping first occurrence."""
    seen: set[str] = set()
    deduped: List[Dict[str, Any]] = []
    for item in items:
        key = item.get("bidNtceNo", "")
        if key and key not in seen:
            seen.add(key)
            deduped.append(item)
        elif not key:
            deduped.append(item)
    return deduped


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Fetch public bid data from the Korean G2B (나라장터) API."
    )
    parser.add_argument("--output", default="data/g2b_bid_history.json",
                        help="output JSON file path (default: data/g2b_bid_history.json)")
    parser.add_argument("--start-date", default="20240101",
                        help="inquiry start date in YYYYMMDD format (default: 20240101)")
    parser.add_argument("--end-date", default="20260518",
                        help="inquiry end date in YYYYMMDD format (default: 20260518)")
    parser.add_argument("--keywords", nargs="*", default=None,
                        help="search keywords (default: AI 인공지능 디지털전환 AX사업 클라우드)")
    args = parser.parse_args(argv)

    api_key = os.environ.get("G2B_API_KEY")
    if not api_key:
        eprint("fetch_g2b_data.py: G2B_API_KEY environment variable is not set.")
        eprint("  Export your API key before running:")
        eprint("    export G2B_API_KEY='your-api-key-here'")
        return 1

    keywords = args.keywords if args.keywords else DEFAULT_KEYWORDS
    os.makedirs("data", exist_ok=True)

    all_items: List[Dict[str, Any]] = []
    counts: Dict[str, int] = {}

    for keyword in keywords:
        eprint(f"Fetching keyword: {keyword} ...")
        items = fetch_keyword(keyword, api_key, args.start_date, args.end_date)
        counts[keyword] = len(items)
        all_items.extend(items)
        eprint(f"  {keyword}: {len(items)} items")

    deduped = deduplicate(all_items)
    result: Dict[str, Any] = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "source": "G2B",
        "count": len(deduped),
        "keywords_used": keywords,
        "items": deduped,
    }

    out_dir = os.path.dirname(args.output)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    eprint("")
    eprint("--- Summary ---")
    for keyword in keywords:
        eprint(f"  {keyword}: {counts.get(keyword, 0)} items")
    eprint(f"  Total fetched: {sum(counts.values())}")
    eprint(f"  Deduplicated:  {len(deduped)}")
    eprint(f"  Saved to:      {args.output}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
