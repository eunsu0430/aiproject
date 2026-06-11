# 🏛️ Korean Synthetic Public Servant Personas

**공공AX(AI Transformation)를 위한 한국 공무원 합성 페르소나 데이터셋 — 1,300명**  
**1,300 synthetic Korean public servant personas for AI adoption consulting**

> NVIDIA [Nemotron-Personas-Korea](https://huggingface.co/datasets/nvidia/Nemotron-Personas-Korea)에 영감받아, 공공AX 특화 버전으로 구축했습니다.  
> Inspired by NVIDIA Nemotron-Personas-Korea — rebuilt for public sector AI consulting.

---

## 왜 만들었나 / Why We Built This

공공 AI 도입 프로젝트에서 반복되는 현실이 있다.

> *"공무원이 왜 반대하는지 모르겠다."*

기존 LLM에 한국 공무원 페르소나를 요청하면 결과는 현실과 동떨어진다. 5급 사무관이 혼자 모든 결정을 내리거나, 반대 이유가 "개인정보 우려" 한 줄로 끝나거나, 모든 기관이 중앙부처 구조로 단일화된다.

**현실은 다르다.**

- 9급 담당자의 진짜 장벽: *"시스템 바뀌면 내가 뭘 해야 하는지 모르겠다"*
- 감사관의 공포: *AI 도입 후 감사원 지적이 자기한테 떨어질까봐*
- 예산 담당의 논리: *ROI를 증명 못 하면 내년 예산을 못 지킨다*
- 정보보안 부서의 등식: *클라우드 = 외부망 = 보안사고 = 징계*

이 데이터셋은 그 현실을 담는다.

---

In public sector AI projects, one pattern keeps repeating:

> *"I don't understand why civil servants resist."*

When you ask existing LLMs for Korean public servant personas, the output is disconnected from reality. A Grade 5 officer makes all decisions alone, opposition is reduced to "privacy concerns," and every agency mirrors a central ministry structure.

**Reality is different.**

This dataset captures the actual objection patterns, decision structures, and institutional anxieties that block AI adoption in Korean government.

---

## 데이터셋 구성 / Dataset Overview

### 페르소나: 100명 / 100 Personas

| 구분 | 내용 |
|---|---|
| **실무자 유형** | 신중한 문지기 · 실무 실행자 · 보안 차단자 · 예산 수호자 · 혁신 선도자 |
| **정책 인사이더 유형** | OB 전문위원 · 예산당국 · 국회 보좌관/입법조사관 |
| **정부 레벨** | 중앙부처 · 광역자치단체 · 기초자치단체 · 공공기관 |
| **직급** | 3급~9급 + 팀장/과장/국장 |
| **연령대** | 28세~58세 |
| **부서** | 정보화 · 감사 · 재무 · 기획 · 행정 · 복지 · 교육 · 안전 |

| Category | Details |
|---|---|
| **Operational Types** | Cautious Gatekeeper · Practical Executor · Security Blocker · Budget Guardian · Innovation Champion |
| **Policy Insider Types** | OB Expert (Retired Senior Official) · Budget Authority (MoF) · Legislative Advisor (Assembly) |
| **Gov Level** | Central Ministry · Metro Gov · Local Gov · Public Corporation |
| **Grade** | Grade 3–9 + Team Lead / Section Chief / Division Head |
| **Age Range** | 28–58 |
| **Region** | All 17 provinces · 252 districts (Nemotron demographic base) |
| **Departments** | IT · Audit · Finance · Planning · Admin · Welfare · Education · Safety |

---

### 실데이터 소스 / Real Data Sources

| 소스 | 건수 | 내용 |
|---|---|---|
| **Nemotron-Personas-Korea** | 1,000명 base | NVIDIA 인구통계 · 지역 · 직업 · 생활양식 현실성 |
| **NIA 공공AI 문서** | 154건 | 국가지능정보화백서, AI활용사례, 이슈분석, 전자정부이용실태 등 9개 게시판 |
| **KOSIS 인사혁신처** | 3,167행 | 부처별/직급별/직종별 실제 공무원 현원 (2022–2024) |
| **나라장터 입찰공고** | 88건 | 실제 공공 AI/IT 사업 예산·규모·발주기관 (2026년) |

| Source | Count | Description |
|---|---|---|
| **Nemotron-Personas-Korea** | 1,000 base | NVIDIA demographic · region · occupation · lifestyle realism |
| **NIA Public AI Docs** | 154 | AI case studies, policy reports, digital gov surveys (9 boards) |
| **KOSIS Civil Servant Stats** | 3,167 rows | Actual headcount by ministry/grade/type (2022–2024) |
| **G2B Bid Records** | 88 | Real public AI/IT procurement data (2026) |

각 페르소나는 실제 직급 인원 비율로 현실화됨:
- 5급 사무관 → 전체의 **2.19%** (16,758명)
- 7급 주무관 → 전체의 **5.73%** (43,756명)

Each persona is calibrated against real headcount ratios from KOSIS.

---

## 페르소나 스키마 / Persona Schema

```json
{
  "name": "김태준",
  "age": 44,
  "grade": "5급 사무관",
  "department": "정보화담당관실",
  "org": "행정안전부",
  "org_type": "중앙부처",
  "persona_type": "cautious-gatekeeper",
  "pain_points": [
    "감사원 지적 이력",
    "예산 삭감 압박",
    "전임자 실패 사례"
  ],
  "objections": [
    "검증된 레퍼런스가 없다",
    "보안 인증이 안 됐다",
    "내년 예산에 없다"
  ],
  "goals": ["임기 내 사고 없이", "차기 승진 준비"],
  "tech_savviness": 2,
  "reference_cases": [
    "(공공행정) 에이전틱 AI 기반 전국민 맞춤형 민원 상담 서비스"
  ],
  "kosis_stats": {
    "total_civil_servants": 763464,
    "as_of_year": "2024",
    "grade_distribution": [{"grade": "일반직", "count": 620891}],
    "persona_grade_note": "5급 사무관은 전체 공무원의 2.19% (16,758명)"
  }
}
```

---

## 활용 시나리오 / Use Cases

**🎯 공공 AI 제안서 검토**  
페르소나별 반대 논리를 미리 예측하여 제안서에 선제적 답변 내장

**🎭 공공 AX 컨설팅 시뮬레이션**  
실제 이해관계자 인터뷰 전 시나리오 리허설

**📚 공공기관 AI 도입 교육**  
"이런 담당자를 만났을 때 어떻게 설득하는가" 롤플레이

**🤖 합성 데이터 생성**  
공공 AI 시스템의 사용자 시뮬레이션, 편향 테스트

---

**🎯 Public AI Proposal Review** — Pre-simulate objections, embed answers in proposals  
**🎭 AX Consulting Simulation** — Rehearse stakeholder interviews before they happen  
**📚 AI Adoption Training** — Role-play persuasion scenarios with realistic blockers  
**🔍 Policy Design Analysis** — Simulate *why a project was designed this way*, not just *how to adopt it*  
**🤖 Synthetic Data Generation** — Simulate public system users, test for bias

---

## 파일 구조 / File Structure

```
├── data/
│   ├── nemotron_civil_base.json       # Nemotron 공무원 직업군 1,000명
│   ├── nia_ai_cases.json              # NIA 공공AI 문서 154건
│   ├── kosis_civil_servant.json       # KOSIS 인사혁신처 통계
│   ├── g2b_ai_bids.json               # 나라장터 AI/IT 입찰공고 88건
│   ├── bai_audit_results.json         # 감사원 IT 감사결과 19건
│   ├── kdi_reports.json               # KDI 정책보고서
│   ├── kipa_reports.json              # KIPA 행정연구원 보고서
│   ├── ministry_press_releases.json   # 부처 보도자료 30건+
│   ├── archetype_patterns.json        # 발언 패턴 5종 archetype 분류
│   └── persona_archetype_guide.md     # 컨설팅 활용 가이드
├── examples/
│   ├── example-personas-1300-full.json         # ⭐ 최종 1,300명 (전체)
│   ├── example-personas-1000-nemotron.json     # 실무자 1,000명
│   ├── example-personas-policy-300.json        # 정책 인사이더 300명
│   └── example-personas-100-nemotron-sample.json # 샘플 100명
├── scripts/
│   ├── build_nemotron_base.py     # Nemotron → 공무원 1,000명 추출
│   ├── enrich_from_nemotron.py    # 반대논리 + 실데이터 주입
│   ├── generate_policy_insiders.py # 정책 인사이더 300명 생성
│   ├── fetch_nia_data.py           # NIA 스크래퍼
│   ├── fetch_kosis_data.py         # KOSIS API 수집기
│   ├── fetch_g2b_data.py           # 나라장터 API 수집기
│   ├── fetch_bai_data.py           # 감사원 Playwright 스크래퍼
│   ├── fetch_kdi_reports.py        # KDI 보고서 스크래퍼
│   ├── fetch_kipa_reports.py       # KIPA 보고서 스크래퍼
│   └── extract_archetypes.py       # 발언 패턴 → archetype 분류기
└── SKILL.md                         # OpenClaw 스킬 정의
```

---

## 스킬 모드 / Skill Modes

| 모드 | 역할 |
|---|---|
| `caution` | 신중한 문지기 — 감사·법적 리스크 중심 |
| `execute` | 실무 실행자 — 현장 구현 가능성 중심 |
| `security` | 보안 차단자 — 정보보안 정책 중심 |
| `budget` | 예산 수호자 — ROI·예산 집행 중심 |
| `innovate` | 혁신 선도자 — 디지털 전환 드라이브 |
| `insider` | 정책 인사이더 — "왜 이 사업이 이 모양인가" 메타 분석 |

---

## 사용 방법 / How to Use

### Claude Code 사용자

**1. 리포 클론 후 페르소나 직접 주입**

```bash
git clone https://github.com/CuriousPaul/handong.git
cd handong
```

```bash
# 원하는 페르소나 샘플링 (예: 5명)
python3 scripts/sample_personas.py \
  --dataset examples/example-personas-100-enriched.json \
  --n 5 --output markdown
```

출력된 마크다운을 Claude Code 프롬프트 앞에 붙여서 사용:

```
[아래 공무원 페르소나 5명의 관점에서 내 제안서를 검토해줘]

{페르소나 마크다운 붙여넣기}

[제안서 내용]
...
```

**2. 반대논리 맵핑**

```bash
# 제안서 약점 분석 리포트 생성
python3 scripts/build_panel_report.py \
  --personas examples/example-personas-100-enriched.json \
  --product "AI 민원상담 챗봇" \
  --mode objection-map
```

**3. 특정 직급/기관 필터링**

```python
import json

with open('examples/example-personas-100-enriched.json') as f:
    personas = json.load(f)

# 중앙부처 5급 이상만 필터
target = [
    p for p in personas
    if p['org_type'] == '중앙부처'
    and p.get('grade', '').startswith(('3급', '4급', '5급'))
]
```

---

### OpenClaw 사용자

**1. 스킬 설치**

```bash
# 리포 클론
git clone https://github.com/CuriousPaul/handong.git ~/.openclaw/workspace/skills/handong

# OpenClaw 스킬 목록에서 확인
opencode skills list | grep handong
```

**2. 스킬 호출 (5가지 모드)**

| 모드 | 명령 | 용도 |
|---|---|---|
| `message-test` | `@handong message-test` | 제안서 문구 공무원 반응 테스트 |
| `objection-map` | `@handong objection-map` | 6대 반대논리 맵핑 |
| `pt-stress-test` | `@handong pt-stress-test` | PT 압박 질문 시뮬레이션 |
| `fit-check` | `@handong fit-check` | 공공AX 도입 적합성 점검 |
| `full-report` | `@handong full-report` | 종합 패널 리포트 |

**3. 사용 예시**

```
@handong objection-map

사업명: 세종시 AI 민원 자동분류 시스템
대상 기관: 기초자치단체
예산: 2억원
도입 방식: SaaS (클라우드)
```

→ 보안담당자, 예산담당자, 감사담당자 등 5개 페르소나가 각각 반대논리를 시뮬레이션

**4. 페르소나 데이터 직접 활용**

```
@handong 에서 5급 사무관 페르소나 3명을 뽑아서
아래 제안서 1페이지를 검토해줘:

[제안서 내용]
```

---

## 데이터 수집 재실행 / Re-run Data Collection

```bash
# NIA 공공AI 문서 (154건, 키 불필요)
python3 scripts/fetch_nia_data.py

# KOSIS 인사혁신처 통계 (API 키 필요: kosis.kr)
export KSKILL_KOSIS_API_KEY=your_key_here
python3 scripts/fetch_kosis_data.py --direct

# 나라장터 입찰공고 (API 키 필요: data.go.kr)
export G2B_API_KEY=your_encoded_key_here
python3 scripts/fetch_g2b_data.py

# 페르소나 생성 + enrichment
python3 scripts/generate_personas.py
python3 scripts/enrich_personas.py \
  --input examples/example-personas-100.json \
  --output examples/example-personas-100-enriched.json
```

---

## 라이선스 / License

- 모든 페르소나는 완전히 **합성(synthetic)**되었으며 실존 인물과 무관
- Nemotron-Personas-Korea: [CC BY 4.0](https://huggingface.co/datasets/nvidia/Nemotron-Personas-Korea) (NVIDIA)
- NIA, KOSIS, 나라장터, 감사원 공개 데이터 기반 (각 원본 라이선스 준수)
- All personas are **fully synthetic** and bear no relation to real individuals
- Based on publicly available NIA, KOSIS, and G2B data

---

## 만든 곳 / Made By

**Paul Jung**  
공공 AI 전환의 진짜 장벽은 기술이 아니라 **사람**이다.  
*The real barrier to public AI adoption isn't technology — it's people.*

🔨 *그 사람들을 데이터로 먼저 만나보세요 / Meet them in data before you meet them in person.*
