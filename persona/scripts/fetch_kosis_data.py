#!/usr/bin/env python3
"""Fetch civil servant statistics from KOSIS (kosis.kr) via proxy or direct API.

Searches for tables matching keywords like '공무원 현황', '공무원 직급별',
'공무원 연령별' and saves the results to JSON.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

PROXY_BASE_URL = "https://k-skill-proxy.nomadamas.org"
KOSIS_SEARCH_URL = "https://kosis.kr/openapi/statisticsSearch.do"
KOSIS_DATA_URL = "https://kosis.kr/openapi/Param/statisticsParameterData.do"
REQUEST_TIMEOUT = 30
USER_AGENT = "korean-synthetic-public-ax/1.0"

DEFAULT_KEYWORDS = ["공무원 현황", "공무원 직급별", "공무원 연령별"]


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


def fix_unquoted_keys(text: str) -> str:
    """KOSIS sometimes returns JSON with unquoted keys."""
    return re.sub(r'([{,])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:', r'\1"\2":', text)


def parse_kosis_json(text: str) -> Any:
    body = text.strip()
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return json.loads(fix_unquoted_keys(body))


_XML_ERROR_RE = re.compile(
    r"<error>\s*<err>([^<]*)</err>\s*<errMsg>([^<]*)</errMsg>", re.IGNORECASE
)


def detect_error(text: str) -> Optional[str]:
    """Detect KOSIS error from XML or JSON response. Returns error message or None."""
    xml_match = _XML_ERROR_RE.search(text)
    if xml_match:
        code = xml_match.group(1).strip()
        msg = xml_match.group(2).strip()
        return "KOSIS error " + code + ": " + msg

    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        payload = None

    if isinstance(payload, dict):
        err_msg = payload.get("errMsg")
        if err_msg:
            code = str(payload.get("err", "")).strip()
            return "KOSIS error " + code + ": " + str(err_msg)

    return None


def http_get(url: str, timeout: int) -> str:
    """HTTP GET returning text body. Raises on non-2xx."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        return resp.read().decode(charset, errors="replace")


def search_via_proxy(
    keyword: str,
    base_url: str,
    result_count: int,
    timeout: int,
) -> List[Dict[str, Any]]:
    """Search KOSIS tables via k-skill-proxy (no API key needed)."""
    endpoint = base_url.rstrip("/") + "/v1/kosis/search"
    params = {
        "method": "getList",
        "format": "json",
        "jsonVD": "Y",
        "searchNm": keyword,
        "resultCount": str(result_count),
        "startCount": "1",
    }
    url = endpoint + "?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    eprint("  Proxy: " + url[:120] + "...")

    try:
        text = http_get(url, timeout)
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        eprint("  HTTP " + str(exc.code) + ": " + body[:200])
        return []
    except Exception as exc:
        eprint("  Network error: " + str(exc))
        return []

    err = detect_error(text)
    if err:
        eprint("  " + err)
        return []

    payload = parse_kosis_json(text)
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    return []


def search_direct(
    keyword: str,
    api_key: str,
    result_count: int,
    timeout: int,
) -> List[Dict[str, Any]]:
    """Search KOSIS tables directly with API key."""
    params = {
        "method": "getList",
        "apiKey": api_key,
        "format": "json",
        "jsonVD": "Y",
        "searchNm": keyword,
        "resultCount": str(result_count),
        "startCount": "1",
    }
    url = KOSIS_SEARCH_URL + "?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    eprint("  Direct: " + url[:120] + "...")

    try:
        text = http_get(url, timeout)
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        eprint("  HTTP " + str(exc.code) + ": " + body[:200])
        return []
    except Exception as exc:
        eprint("  Network error: " + str(exc))
        return []

    err = detect_error(text)
    if err:
        eprint("  " + err)
        return []

    payload = parse_kosis_json(text)
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    return []


