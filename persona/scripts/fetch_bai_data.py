#!/usr/bin/env python3
"""Fetch audit results from the Board of Audit and Inspection (bai.go.kr) and save as JSON."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence

from playwright.async_api import async_playwright, Page

BASE_URL = "https://www.bai.go.kr/bai/result/branch/list"
API_URL = "https://www.bai.go.kr/api/bak/dar/AWUBAKDAR001E"
DETAIL_URL_PREFIX = "https://www.bai.go.kr/bai/result/branch/detail?srno="
DEFAULT_KEYWORDS = ["정보시스템", "인공지능", "클라우드", "전산", "디지털"]
MAX_PAGES = 5
PAGE_LOAD_TIMEOUT = 30000
POLL_DELAY = 1
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


async def extract_via_api(
    page: Page,
    keyword: str,
    max_pages: int,
) -> List[Dict[str, str]]:
    """Use Playwright to call the backend API that powers the SPA list page.

    The SPA at /result/branch/list fetches data from /api/bak/dar/AWUBAKDAR001E.
    We navigate to the SPA first, then use page.evaluate to call the API via
    fetch() from within the browser context (avoids CORS issues and leverages
    any session cookies the SPA sets).
    """
    items: List[Dict[str, str]] = []
    seen_keys: set = set()

    for pg in range(max_pages):
        url = (
            API_URL
            + "?searchType=0&searchText="
            + keyword
            + "&fromRegiDt=&toRegiDt=&searchYear="
            + "&audSphCd=&audSphDtlCd=&audKndCd="
            + "&size=10&index=0&page="
            + str(pg)
        )

        raw: Optional[str] = await page.evaluate(
            'async (url) => { try { const r = await fetch(url); return await r.text(); } catch(e) { return null; } }',
            url,
        )
        if not raw:
            eprint("  Page " + str(pg + 1) + ": API request failed")
            break

        try:
            data: Dict[str, Any] = json.loads(raw)
        except json.JSONDecodeError:
            eprint("  Page " + str(pg + 1) + ": invalid JSON response")
            break

        dto_list = data.get("_embedded", {}).get("aWUBAKDAR001EDtoList", [])
        if not dto_list:
            break

        page_info = data.get("page", {})
        total_pages = page_info.get("totalPages", 1)

        page_count = 0
        for item in dto_list:
            srno = item.get("srno")
            title = (item.get("titNm") or "").strip()
            if not title:
                continue

            dedup_key = title + "|" + str(item.get("openDt", ""))
            if dedup_key in seen_keys:
                continue
            seen_keys.add(dedup_key)

            open_dt = item.get("openDt", "")
            audit_date = (
                open_dt[:4] + "-" + open_dt[4:6] + "-" + open_dt[6:8]
                if len(open_dt) == 8
                else open_dt
            )

            aud_knd = item.get("audKndNm") or ""
            aud_sph = item.get("audSphDtlNm") or ""
            summary_parts = [p for p in [aud_knd, aud_sph] if p]
            summary = " | ".join(summary_parts) if summary_parts else ""

            items.append(
                {
                    "title": title,
                    "org": aud_sph,
                    "audit_date": audit_date,
                    "summary": summary,
                    "url": DETAIL_URL_PREFIX + str(srno) if srno else BASE_URL,
                    "keyword": keyword,
                }
            )
            page_count += 1

        eprint(
            "  Page "
            + str(pg + 1)
            + "/"
            + str(total_pages)
            + ": "
            + str(page_count)
            + " items"
        )

        if pg + 1 >= total_pages:
            break

        time.sleep(POLL_DELAY)

    return items


async def crawl(output: str, keywords: List[str], max_pages: int) -> int:
    os.makedirs(os.path.dirname(output) or ".", exist_ok=True)

    all_items: List[Dict[str, str]] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox"],
        )
        context = await browser.new_context(
            user_agent=USER_AGENT,
            viewport={"width": 1280, "height": 900},
        )
        page = await context.new_page()

        # Navigate to the SPA to establish the browser context
        await page.goto(BASE_URL, wait_until="networkidle", timeout=PAGE_LOAD_TIMEOUT)
        await page.wait_for_timeout(1000)

        for keyword in keywords:
            eprint("\n[" + keyword + "] Searching...")
            try:
                items = await extract_via_api(page, keyword, max_pages)
                eprint("  Found " + str(len(items)) + " results for '" + keyword + "'")
                all_items.extend(items)
            except Exception as exc:  # noqa: BLE001
                eprint("  Error searching '" + keyword + "': " + str(exc))
            time.sleep(POLL_DELAY)

        await browser.close()

    # Deduplicate across keywords by title + audit_date
    seen: set = set()
    deduped: List[Dict[str, str]] = []
    for item in all_items:
        key = item["title"] + "|" + item["audit_date"]
        if key not in seen:
            seen.add(key)
            deduped.append(item)

    result = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "source": "감사원",
        "total": len(deduped),
        "items": deduped,
    }

    with open(output, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    eprint("\nDone. " + str(len(deduped)) + " items saved to " + output)
    return 0


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scrape audit results from bai.go.kr (감사원) and save as JSON."
    )
    parser.add_argument(
        "--output",
        default="data/bai_audit_results.json",
        help="output JSON file path (default: data/bai_audit_results.json)",
    )
    parser.add_argument(
        "--keywords",
        nargs="*",
        default=None,
        help="search keywords (default: 정보시스템 인공지능 클라우드 전산 디지털)",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=MAX_PAGES,
        help="max pages per keyword (default: 5)",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    keywords = args.keywords if args.keywords else DEFAULT_KEYWORDS
    try:
        return asyncio.run(crawl(args.output, keywords, args.max_pages))
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        eprint("fetch_bai_data.py: unexpected error: " + str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
