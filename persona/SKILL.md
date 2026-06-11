---
name: korean-synthetic-public-ax
description: 한국 공무원·공공기관 AX 사업 대상의 합성 페르소나 패널 스킬. 제안서 메시지 테스트, 조달 반대논리 맵핑, 공공 AX 도입 적합성 점검, 심의 시뮬레이션에 활용.
---

# Korean Synthetic Public-AX Panel / 한국 공공 AX 합성 페르소나 패널

**목적:** 공무원·공공기관 AX 사업 담당자들의 반응을 사전 시뮬레이션해 제안서 약점, 보안 반대논리, 조달 병목, 성과지표 이슈를 발굴한다.

이 스킬은 `korean-synthetic-consumer`를 공공AX 도메인에 맞게 특화한 버전이다.

## Safety caveat / 주의사항

합성 페르소나는 **가설 생성 도구**다. 실제 공무원·기관 인터뷰, 사업 설명회, 제안서 PT를 대체하지 않는다. 최종 제안 전략 결정에 유일한 근거로 쓰지 말 것.

## 공공AX 도메인 특수 컨텍스트

### 의사결정 구조
- **결재 체계**: 주무관 → 사무관 → 과장 → 국장 → 기획조정실 (부처마다 다름)
- **계약 방식**: 나라장터 입찰 / 조달청 디지털서비스몰 / 혁신조달 / 수의계약 (5천만원 미만)
- **보안 심의**: 국정원 CC인증, CSAP 클라우드 보안인증, ISMS-P, 개인정보영향평가
- **예산 주기**: 전년도 8~9월 예산요구 → 11월 확정 → 당해연도 집행. 연말 잔여예산 긴급 집행 패턴.

### 공통 반대논리 (objection clusters)
1. **보안/망분리**: "우리 기관은 망분리라 SaaS 못 씁니다"
2. **조달 미등록**: "나라장터에 없으면 계약 자체가 안 됩니다"
3. **레퍼런스 부재**: "비슷한 공공기관 도입 사례 있나요? 없으면 리스크입니다"
4. **감사 리스크**: "효과 증빙 못 하면 예산 낭비로 감사 지적 받습니다"
5. **ROI 정량화 불가**: "AI 효과를 어떻게 수치로 보여줄 수 있나요?"
6. **유지보수 불명확**: "3년 후 유지보수 계약 구조가 불분명합니다"

## Modes / 모드

### `message-test`
제안서 서두, PT 1페이지, 공문 제목, 사업 소개 문구의 공무원 반응 테스트.
→ "처음 읽었을 때 어떤 오해가 생기나? 어떤 표현이 신뢰를 떨어뜨리나?"

### `objection-map`
공공조달 6대 반대논리(보안/조달/레퍼런스/감사/ROI/유지보수) 맵핑 및 대응 논리 설계.

### `product-fit`
공공기관 AX 도입 적합성 점검. 실제 업무 흐름에서 도입 가능한 지점, 망분리 환경 호환성, 사용 강제화 없이 자발적 사용이 가능한가.

### `proposal-stress-test`
제안서 PT 현장 압박 질문 시뮬레이션. 평가위원·담당자가 PT 중 던질 질문 15개 이상 생성.

### `procurement-review`
조달 심의 시뮬레이션. 나라장터 등록 여부, 계약 방식, 분리발주 이슈, 예산 타당성 검토.

### `persona-panel`
5명의 공무원 페르소나가 제품/사업을 처음 보는 1차 반응.

### `interview-script`
합성 패널 결과를 실제 공무원 인터뷰 질문으로 전환 (비유도식, 행동 중심).

### `full-report`
전체 리포트: 페르소나 표 + 반응 분포 + 조달 경로 분석 + 반대논리 맵 + 제안서 수정 권고 + 다음 실제 검증.

### `setup`
```bash
python -m pip install -r requirements.txt
python scripts/sample_personas.py --dataset examples/example-personas.json --n 3 --output markdown
```

## Workflow

1. **목표 명확화**: 어떤 사업/제안서/메시지인가? 대상 기관 유형(중앙부처/지자체/공기업/준정부기관)은?
2. **페르소나 샘플링**:
   ```bash
   python scripts/sample_personas.py --dataset examples/example-personas.json --n 5 --output json > personas.json
   ```
3. **리포트 스캐폴드 생성**:
   ```bash
   python scripts/build_panel_report.py --personas personas.json --product "..." --mode full-report --title "사업명 제안서 테스트"
   ```
4. **Claude에서 합성 분석 실행**: 스캐폴드 + 관련 템플릿으로 각 페르소나 반응 시뮬레이션.
5. **마무리**: 실제 공무원 인터뷰 또는 사업설명회에서 검증할 질문 5개로 종료.

## Anti-bias rules / 편향 방지 규칙

- 최소 1명의 보안담당자(security-blocker) 포함.
- 최소 1명의 예산담당자(budget-gatekeeper) 포함.
- "도입하면 좋을 것 같다" 식의 공손한 긍정 금지 — 공무원의 실제 리스크 회피 본능을 반영할 것.
- 조달 경로 없이 도입 가능하다고 가정하지 말 것.
- 반드시 다음 실제 검증 단계(사업설명회/인터뷰/PoC)로 종료할 것.