def fetch_data_via_proxy(
    org_id: str,
    tbl_id: str,
    base_url: str,
    timeout: int,
) -> List[Dict[str, Any]]:
    """Fetch actual data for a table via proxy."""
    endpoint = base_url.rstrip("/") + "/v1/kosis/data"
    params = {
        "method": "getList",
        "format": "json",
        "jsonVD": "Y",
        "orgId": org_id,
        "tblId": tbl_id,
        "itmId": "ALL",
        "prdSe": "Y",
        "startPrdDe": "2020",
        "endPrdDe": "2025",
        "objL1": "ALL",
    }
    url = endpoint + "?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    eprint("  Data proxy: " + org_id + "/" + tbl_id)

    try:
        text = http_get(url, timeout)
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        eprint("  HTTP " + str(exc.code) + ": " + body[:200])
        return []
    except Exception as exc:
        eprint("  Network error: " + str(exc))
        return []

    err = detect_error(text)
    if err:
        eprint("  " + err)
        return []

    payload = parse_kosis_json(text)
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    return []


def crawl(output: str, keywords: List[str], result_count: int, timeout: int) -> int:
    os.makedirs(os.path.dirname(output) or ".", exist_ok=True)

    api_key = os.environ.get("KSKILL_KOSIS_API_KEY", "").strip()
    proxy_url = PROXY_BASE_URL

    all_tables: List[Dict[str, Any]] = []
    all_data: List[Dict[str, Any]] = []
    seen_tbl_ids: set = set()

    for keyword in keywords:
        eprint("\nSearching: " + keyword)

        # Try proxy first
        tables = search_via_proxy(keyword, proxy_url, result_count, timeout)

        # If proxy failed and we have an API key, try direct
        if not tables and api_key:
            eprint("  Proxy returned no results, trying direct API...")
            tables = search_direct(keyword, api_key, result_count, timeout)

        for table in tables:
            tbl_id = table.get("TBL_ID", "")
            org_id = table.get("ORG_ID", "101")
            if tbl_id and tbl_id not in seen_tbl_ids:
                seen_tbl_ids.add(tbl_id)
                all_tables.append(table)

                # Try to fetch some actual data for this table
                if api_key or proxy_url:
                    data_rows = fetch_data_via_proxy(org_id, tbl_id, proxy_url, timeout)
                    for row in data_rows:
                        row["_keyword"] = keyword
                        row["_tbl_id"] = tbl_id
                        all_data.append(row)

        eprint("  Found " + str(len(tables)) + " tables for '" + keyword + "'")

    result: Dict[str, Any] = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "source": "KOSIS",
        "keywords_used": keywords,
        "table_count": len(all_tables),
        "data_row_count": len(all_data),
        "tables": all_tables,
        "data": all_data,
    }

    if not all_tables and not all_data:
        result["message"] = (
            "No data found. Possible reasons: proxy unavailable, "
            "API key not set (KSKILL_KOSIS_API_KEY), or no matching tables. "
            "Try setting KSKILL_KOSIS_API_KEY env var or check proxy availability."
        )
        eprint("\nWarning: " + result["message"])

    with open(output, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    eprint("\nDone. " + str(len(all_tables)) + " tables, "
           + str(len(all_data)) + " data rows saved to " + output)
    return 0


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch civil servant statistics from KOSIS and save as JSON."
    )
    parser.add_argument(
        "--output", default="data/kosis_civil_servant.json",
        help="output JSON file path (default: data/kosis_civil_servant.json)",
    )
    parser.add_argument(
        "--keywords", nargs="*", default=None,
        help="search keywords (default: 공무원 현황, 공무원 직급별, 공무원 연령별)",
    )
    parser.add_argument(
        "--result-count", type=int, default=20,
        help="number of search results per keyword (default: 20)",
    )
    parser.add_argument(
        "--timeout", type=int, default=REQUEST_TIMEOUT,
        help="HTTP timeout in seconds (default: 30)",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    keywords = args.keywords if args.keywords else DEFAULT_KEYWORDS
    try:
        return crawl(args.output, keywords, args.result_count, args.timeout)
    except Exception as exc:
        eprint("fetch_kosis_data.py: unexpected error: " + str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
