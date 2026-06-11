#!/usr/bin/env python3
"""Build a markdown scaffold/prompt for a Korean synthetic consumer panel."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

MODES = ["message-test", "product-fit", "objection-map", "persona-panel", "interview-script", "proposal-stress-test", "procurement-review", "full-report"]


def load_personas(path: Path) -> List[Dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        for key in ("personas", "items", "rows", "data"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
    if not isinstance(data, list):
        raise ValueError("persona JSON must be a list or an object with personas/items/rows/data list")
    return [item for item in data if isinstance(item, dict)]


def val(persona: Dict[str, Any], *keys: str, default: str = "-") -> str:
    lowered = {str(k).lower(): v for k, v in persona.items()}
    for key in keys:
        if key in persona and persona[key] not in (None, ""):
            return str(persona[key])
        lk = key.lower()
        if lk in lowered and lowered[lk] not in (None, ""):
            return str(lowered[lk])
    return default


def persona_card(persona: Dict[str, Any], idx: int) -> str:
    name = val(persona, "name", "이름", "persona", default=f"Persona {idx}")
    basics = ", ".join(
        part for part in [
            val(persona, "age", "나이", default=""),
            val(persona, "gender", "성별", default=""),
            val(persona, "region", "location", "거주", "지역", default=""),
            val(persona, "occupation", "job", "직업", default=""),
        ] if part
    )
    summary = val(persona, "summary", "description", "persona", "source_excerpt", default="")
    return f"### P{idx}. {name}\n- 기본: {basics or '-'}\n- 세그먼트: {val(persona, 'persona_type', 'type', 'segment', default='-')}\n- 라이프스테이지: {val(persona, 'life_stage', 'lifeStage', 'age_group', default='-')}\n- 배경/단서: {summary[:700] or '-'}\n"


def mode_questions(mode: str) -> str:
    blocks = {
        "message-test": [
            "제안서 첫 문단/PT 첫 슬라이드를 보고 드는 즉각적 감정과 오해는?",
            "공무원으로서 신뢰가 깎이는 표현이나 과장처럼 들리는 부분은?",
            "더 믿기 위해 필요한 증거/인증/레퍼런스는?",
            "상급자에게 이 사업을 설명할 때 어려운 부분은?",
        ],
        "product-fit": [
            "현재 업무 흐름에서 이 제품이 실제로 들어갈 수 있는 순간은?",
            "망분리/보안 환경에서 사용 가능한가? 어떤 제약이 있는가?",
            "기존 행정 시스템(전자결재/업무포털)과 연동이 되는가?",
            "도입 승인을 받기 위해 필요한 조건(보안심의/조달등록/상급자 결재)은?",
        ],
        "objection-map": [
            "보안/망분리/조달/레퍼런스/감사/ROI/유지보수 중 가장 치명적인 반대는?",
            "상급자나 보안담당이 가장 먼저 막을 이유는?",
            "반박 메시지 중 공무원에게 먹히는 것과 역효과인 것은?",
            "제안서/PT에서 먼저 제거해야 할 표현과 추가해야 할 자료는?",
        ],
        "persona-panel": [
            "각 페르소나(사무관/주무관/보안담당/예산담당)의 첫 반응을 한 문장으로.",
            "서로 다른 찬반 이유와 조달 경로 이슈를 비교하라.",
            "결재 통과 가능성: 통과/조건부통과/불가로 분류하라.",
            "실제 사업설명회에서 던질 질문 5개를 제안하라.",
        ],
        "interview-script": [
            "현재 유사 업무를 어떻게 처리하는지 묻는 비유도 질문은?",
            "지금까지 도입 검토했다가 포기한 사례와 이유를 캐는 질문은?",
            "이 솔루션 컨셉을 설명하되 긍정 편향 없이 반응을 보는 질문은?",
            "도입 승인 조건과 결재 체계를 구체화하는 후속 질문은?",
        ],
        "proposal-stress-test": [
            "평가위원이 PT 중 던질 보안/조달/ROI/유지보수 관련 압박 질문 15개 이상은?",
            "가장 취약한 질문 3개와 현재 우리의 답변 준비 상태는?",
            "답변 불가 시 제안 전략을 어떻게 수정해야 하는가?",
            "PT 전 반드시 확보해야 할 자료/인증/레퍼런스는?",
        ],
        "procurement-review": [
            "이 사업의 최적 조달 경로(수의계약/경쟁입찰/혁신조달)는?",
            "나라장터/디지털서비스몰 등록 여부와 없을 경우 대안은?",
            "보안인증(CSAP/CC/ISMS-P) 상태와 심의 통과 가능성은?",
            "예산 집행 가능 일정과 연말 집행 리스크는?",
        ],
        "full-report": [
            "반응 분포(통과/조건부/불가)와 페르소나별 이유는?",
            "핵심 인사이트와 blind spot(우리가 놓친 공공 특수성)은?",
            "조달 경로/보안 요건/예산 가능성 종합 판단은?",
            "GO/PIVOT/KILL 판정과 다음 실제 검증(사업설명회/PoC/인터뷰)은?",
        ],
    }
    return "\n".join(f"{i}. {q}" for i, q in enumerate(blocks[mode], 1))


def build_report(personas: Sequence[Dict[str, Any]], product: str, mode: str, title: str) -> str:
    cards = "\n".join(persona_card(p, i) for i, p in enumerate(personas, 1))
    persona_rows = "".join("| P" + str(i) + " |  |  |  |  |  |\n" for i, _ in enumerate(personas, 1))
    return f"""# Korean Synthetic Public-AX Panel — {title}

- Date: {date.today().isoformat()}
- Mode: `{mode}`
- Personas: {len(personas)}
- Safety: Synthetic personas generate hypotheses. They are not proof of real market demand.

## Product / Message Under Test

{product.strip()}

## Persona Panel

{cards if cards else '_No personas provided._'}

## Analyst Instructions

Use the personas as grounded role cards for a Korean consumer panel. Stay concrete and skeptical. Avoid polite default positivity. For each persona, answer from their lived constraints, not from the product team's hopes.

### Questions for `{mode}`

{mode_questions(mode)}

## Response Capture Template

| Persona | First reaction | Use intent | Procurement/approval condition | Main objection | Quote |
|---|---|---|---|---|---|
{persona_rows}

## Synthesis Template

### Reaction Distribution
- Positive:
- Conditional:
- Negative:

### Strongest Signals
1.
2.
3.

### Objection Map
1.
2.
3.

### Message/Product Revisions
- Keep:
- Change:
- Remove:

### Decision
**GO / PIVOT / KILL:**

### Next Real-World Validation
- Interview/survey target:
- Prototype or message test:
- Evidence needed before decision:

---
Generated scaffold only. No paid LLM/API call was made by this script.
"""


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create a markdown synthetic consumer panel report scaffold.")
    parser.add_argument("--personas", required=True, help="persona JSON file")
    parser.add_argument("--product", required=True, help="product/message description text or @path/to/file")
    parser.add_argument("--mode", choices=MODES, default="full-report")
    parser.add_argument("--title", default="Panel Report")
    parser.add_argument("--output", help="write markdown to file instead of stdout")
    return parser.parse_args(argv)


def read_product(value: str) -> str:
    if value.startswith("@"):
        return Path(value[1:]).read_text(encoding="utf-8")
    return value


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    try:
        personas = load_personas(Path(args.personas))
        report = build_report(personas, read_product(args.product), args.mode, args.title)
        if args.output:
            Path(args.output).write_text(report, encoding="utf-8")
        else:
            print(report)
    except Exception as exc:  # noqa: BLE001
        print(f"build_panel_report.py: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
