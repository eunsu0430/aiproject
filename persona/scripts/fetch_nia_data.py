#!/usr/bin/env python3
"""Fetch NIA AI cases from the NIA bulletin board and save as JSON."""
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
from bs4 import BeautifulSoup, Tag

BASE_URL = "https://www.nia.or.kr"
LIST_URL = f"{BASE_URL}/site/nia_kor/ex/bbs/List.do"
VIEW_PATH_RE = re.compile(r"^/site/nia_kor/ex/bbs/View\.do\?cbIdx=99953&(?:amp;)?bcIdx=(\d+)")
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
}
REQUEST_TIMEOUT = 15

# NIA 수집 대상 게시판 목록 (cbIdx: 설명)
NIA_BOARDS = [
    {"cbIdx": "99953", "label": "AI활용사례", "pages": 1},
    {"cbIdx": "44086", "label": "국가지능정보화백서", "pages": 2},
    {"cbIdx": "65684", "label": "정보화정솵저널", "pages": 2},
    {"cbIdx": "37989", "label": "AI.gov", "pages": 1},
    {"cbIdx": "32639", "label": "전자정부이용실태", "pages": 2},
    {"cbIdx": "39485", "label": "이슈분석", "pages": 2},
    {"cbIdx": "82618", "label": "지능사회이슈분석", "pages": 2},
    {"cbIdx": "66361", "label": "정책연구", "pages": 2},
    {"cbIdx": "26537", "label": "ICT동향분석", "pages": 2},
]


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


def build_list_url(cb_idx: str, page: int) -> str:
    return LIST_URL + "?cbIdx=" + cb_idx + "&pageIndex=" + str(page)


def extract_view_links(soup: BeautifulSoup, cb_idx: str) -> List[Dict[str, str]]:
    """Return list of {url, title} dicts found on a list page for given cbIdx.

    Supports two link patterns:
    1. <a href="/site/.../View.do?cbIdx=...&bcIdx=..."> (direct href)
    2. <a onclick="doBbsFView('cbIdx','bcIdx','cat','parentSeq')"> (JS onclick)
    """
    results: List[Dict[str, str]] = []
    seen: set = set()

    subjects = []
    for span in soup.find_all(class_="subject"):
        t = span.get_text(strip=True)
        if t and len(t) > 3:
            subjects.append(t)

    # Pattern 1: direct href
    view_re = re.compile("/site/nia_kor/ex/bbs/View\.do.*cbIdx=" + cb_idx + ".*bcIdx=\\d+")
    hrefs = [a["href"] for a in soup.find_all("a", href=view_re)]
    for i, href in enumerate(hrefs):
        url = BASE_URL + href
        if url in seen:
            continue
        seen.add(url)
        title = subjects[i] if i < len(subjects) else ""
        results.append({"url": url, "title": title})

    # Pattern 2: onclick doBbsFView('cbIdx','bcIdx','cat','parentSeq')
    if not results:
        onclick_re = re.compile(
            r"doBbsFView\('" + cb_idx + r"','(\d+)','[^']*','(\d+)'\)"
        )
        idx = 0
        for tag in soup.find_all(onclick=onclick_re):
            m = onclick_re.search(tag.get("onclick", ""))
            if not m:
                continue
            bc_idx, parent_seq = m.group(1), m.group(2)
            url = (
                BASE_URL
                + "/site/nia_kor/ex/bbs/View.do?cbIdx="
                + cb_idx
                + "&bcIdx="
                + bc_idx
                + "&parentSeq="
                + parent_seq
            )
            if url in seen:
                continue
            seen.add(url)
            title = subjects[idx] if idx < len(subjects) else ""
            results.append({"url": url, "title": title})
            idx += 1

    return results


def extract_detail(soup: BeautifulSoup) -> Dict[str, Optional[str]]:
    """Extract title and body text from a NIA detail/view page."""
    title: Optional[str] = None
    body: str = ""

    # NIA AI활용사례: img alt attribute holds the case title
    for img in soup.find_all("img"):
        alt = img.get("alt", "").strip()
        if alt and len(alt) > 5 and "썸네일" not in alt and "로고" not in alt:
            title = alt.replace(" 썸네일", "").strip()
            break

    # Fallback: .subject class (used for next/prev nav, take first meaningful one)
    if not title:
        for tag in soup.find_all(class_="subject"):
            t = tag.get_text(strip=True)
            if t and len(t) > 5:
                title = t
                break

    # Body: collect p tag text from main content area
    paras = []
    for p in soup.find_all("p"):
        t = p.get_text(strip=True)
        if len(t) > 20 and "한국지능정보사회진흥원" not in t and "Copyright" not in t:
            paras.append(t)
    if paras:
        body = " ".join(paras)

    # Fallback: largest div text block
    if not body:
        for div in soup.find_all("div"):
            text = div.get_text(separator=" ", strip=True)
            if len(text) > len(body) and "한국지능정보사회진흥원" not in text[:50]:
                body = text

    return {"title": title, "body": body[:600]}


def fetch_page(url: str, session: requests.Session) -> Optional[BeautifulSoup]:
    try:
        resp = session.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding or "utf-8"
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as exc:  # noqa: BLE001
        eprint(f"fetch_nia_data.py: failed to fetch {url}")
        eprint(f"  {exc.__class__.__name__}: {exc}")
        return None


def crawl(output: str) -> int:
    os.makedirs(os.path.dirname(output) or ".", exist_ok=True)

    session = requests.Session()
    items: List[Dict[str, str]] = []
    seen: set[str] = set()

    for board in NIA_BOARDS:
        cb_idx = board["cbIdx"]
        label = board["label"]
        board_pages = board["pages"]
        eprint(f"\n[{label}] cbIdx={cb_idx} ({board_pages} pages)")

        for page in range(1, board_pages + 1):
            eprint(f"  Fetching page {page}/{board_pages} ...")
            list_soup = fetch_page(build_list_url(cb_idx, page), session)
            if list_soup is None:
                continue

            view_links = extract_view_links(list_soup, cb_idx)
            eprint("    Found " + str(len(view_links)) + " links")

            for entry in view_links:
                link = entry["url"]
                list_title = entry.get("title", "")
                if link in seen:
                    continue
                seen.add(link)

                time.sleep(1)
                detail_soup = fetch_page(link, session)
                if detail_soup is None:
                    continue

                detail = extract_detail(detail_soup)
                title = list_title or detail["title"] or "(제목 없음)"
                items.append({
                    "title": title,
                    "url": link,
                    "category": label,
                    "summary": detail["body"],
                })
                eprint("    [" + str(len(items)) + "] " + title)

    result = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "source": "NIA",
        "count": len(items),
        "items": items,
    }

    with open(output, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    eprint(f"Done. {len(items)} items saved to {output}")
    return 0


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scrape NIA AI cases from the NIA bulletin board and save as JSON."
    )
    parser.add_argument("--output", default="data/nia_ai_cases.json",
                        help="output JSON file path (default: data/nia_ai_cases.json)")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    try:
        return crawl(args.output)
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        eprint("fetch_nia_data.py: unexpected error: " + str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
