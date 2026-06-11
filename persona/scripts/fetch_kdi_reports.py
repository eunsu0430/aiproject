#!/usr/bin/env python3
"""Fetch KDI research reports and save as JSON."""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional, Sequence

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.kdi.re.kr"
LIST_URL = BASE_URL + "/research/reportList.do"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
}
REQUEST_TIMEOUT = 15
SEARCH_KEYWORDS = ["AI", "디지털", "공공"]


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


def build_search_url(keyword: str, page: int) -> str:
    return LIST_URL + "?pg=" + str(page) + "&nm=" + keyword


def extract_pub_no(href: str) -> Optional[str]:
    m = re.search(r"pub_no=(\d+)", href)
    if m:
        return m.group(1)
    return None


def parse_report_list(soup: BeautifulSoup) -> List[Dict]:
    results: List[Dict] = []
    for li in soup.find_all("li"):
        anchor = li.find("a", href=True)
        if not anchor:
            continue

        href = anchor.get("href", "")
        pub_no = extract_pub_no(href)
        if not pub_no:
            continue

        rpt_tit = anchor.find("div", class_="rpt_tit")
        if not rpt_tit:
            continue

        title_tag = rpt_tit.find("strong")
        title = title_tag.get_text(strip=True) if title_tag else ""

        cat_tag = rpt_tit.find("b", class_="i12")
        category = cat_tag.get_text(strip=True) if cat_tag else ""

        url = BASE_URL + "/research/reportView?pub_no=" + pub_no

        author = ""
        topics = []
        rpt_other = li.find("div", class_="rpt_other")
        if rpt_other:
            em_tag = rpt_other.find("em")
            if em_tag:
                for topic_a in em_tag.find_all("a"):
                    t = topic_a.get_text(strip=True).lstrip("#")
                    if t:
                        topics.append(t)
            p_tag = rpt_other.find("p")
            if p_tag:
                spans = p_tag.find_all("span")
                if spans:
                    author = spans[0].get_text(strip=True)

        results.append({
            "title": title,
            "url": url,
            "category": category,
            "author": author,
            "topics": topics,
            "source": "kdi",
        })

    return results


def fetch_page(url: str, session: requests.Session) -> Optional[BeautifulSoup]:
    try:
        resp = session.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding or "utf-8"
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as exc:
        eprint("fetch_kdi_reports.py: failed to fetch " + url)
        eprint("  " + exc.__class__.__name__ + ": " + str(exc))
        return None


def crawl(output: str) -> int:
    os.makedirs(os.path.dirname(output) or ".", exist_ok=True)

    session = requests.Session()
    items: List[Dict] = []
    seen: set = set()

    for keyword in SEARCH_KEYWORDS:
        eprint("\n[Keyword: " + keyword + "]")
        url = build_search_url(keyword, 1)
        eprint("  Fetching " + url)
        soup = fetch_page(url, session)
        if soup is None:
            continue

        reports = parse_report_list(soup)
        eprint("    Found " + str(len(reports)) + " entries")

        for report in reports:
            pub_no = extract_pub_no(report["url"])
            if pub_no and pub_no in seen:
                continue
            if pub_no:
                seen.add(pub_no)
            items.append(report)
            eprint("    [" + str(len(items)) + "] " + report["title"])

        time.sleep(1)

    result = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "source": "kdi",
        "count": len(items),
        "items": items,
    }

    with open(output, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    eprint("Done. " + str(len(items)) + " items saved to " + output)
    return 0


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scrape KDI research reports and save as JSON."
    )
    parser.add_argument("--output", default="data/kdi_reports.json",
                        help="output JSON file path (default: data/kdi_reports.json)")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    try:
        return crawl(args.output)
    except Exception as exc:
        eprint("fetch_kdi_reports.py: unexpected error: " + str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
