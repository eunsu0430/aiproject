#!/usr/bin/env python3
"""Generate 100 diverse Korean public servant personas for AX adoption analysis."""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

# ---------------------------------------------------------------------------
# Data pools
# ---------------------------------------------------------------------------

FAMILY_NAMES: List[str] = [
    "김", "이", "박", "최", "정", "강", "조", "윤", "장", "임",
    "한", "오", "서", "신", "권", "황", "안", "송", "류", "홍",
    "남궁", "현", "진", "민", "지", "나", "채", "방", "원",
]

MALE_GIVEN_NAMES: List[str] = [
    "태준", "창호", "민석", "준호", "성민", "동현", "정훈", "상철",
    "영진", "기영", "현우", "승현", "정남", "대근", "호석", "시우",
    "도윤", "민규", "준서", "현직", "상혁", "종훈", "영훈", "경수",
    "재원", "인호", "승민", "태양", "윤성", "지훈",
]

FEMALE_GIVEN_NAMES: List[str] = [
    "소연", "다은", "수진", "미영", "혜진", "은정", "지현", "선영",
    "유진", "승희", "하늘", "지원", "수빈", "예린", "채원", "서연",
    "민주", "소희", "윤진", "혜린", "지은", "보미", "수현", "세린",
    "아린", "나연", "지안", "하린", "다솜", "예지",
]

DEPARTMENTS: List[str] = [
    "정보화", "행정", "재무", "감사", "기획", "복지", "교육", "안전",
]

DEPARTMENT_TITLES: Dict[str, str] = {
    "정보화": "정보화",
    "행정": "행정관리",
    "재무": "재무회계",
    "감사": "감사법무",
    "기획": "기획예산",
    "복지": "복지정책",
    "교육": "교육정책",
    "안전": "안전관리",
}

PERSONA_TYPES: List[str] = [
    "cautious-gatekeeper",
    "practical-executor",
    "security-blocker",
    "budget-gatekeeper",
    "innovation-champion",
]

PERSONA_TYPE_LABELS: Dict[str, str] = {
    "cautious-gatekeeper": "신중한 관리자",
    "practical-executor": "실무 실행자",
    "security-blocker": "보안 검토자",
    "budget-gatekeeper": "예산 관리자",
    "innovation-champion": "혁신 추진자",
}

ORG_TYPES: List[str] = [
    "중앙부처",
    "광역자치단체",
    "기초자치단체",
    "공공기관",
]

# Regions mapped by org_type
REGIONS_BY_ORG_TYPE: Dict[str, List[str]] = {
    "중앙부처": ["세종시"],
    "광역자치단체": [
        "서울시", "부산광역시", "대구광역시", "인천광역시", "광주광역시",
        "대전광역시", "울산광역시", "경기도", "강원도", "충청북도",
        "충청남도", "전라북도", "전라남도", "경상북도", "경상남도",
        "제주특별자치도",
    ],
    "기초자치단체": [
        "수원시", "성남시", "고양시", "용인시", "창원시", "포항시",
        "청주시", "천안시", "전주시", "목포시", "순천시", "김해시",
        "양산시", "안산시", "평택시", "제주시", "화성시", "남양주시",
        "의정부시", "시흥시", "부천시", "광명시", "군포시", "오산시", "파주시",
    ],
    "공공기관": [
        "서울시", "대전광역시", "세종시", "부산광역시", "대구광역시",
        "광주광역시", "울산광역시", "경기도 수원시", "경상북도 포항시",
        "충청남도 천안시", "전라남도 여수시",
    ],
}

ORG_NAMES: Dict[str, List[str]] = {
    "중앙부처": [
        "행정안전부", "과학기술정보통신부", "기획재정부", "교육부", "국방부",
        "법무부", "외교부", "통일부", "문화체육관광부", "농림축산식품부",
        "산업통상자원부", "보건복지부", "환경부", "고용노동부", "국토교통부",
        "해양수산부", "여성가족부", "국가보훈부", "개인정보보호위원회", "국가청소년위원회",
        "금융위원회", "국민안전처", "공정거래위원회", "감사원",
    ],
    "광역자치단체": [
        "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시",
        "대전광역시", "울산광역시", "세종특별자치시", "경기도", "강원특별자치도",
        "충청북도", "충청남도", "전북특별자치도", "전라남도", "경상북도",
        "경상남도", "제주특별자치도",
    ],
    "기초자치단체": [
        "수원시", "성남시", "고양시", "용인시", "창원시", "청주시",
        "천안시", "전주시", "목포시", "김해시", "안산시", "평택시",
        "포항시", "제주시", "순천시", "양산시", "화성시", "남양주시",
        "의정부시", "시흥시", "부천시", "광명시", "군포시", "오산시", "파주시",
    ],
    "공공기관": [
        "한국전력공사", "한국도로공사", "국민건강보험공단", "국민연금공단",
        "한국수자원공사", "대한주택공사(LH)", "한국가스공사", "공무원연금공단",
        "한국관광공사", "중소기업진흥공단", "한국산업기술진흥원", "한국보건산업진흥원",
        "한국인터넷진흥원(KISA)", "한국정보화진흥원(NIA)", "농촌진흥청",
        "기상청", "특허청", "조달청", "관세청", "통계청",
    ],
}

# Grade distribution: (grade_num, count)
GRADE_DISTRIBUTION: List[tuple] = [
    (3, 3),
    (4, 9),
    (5, 15),
    (6, 13),
    (7, 17),
    (8, 11),
    (9, 7),
]

GRADE_TITLES: Dict[int, List[str]] = {
    3: ["이사관", "국장"],
    4: ["서기관", "과장"],
    5: ["사무관"],
    6: ["주사", "팀장"],
    7: ["주무관", "주사"],
    8: ["서기"],
    9: ["서기"],
}

# Tech savviness ranges by persona_type
TECH_SAVVINESS_RANGE: Dict[str, tuple] = {
    "cautious-gatekeeper": (2, 3),
    "practical-executor": (3, 4),
    "security-blocker": (3, 5),
    "budget-gatekeeper": (1, 3),
    "innovation-champion": (3, 5),
}

# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

PROCUREMENT_CONTEXTS: Dict[str, Dict[str, str]] = {
    "중앙부처": {
        "정보화": "조달청 디지털서비스 몰 또는 나라장터 수의계약 (5천만원 미만). 국정원 CC인증·CSAP 클라우드 보안 인증 유무를 먼저 확인.",
        "행정": "나라장터 일반경쟁 또는 지명경쟁 입찰. 5천만원 이상 시 조달청 수요기관 계약 필요.",
        "재무": "기획재정부 사전협의(10억 이상). 분리발주·묶음발주 검토. 조달청 공동계약 우선.",
        "감사": "감사원·국회 감사 대응용 시스템은 내부 개발 우선 검토. 외부 도입 시 보안심의 필수.",
        "기획": "사업계획 반영 → 기획재정부 예산 협의 → 조달청 입찰. 혁신조달 트랙 활용 가능.",
        "복지": "보건복지부 소관 사업은 관련 법령 확인. 주민등록·건강보험 데이터 연동 시 개인정보보호위원회 심의 필요.",
        "교육": "교육부 전국단위 도입 시 시·도교육청 동의 필요. 학교 단위는 자체 구매 가능.",
        "안전": "국민안전처·소방청 관련 시스템은 재난안전 표준프레임워크 준수. 긴급구조 시스템은 가용성 99.9% 요구.",
    },
    "광역자치단체": {
        "정보화": "시·도 정보화사업 기본계획 반영 후 조달. 클라우드 서비스는 CSAP 인증 필수. 3억 이상 시 지방의회 의결 필요.",
        "행정": "행정업무포털(G4C) 연동 호환성 확인. 나라장터 또는 시·도 자체 수의계약 규정 확인.",
        "재무": "지방재정계획 반영 후 집행. 대규모 사업은 기획재정부 지방이전사업 협의 필요.",
        "감사": "지방자치단체 감사규칙에 따라 사전 감사대상 여부 확인. 외부 감사 대응 자료 준비.",
        "기획": "시·도 종합계획 연계. 혁신도시·스마트시시 사업과 통합 추진 가능.",
        "복지": "주민센터·복지관 연동 서비스는 주민 convenience 우선. 접근성 기준 충족 필요.",
        "교육": "시·도교육청 예산 편성 필요. 교육정보원 검토 후 도입.",
        "안전": "시·도 재난안전계획 연계. CCTV·안전센서 데이터 연동 시 망분리 검토.",
    },
    "기초자치단체": {
        "정보화": "시·군·구 자체 정보화계획 내 사업으로 편성. 소규모 예산(5천만원 이하)은 수의계약 가능.",
        "행정": "상위 자치단체 결재 후 집행. 행정업무포털(G4C) 표준 준수.",
        "재무": "지방비 전액 부담 또는 국비 보조 확보. 사업비 1억 이상 시 지방의회 의결.",
        "감사": "자치단체장 감사 및 지방의회 감사 대응. 소규모 기관은 감사 인력 부족으로 외부 위탁 고려.",
        "기획": "시·군·구 종합발전계획 5개년 계획 연계. 지역 맞춤형 사업 우선.",
        "복지": "주민복지 서비스 개선이 핵심. 복지부 예산 확보 후 IT 서비스 도입.",
        "교육": "교육지원청 협의 필요. 학교급식·버스 등 현장 밀착 서비스 우선.",
        "안전": "소방서·경찰서 연계 재난대응 체계 구축. 재난문자 발령 시스템 연동 고려.",
    },
    "공공기관": {
        "정보화": "기관 정보화추진계획에 따라 자체 발주. 전자상거래 등록 후 수의계약 또는 제한경쟁.",
        "행정": "인사혁신처 공무원역량개발 표준 프로그램 연계. 전자결재 시스템과 연동.",
        "재무": "경영계획 반영 후 이사회 보고(5억 이상). 준정부기관은 기획재정부 사전협의.",
        "감사": "외부감사 대응 체계 필수. 감사원 감사 대상 기관은 사전 검토 필요.",
        "기획": "중장기 경영전략 연계. 혁신사업 추진 시 이사회 의결 필요.",
        "복지": "가입자·수급자 대상 서비스 개선. 건강보험·연금 등 데이터 활용 시 민감정보 보호 필수.",
        "교육": "직원 교육 프로그램으로 도입. 사내 학습관리시스템(LMS) 연동.",
        "안전": "산업안전보건법 준수. 사내 보안관제 연동 및 ISMS-P 인증 유지.",
    },
}

BUDGET_CYCLES: Dict[str, str] = {
    "중앙부처": "2월 예산 계획 → 6월 확정 → 9~11월 집중 집행. 연말 잔여예산 긴급 집행 패턴 존재.",
    "광역자치단체": "전년도 8월 예산요구 → 11월 확정 → 당해연도 집행. 추경 예산으로 긴급 추진 가능.",
    "기초자치단체": "전년도 9월 예산요구 → 12월 확정 → 상반기 집행 우선. 하반기 잔여예산 활용.",
    "공공기관": "연초 경영계획 반영 → 분기별 집행 점검. 상반기 착수, 하반기 성과 가시화 필요.",
}

APPROVAL_CHAINS: Dict[str, str] = {
    "중앙부처": "주무관 → 사무관 → 과장 → 국장 → 기획조정실 협의",
    "광역자치단체": "담당주무관 → 팀장 → 과장 → 실장 → 부시장/부지사 → 시장/도지사",
    "기초자치단체": "주무관(본인) 초안 → 팀장 → 과장 → 국장 결재",
    "공공기관": "팀장 → 부장 → 본부장 → 사장/원장 (이사회 보고는 5억 이상)",
}

# ---------------------------------------------------------------------------
# Pain point templates per persona_type × department
# ---------------------------------------------------------------------------

PAIN_POINT_TEMPLATES: Dict[str, Dict[str, List[str]]] = {
    "cautious-gatekeeper": {
        "정보화": [
            "정보보안 적합성 심의 통과",
            "나라장터 조달 등록 여부 확인",
            "감사 대응 근거 자료 확보",
            "부서장 보고용 ROI 수치 제시",
        ],
        "행정": [
            "기존 업무 프로세스 변경에 따른 부서 반대",
            "결재 시스템 연동 기술 검토",
            "시범 운영 기간 설정",
            "유관부서 협의 진행",
        ],
        "재무": [
            "사업비 타당성 근거 자료",
            "유사기관 도입 성과 데이터",
            "연간 유지보수 비용 예측",
            "감사 지적 방지를 위한 문서화",
        ],
        "감사": [
            "이전 유사 사업 감사 지적 사례 검토",
            "법적 근거 마련",
            "내부 통제 체계 정비",
            "감사 대응 매뉴얼 작성",
        ],
        "기획": [
            "상위 계획과의 정합성 확보",
            "경쟁 사업 간 우선순위 조정",
            "성과 지표 설계",
            "타 부서 업무 중복 최소화",
        ],
        "복지": [
            "취약계층 개인정보 보호 조치",
            "기존 복지 시스템과의 연동",
            "주민 편익 증대 입증",
            "법적 근거 마련",
        ],
        "교육": [
            "교육청 검토 승인",
            "기존 교육 플랫폼과의 호환성",
            "교사·학생 개인정보 보호",
            "학부위원회 동의 절차",
        ],
        "안전": [
            "재난대응 체계와의 연동 요건",
            "실시간 데이터 처리 신뢰성 확보",
            "안전관련 법령 준수 확인",
            "시스템 장애 시 우회조치 마련",
        ],
    },
    "practical-executor": {
        "정보화": [
            "내부 결재용 사업계획서 작성",
            "벤더 비교 자료 준비",
            "유지보수 계약 명확화",
            "온보딩 교육 부담",
        ],
        "행정": [
            "기존 전자결재 시스템과의 호환성",
            "상위 결재선 설득 자료 준비",
            "부서 내 교육 일정 조율",
            "파일럿 대상 부서 선정",
        ],
        "재무": [
            "예산 신청 서류 작성",
            "벤더 견적 비교표 작성",
            "계약 조건 검토",
            "지출 증빙 자료 준비",
        ],
        "감사": [
            "감사 대응 자료 정리",
            "내부 규정 준수 체크리스트",
            "이전 지적 사례 파악",
            "개선 조치 이력 관리",
        ],
        "기획": [
            "사업계획서 초안 작성",
            "유관부서 의견 수렴",
            "타당성 조사보고서 작성",
            "프레젠테이션 자료 준비",
        ],
        "복지": [
            "수요자 니즈 조사",
            "타 지자체 우수 사례 수집",
            "시범 운영 계획 수립",
            "이해관계자 협의",
        ],
        "교육": [
            "교육 프로그램 기획",
            "참여 대상 선정",
            "운영 매뉴얼 작성",
            "만족도 조사 설계",
        ],
        "안전": [
            "안전 점검 체크리스트 작성",
            "현장 교육 계획 수립",
            "비상연락망 업데이트",
            "장비 도입 승인 절차",
        ],
    },
    "security-blocker": {
        "정보화": [
            "국정원 보안관제 연동 요건",
            "ISMS-P 인증 유지",
            "망분리 환경에서의 SaaS 사용 불가 이슈",
            "외부 API 연동 승인 절차",
        ],
        "행정": [
            "업무용 PC 환경 통제",
            "모바일 기기 접근 정책",
            "데이터 반출 통제 체계",
            "외부 서비스 접속 로그 관리",
        ],
        "재무": [
            "전자결재 보안 인증",
            "재무 데이터 암호화 요건",
            "클라우드 저장 금지 정책",
            "접근권한 관리 체계",
        ],
        "감사": [
            "보안 감사 대응",
            "개인정보 침해 사례 분석",
            "보안사고 발생 시 책임 소재",
            "보안 교육 이수 현황 관리",
        ],
        "기획": [
            "정보자원관리기준 준수",
            "클라우드 서비스 보안 평가",
            "기술적 보안 통제 조치",
            "보안 사고 시나리오 대응",
        ],
        "복지": [
            "주민민감정보 보호 조치",
            "복지 수급자 데이터 접근 통제",
            "개인정보영향평가 수행",
            "데이터 복구 체계 검증",
        ],
        "교육": [
            "학생 개인정보 보호 강화",
            "교육 콘텐츠 저작권 검토",
            "원격 접속 보안 정책",
            "데이터 국내 저장 의무 준수",
        ],
        "안전": [
            "CCTV 영상 보관 정책 준수",
            "재난 통신망 보안 확보",
            "IoT 센서 데이터 보안",
            "비상 시 보안 우회 절차",
        ],
    },
    "budget-gatekeeper": {
        "정보화": [
            "사업비 타당성 근거 자료",
            "유사기관 도입 성과 데이터",
            "연간 유지보수 비용 예측",
            "사업 실패 시 담당자 책임 소재",
        ],
        "행정": [
            "기존 시스템과의 통합 비용",
            "도입 후 업무 단축 시간 정량화",
            "교육비 포함 총사업비 산정",
            "3년 후 교체 비용 예측",
        ],
        "재무": [
            "ROI 계산 근거 마련",
            "총소유비용(TCO) 분석",
            "타당성조사용 비용편익 분석",
            "잔여예산 활용 가능성 검토",
        ],
        "감사": [
            "감사 지적 방지를 위한 비용 증빙",
            "이전 유사 사업 예산 낭비 사례",
            "효과 증빙 체계 구축 비용",
            "외부 감사 대응 예산 반영",
        ],
        "기획": [
            "장기 재정 수지 영향 분석",
            "사업 규모별 비용 시나리오",
            "민간 자금 유치 가능성",
            "중앙정부 보조금 확보 방안",
        ],
        "복지": [
            "사업 수혜자 증대 효과 산정",
            "기존 수동 업무 대비 효율 증가율",
            "예산 배분 우선순위 근거",
            "타 사업과의 예산 중복 여부",
        ],
        "교육": [
            "교육 효과 측정 방법론",
            "교사 업무 경감 시간 정량화",
            "플랫폼 운영비 장기 예측",
            "기존 예산 전환 가능성",
        ],
        "안전": [
            "안전 사감소 효과의 경제적 가치",
            "시스템 고장 시 대체 비용",
            "장기 유지보수 계약 비용",
            "기존 시스템 대비 추가 비용",
        ],
    },
    "innovation-champion": {
        "정보화": [
            "AX 도입 KPI 설계",
            "국회 질의 대응용 성과보고서",
            "유사기관 벤치마킹 사례 확보",
            "내부 직원 저항 관리",
        ],
        "행정": [
            "업무 프로세스 혁신 시나리오",
            "시민 만족도 개선 지표",
            "타 부서 동참 유도 방안",
            "성과 보고용 대시보드 구축",
        ],
        "재무": [
            "혁신 사업 예산 확보 방안",
            "민간 투자 유치 전략",
            "스케일업 시 비용 절감 효과",
            "혁신 성과 국제 비교 자료",
        ],
        "감사": [
            "혁신 사업 감사 면제 규정 확인",
            "시범 사업의 한계 명확화",
            "실패 시 책임 소재 사전 정리",
            "혁신 성과 공유 체계 구축",
        ],
        "기획": [
            "혁신 로드맵 수립",
            "스마트시시·디지털플랫폼정부 연계",
            "산학협력 모델 구축",
            "국제 우수 사례 도입",
        ],
        "복지": [
            "디지털 복지 서비스 모델 설계",
            "서비스 접근성 개선 방안",
            "데이터 기반 맞춤형 서비스",
            "시민 참여형 플랫폼 구축",
        ],
        "교육": [
            "AI 기반 맞춤형 교육 모델",
            "에듀테크 벤치마킹",
            "교원 디지털 역량 강화",
            "미래 교육 환경 시나리오",
        ],
        "안전": [
            "스마트 안전 관제 시스템",
            "AI 예측 기반 재난 대응",
            "IoT 센서 통합 플랫폼",
            "시민 안전 참여 플랫폼",
        ],
    },
}

# ---------------------------------------------------------------------------
# Summary templates
# ---------------------------------------------------------------------------

SUMMARY_TEMPLATES: Dict[str, List[str]] = {
    "cautious-gatekeeper": [
        "디지털플랫폼정부 지침에 따라 AX 사업을 추진해야 하지만, 감사원 감사와 정보보안 심의가 가장 큰 걱정이다. 검증된 업체·사례만 신뢰하며, 실패 시 책임이 본인에게 온다는 것을 잘 알고 있다.",
        "AX 도입 자체에는 반대가 아니지만, 섣불리 도입했다가 감사 지적을 받는 것이 두렵다. 동급 기관이 성공적으로 도입한 사례가 있어야 검토를 시작한다.",
        "부처 내에서 IT 사업 경험이 많아 리스크를 정확히 파악한다. 기술의 장점보다 실패 시 부담이 더 크다고 생각하며, 단계적 도입을 선호한다.",
        "보안과 법적 규제를 최우선으로 생각한다. 기술적으로 가능해도 법령상 허용되지 않으면 도입할 수 없다는 입장이다.",
        "신규 시스템 도입 시 과거 유사 사업의 성공·실패 사례를 철저히 분석한다. 감사 대응용 문서화가 잘 되어 있는 솔루션을 선호한다.",
    ],
    "practical-executor": [
        "AI·디지털 도구에 관심이 많지만 실제 구매 결정권이 없다. 제안서 작성과 내부 보고자료 준비가 본인 몫이며, 화려한 기능보다 실제로 작동하는지가 중요하다.",
        "상위 결재자를 설득하기 위해 구체적인 도입 사례와 비용편익 자료가 필요하다. 현장에서 바로 쓸 수 있는 실용적 기능을 원한다.",
        "여러 벤더의 제안을 비교하는 업무를 맡고 있다. 기술적 용어보다 직원들이 실제로 쉽게 쓸 수 있는지를 먼저 확인한다.",
        "새로운 시스템 도입 시 기존 업무와의 충돌을 가장 우려한다. 업무 중단 없이 부드럽게 전환되는 방법을 찾고 있다.",
        "실무 담당자로서 현장의 목소리를 상위에 전달해야 한다. 하지만 정작 본인의 의견이 반영되는 경우는 드물어 무력감도 느낀다.",
    ],
    "security-blocker": [
        "클라우드·AI 도입 시 데이터 국내 저장 여부, 개인정보처리방침, 망분리 환경 호환성을 반드시 검토한다. 보안 사고 한 번이면 기관 전체가 흔들리기 때문에 안 쓰는 것이 기본 포지션이다.",
        "ISMS-P 인증 유지가 최우선이다. 새로운 솔루션 도입 시 보안 적합성 심의를 통과하지 못하면 아무리 좋은 기능도 무용지물이라고 생각한다.",
        "국정원 보안관제 연동이 필수인데, 대부분의 SaaS 솔루션이 이를 지원하지 않는다. 온프레미스 또는 정부 전용 클라우드에서만 구동되는 솔루션을 찾고 있다.",
        "외부 API 연동 시마다 승인 절차가 복잡하다. 보안 검토 기간이 길어지면 사업 일정에 차질이 생기지만, 안전을 양보할 수는 없다.",
        "최근 발생한 공공기관 보안 사고를 교훈 삼아 더 엄격한 기준을 적용하고 있다. 기능이 부족하더라도 보안이 확실한 솔루션을 선택한다.",
    ],
    "budget-gatekeeper": [
        "AX 사업이 효과가 있는지 모르겠다. 민간 대비 공공은 사용자가 강제 배치되기 때문에 사용률·효율이 다르다고 생각한다. 비슷한 기관이 이미 써서 성공했다는 레퍼런스가 유일한 설득 수단이다.",
        "예산이 한정되어 있기 때문에 매 사업의 효과를 수치로 증명해야 한다. '좋아 보인다'는 것으로 예산을 승인할 수 없다.",
        "이전에 도입한 시스템이 제대로 쓰이지 않아 예산 낭비로 감사 지적받은 경험이 있다. 그래서 새로운 도입에 매우 신중하다.",
        "도입비용뿐만 아니라 3~5년 뒤의 유지보수 비용까지 모두 예측해야 한다. 총비용을 정확히 모르면 사업을 승인할 수 없다.",
        "타 기관과의 비교 데이터가 가장 중요한 판단 기준이다. 우리보다 규모가 비슷한 기관이 성공한 사례가 없다면 도입을 반대한다.",
    ],
    "innovation-champion": [
        "기관장 지시로 AX 혁신 사업을 추진해야 한다. 성과지표(KPI)를 만들어야 하고, 국회·감사원에 제출할 실적 자료도 필요하다. 빠르게 가시적 성과를 낼 수 있는 솔루션을 원하지만 예산 낭비 비판도 두렵다.",
        "디지털플랫폼정부 비전에 부합하는 혁신 사업을 찾고 있다. 하지만 내부 직원들의 저항이 가장 큰 장애물이다.",
        "혁신 사업 성과를 언론·국회에 보고해야 하는 압박이 있다. 실질적 성과보다 보고용 숫자가 먼저라는 비판을 피하고 싶다.",
        "민간 기업의 우수 사례를 공공에 도입하고 싶지만, 공공 특유의 제약(망분리, 개인정보, 조달 규정) 때문에 그대로 적용할 수 없어 답답하다.",
        "빠른 프로토타입과 시범 운영을 선호한다. 완벽한 솔루션보다 빠르게 개선해나갈 수 있는 유연한 플랫폼을 찾고 있다.",
    ],
}

# ---------------------------------------------------------------------------
# Objection templates per persona_type
# ---------------------------------------------------------------------------

OBJECTION_TEMPLATES: Dict[str, List[List[str]]] = {
    "cautious-gatekeeper": [
        [
            "감사원 감사 시 효과를 수치로 증명할 수 있나요?",
            "비슷한 규모의 공공기관에서 이미 도입한 사례가 있나요?",
            "보안 적합성 심의는 통과했나요?",
        ],
        [
            "도입 실패 시 책임 소재는 어떻게 되나요?",
            "유지보수 계약은 몇 년까지 보장되나요?",
            "이전에 유사한 프로젝트의 성과는 어땠나요?",
        ],
        [
            "CSAP 인증을 받았나요?",
            "개인정보보호위원회 심의는 거쳤나요?",
            "국정원 CC인증은 있나요?",
        ],
        [
            "나라장터에 등록되어 있나요?",
            "수의계약 사유가 충분한가요?",
            "사업계획서에 어떤 근거를 써야 하나요?",
        ],
    ],
    "practical-executor": [
        [
            "현업 직원이 실제로 쉽게 쓸 수 있나요?",
            "기존 전자결제 시스템과 연동되나요?",
            "교육은 몇 시간이면 충분한가요?",
        ],
        [
            "도입 기간은 얼마나 걸리나요?",
            "기존 데이터 마이그레이션은 어떻게 하나요?",
            "문제 발생 시 어디에 문의하면 되나요?",
        ],
        [
            "상위 결재를 받으려면 어떤 자료가 필요한가요?",
            "벤더 비교 자료 양식이 있나요?",
            "시범 운영 기간은 얼마나 필요한가요?",
        ],
        [
            "모바일에서도 사용 가능한가요?",
            "오프라인에서도 동작하나요?",
            "한국어 지원은 완벽한가요?",
        ],
    ],
    "security-blocker": [
        [
            "데이터는 국내 서버에 저장되나요?",
            "망분리 환경에서도 사용 가능한가요?",
            "ISMS-P 인증과 호환되나요?",
        ],
        [
            "국정원 보안관제와 연동 가능한가요?",
            "외부 API 호출이 필요한가요?",
            "데이터 암호화는 어떤 방식을 쓰나요?",
        ],
        [
            "개인정보처리방침은 어떻게 되나요?",
            "접근권한 관리는 어떻게 하나요?",
            "보안사고 발생 시 대응 절차는 무엇인가요?",
        ],
        [
            "소스코드 검증은 가능한가요?",
            "온프레미스 설치가 가능한가요?",
            "취약점 점검 결과를 제공할 수 있나요?",
        ],
    ],
    "budget-gatekeeper": [
        [
            "총비용은 얼마인가요? 도입비용만 말고 5년 TCO도요.",
            "ROI는 어떻게 계산하나요?",
            "같은 규모 기관의 성과 데이터를 보여주세요.",
        ],
        [
            "예산이 없으면 다음 회계연도까지 기다려야 하나요?",
            "잔여예산으로 긴급 집행이 가능한가요?",
            "보조금이나 재원 조달 방법이 있나요?",
        ],
        [
            "3년 뒤 유지보수 비용은 얼마로 예상되나요?",
            "시스템 교체 시 기존 투자금은 회수 불가능한가요?",
            "파일럿만으로 효과를 증명할 수 있나요?",
        ],
        [
            "도입 예산을 어디에서 확보할 수 있나요?",
            "민간 자금 유치 가능한가요?",
            "경쟁입찰 시 가격 경쟁력이 있나요?",
        ],
    ],
    "innovation-champion": [
        [
            "빠르게 프로토타입을 만들 수 있나요?",
            "3개월 내에 가시적 성과를 낼 수 있나요?",
            "다른 공공기관 벤치마킹 사례가 있나요?",
        ],
        [
            "국회 보고용 성과 지표를 어떻게 만들까요?",
            "언론 보도용 성과 사례를 만들어 줄 수 있나요?",
            "스케일업 계획은 어떻게 세우나요?",
        ],
        [
            "AI 기술 트렌드를 따라갈 수 있는 유연한 구조인가요?",
            "API 기반으로 다른 시스템과 연동 가능한가요?",
            "오픈소스 기반이라 커스터마이징이 가능한가요?",
        ],
        [
            "내부 직원 저항은 어떻게 관리하나요?",
            "변화관리 프로그램이 포함되어 있나요?",
            "성공 사례를 시각화해서 보여줄 수 있나요?",
        ],
    ],
}

# ---------------------------------------------------------------------------
# Goal templates per persona_type × department
# ---------------------------------------------------------------------------

GOAL_TEMPLATES: Dict[str, Dict[str, List[str]]] = {
    "cautious-gatekeeper": {
        "정보화": [
            "감사 지적 없이 안전하게 시스템 도입 완료",
            "보안 적합성 심의 일회 통과",
            "상위 결재선의 신뢰 확보",
        ],
        "행정": [
            "업무 프로세스 표준화",
            "부서 간 협업 효율 향상",
            "내부 결재 시간 단축",
        ],
        "재무": [
            "예산 낭비 지적 방지",
            "명확한 ROI 보고",
            "사업비 정산 완료",
        ],
        "감사": [
            "감사 지적 건수 감소",
            "내부 통제 체계 강화",
            "이전 지적 사항 개선 조치 완료",
        ],
        "기획": [
            "사업 타당성 입증",
            "상위 계획과의 정합성 확보",
            "타 부서 이해관계 조율",
        ],
        "복지": [
            "취약계층 서비스 개선",
            "개인정보 보호 준수",
            "주민 만족도 향상",
        ],
        "교육": [
            "교육 품질 향상",
            "학생 데이터 보호",
            "교원 업무 경감",
        ],
        "안전": [
            "재난 대응 체계 강화",
            "시스템 가용성 확보",
            "안전 관련 법령 준수",
        ],
    },
    "practical-executor": {
        "정보화": [
            "업무 자동화로 반복 작업 감소",
            "실무에 바로 쓸 수 있는 도구 확보",
            "벤더 선정 기준 명확화",
        ],
        "행정": [
            "서류 작성 시간 단축",
            "상위 결재 선 확보를 위한 자료 준비",
            "부서 내 도입 반응 파악",
        ],
        "재무": [
            "정확한 예산 집행 관리",
            "벤더 비교표 작성 완료",
            "지출 증빙 자료 정리",
        ],
        "감사": [
            "감사 대응 자료 체계적 정리",
            "이전 지적 사항 파악",
            "개선 조치 이력 추적",
        ],
        "기획": [
            "사업계획서 초안 완성",
            "유관부체 의견 수렴 완료",
            "프레젠테이션 준비",
        ],
        "복지": [
            "수요자 니즈 파악",
            "시범 운영 계획 수립",
            "타 지자체 사례 조사",
        ],
        "교육": [
            "교육 프로그램 기획 완료",
            "참여 대상 확정",
            "운영 매뉴얼 작성",
        ],
        "안전": [
            "안전 점검 체크리스트 작성",
            "현장 교육 실시",
            "비상연락망 업데이트",
        ],
    },
    "security-blocker": {
        "정보화": [
            "ISMS-P 인증 무사 통과",
            "보안사고 제로 달성",
            "국정원 보안관제 연동 완료",
        ],
        "행정": [
            "데이터 반출 통제 강화",
            "접근권한 체계 정비",
            "보안 교육 이율률 100% 달성",
        ],
        "재무": [
            "재무 데이터 암호화 완료",
            "클라우드 서비스 보안 평가 수행",
            "접근권한 관리 체계 강화",
        ],
        "감사": [
            "보안 감사 무지적 달성",
            "개인정보 침해 사건 제로",
            "보안사고 대응 매뉴얼 정비",
        ],
        "기획": [
            "정보자원관리기준 준수 확인",
            "보안 사고 시나리오 대응 체계 구축",
            "보안 평가 체크리스트 완성",
        ],
        "복지": [
            "민감정보 보호 조치 완료",
            "개인정보영향평가 통과",
            "데이터 복구 테스트 완료",
        ],
        "교육": [
            "학생 데이터 보호 강화",
            "원격 접속 보안 정책 수립",
            "데이터 국내 저장 확인",
        ],
        "안전": [
            "CCTV 보관 정책 준수",
            "IoT 센서 데이터 보안 확보",
            "비상 시 보안 절차 정립",
        ],
    },
    "budget-gatekeeper": {
        "정보화": [
            "사업 타당성 근거 확보",
            "ROI 정량화 완료",
            "예산 집행 효율화",
        ],
        "행정": [
            "총비용 절감",
            "업무 효율 정량화",
            "예산 재배치 가능성 검토",
        ],
        "재무": [
            "TCO 분석 완료",
            "비용편익 분석 수행",
            "장기 재정 수지 개선",
        ],
        "감사": [
            "예산 낭비 지적 방지",
            "비용 증빙 체계 확립",
            "외부 감사 대응 예산 최소화",
        ],
        "기획": [
            "장기 재정 수지 분석 완료",
            "사업 규모별 비용 시나리오 수립",
            "중앙정부 보조금 확보",
        ],
        "복지": [
            "수혜자 증대 효과 산정",
            "예산 집행 효율 향상",
            "타 사업과 중복 제거",
        ],
        "교육": [
            "교육 효과 측정 체계 구축",
            "운영비 장기 예측",
            "기존 예산 전환 검토",
        ],
        "안전": [
            "안전 사감소 효과 경제가치 산정",
            "장기 유지보수 비용 예측",
            "기존 시스템 대비 비용 비교",
        ],
    },
    "innovation-champion": {
        "정보화": [
            "6개월 내 가시적 성과 창출",
            "KPI 대시보드 구축",
            "타 기관 벤치마킹 모델 확립",
        ],
        "행정": [
            "업무 프로세스 혁신",
            "시민 만족도 10% 향상",
            "디지털 전환 선도 기관 선정",
        ],
        "재무": [
            "스케일업 투자 유치",
            "장기 비용 절감 모델 수립",
            "혁신 사업 예산 독립 편성",
        ],
        "감사": [
            "혁신 사업 감사 면제 확보",
            "성과 공유 체계 구축",
            "실패 허용 문화 정착",
        ],
        "기획": [
            "혁신 로드맵 3개년 수립",
            "스마트시시 연계 모델 구축",
            "국제 벤치마킹 완료",
        ],
        "복지": [
            "디지털 복지 서비스 모델 완성",
            "시민 참여형 플랫폼 출시",
            "데이터 기반 맞춤 서비스 실현",
        ],
        "교육": [
            "AI 맞춤형 교육 시범 운영",
            "에듀테크 우수 사례 도입",
            "교원 디지털 역량 평가 체계 구축",
        ],
        "안전": [
            "스마트 안전 관제 시범 운영",
            "AI 예측 기반 재난 대응 체계 구축",
            "시민 안전 앱 출시",
        ],
    },
}

# ---------------------------------------------------------------------------
# Life stage templates
# ---------------------------------------------------------------------------

LIFE_STAGE_TEMPLATES: Dict[str, Dict[str, str]] = {
    "3": {
        "정보화": "{year}년차 고위공무원, 부처 디지털 전환 정책 총괄",
        "행정": "{year}년차 고위공무원, 전 부서 업무 조정 권한 보유",
        "재무": "{year}년차 고위공무원, 예산 편성·조정 최종 결정권",
        "감사": "{year}년차 고위공무원, 기관 전체 감사 계획 수립",
        "기획": "{year}년차 고위공무원, 중장기 발전 전략 기획",
        "복지": "{year}년차 고위공무원, 복지 정책 방향 결정",
        "교육": "{year}년차 고위공무원, 교육 정책 기획·조정",
        "안전": "{year}년차 고위공무원, 국가 안전 정책 총괄",
    },
    "4": {
        "정보화": "{year}년차 공무원, 정보화 부서 과장으로 AX 사업 총괄",
        "행정": "{year}년차 공무원, 행정과장으로 부서 업무 관리",
        "재무": "{year}년차 공무원, 예산과장으로 사업비 검토 최종 결정",
        "감사": "{year}년차 공무원, 감사과장으로 내부 감사 계획 수립",
        "기획": "{year}년차 공무원, 기획과장으로 부서 간 사업 조정",
        "복지": "{year}년차 공무원, 복지과장으로 정책 집행 관리",
        "교육": "{year}년차 공무원, 교육과장으로 학교·기관 지원",
        "안전": "{year}년차 공무원, 안전과장으로 재난 대응 체계 관리",
    },
    "5": {
        "정보화": "{year}년차 공무원, 부서 내 AX 사업 총괄",
        "행정": "{year}년차 공무원, 부서 핵심 실무자이자 결재 핵심",
        "재무": "{year}년차 공무원, 예산 실무 총괄 담당",
        "감사": "{year}년차 공무원, 감사 실무 총괄 및 대응",
        "기획": "{year}년차 공무원, 사업 기획 실무 총괄",
        "복지": "{year}년차 공무원, 복지 정책 실무 총괄",
        "교육": "{year}년차 공무원, 교육 정책 실무 총괄",
        "안전": "{year}년차 공무원, 안전 관리 실무 총괄",
    },
    "6": {
        "정보화": "{year}년차 공무원, 정보화 팀장으로 실무 리드",
        "행정": "{year}년차 공무원, 행정 팀장으로 부서 업무 조율",
        "재무": "{year}년차 공무원, 재무 팀장으로 예산 실행 관리",
        "감사": "{year}년차 공무원, 감사 팀장으로 현장 점검 지휘",
        "기획": "{year}년차 공무원, 기획 팀장으로 사업 관리",
        "복지": "{year}년차 공무원, 복지 팀장으로 현장 지원",
        "교육": "{year}년차 공무원, 교육 팀장으로 프로그램 관리",
        "안전": "{year}년차 공무원, 안전 팀장으로 현장 관리",
    },
    "7": {
        "정보화": "{year}년차 공무원, 정보화 실무 담당 주무관",
        "행정": "{year}년차 공무원, 행정 실무 담당 주무관",
        "재무": "{year}년차 공무원, 재무 실무 담당 주무관",
        "감사": "{year}년차 공무원, 감사 실무 담당 주무관",
        "기획": "{year}년차 공무원, 기획 실무 담당 주무관",
        "복지": "{year}년차 공무원, 복지 실무 담당 주무관",
        "교육": "{year}년차 공무원, 교육 실무 담당 주무관",
        "안전": "{year}년차 공무원, 안전 실무 담당 주무관",
    },
    "8": {
        "정보화": "{year}년차 초임 공무원, 정보화 부서 배치",
        "행정": "{year}년차 초임 공무원, 행정 부서 배치",
        "재무": "{year}년차 초임 공무원, 재무 부서 배치",
        "감사": "{year}년차 초임 공무원, 감사 지원 업무",
        "기획": "{year}년차 초임 공무원, 기획 보조 업무",
        "복지": "{year}년차 초임 공무원, 복지 창구 업무",
        "교육": "{year}년차 초임 공무원, 교육 행정 지원",
        "안전": "{year}년차 초임 공무원, 안전 행정 지원",
    },
    "9": {
        "정보화": "{year}년차 신규 공무원, 정보화 부서 배치",
        "행정": "{year}년차 신규 공무원, 행정 부서 배치",
        "재무": "{year}년차 신규 공무원, 재무 부서 배치",
        "감사": "{year}년차 신규 공무원, 감사 지원 배치",
        "기획": "{year}년차 신규 공무원, 기획 지원 배치",
        "복지": "{year}년차 신규 공무원, 복지 창구 배치",
        "교육": "{year}년차 신규 공무원, 교육 행정 배치",
        "안전": "{year}년차 신규 공무원, 안전 행정 배치",
    },
    "0": {
        "정보화": "{year}년차 IT 전문직, 기관 정보보안 총괄",
        "행정": "{year}년차 전문직, 기관 행정지원 총괄",
        "재무": "{year}년차 전문직, 기관 재무관리 총괄",
        "감사": "{year}년차 전문직, 기관 내부감사 총괄",
        "기획": "{year}년차 전문직, 기관 혁신기획 총괄",
        "복지": "{year}년차 전문직, 기관 복지서비스 기획",
        "교육": "{year}년차 전문직, 기관 교육훈련 기획",
        "안전": "{year}년차 전문직, 기관 안전관리 총괄",
    },
}

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def _pick(rng: random.Random, items: List[Any]) -> Any:
    """Pick a random element from a list."""
    return rng.choice(items)


def _pick_unique(rng: random.Random, items: List[Any], n: int) -> List[Any]:
    """Pick n unique elements from a list."""
    return rng.sample(items, min(n, len(items)))


def _generate_name(rng: random.Random, gender: str) -> str:
    """Generate a Korean name based on gender."""
    family = _pick(rng, FAMILY_NAMES)
    if gender == "남성":
        given = _pick(rng, MALE_GIVEN_NAMES)
    else:
        given = _pick(rng, FEMALE_GIVEN_NAMES)
    return family + given


def _determine_age(rng: random.Random, grade_num: int) -> int:
    """Determine a realistic age based on grade."""
    if grade_num == 0:
        # Public institution - broader range
        return rng.randint(32, 55)
    elif grade_num <= 3:
        return rng.randint(50, 58)
    elif grade_num == 4:
        return rng.randint(44, 52)
    elif grade_num == 5:
        return rng.randint(38, 46)
    elif grade_num == 6:
        return rng.randint(34, 42)
    elif grade_num == 7:
        return rng.randint(30, 38)
    elif grade_num == 8:
        return rng.randint(28, 34)
    else:  # 9급
        return rng.randint(28, 33)


def _compute_career_years(rng: random.Random, age: int, grade_num: int) -> int:
    """Estimate career years based on age and grade."""
    if grade_num == 0:
        # Public institution - assume started after some private experience
        return age - 26 + rng.randint(0, 5) if age > 26 else 1
    # Government: typical start age 22-27
    start_age = rng.randint(22, 27)
    years = age - start_age
    return max(1, years)


def _build_occupation(
    org_type: str,
    grade_num: int,
    role_title: str,
    department: str,
    org: str,
) -> str:
    """Build occupation string matching the enrichment script regex."""
    dept_title = DEPARTMENT_TITLES.get(department, department)
    if org_type == "공공기관":
        # No grade number - enrichment script has fallback
        return "{} {} ({})".format(org, role_title, dept_title)
    else:
        # Must contain {N}급 for enrichment regex r"(\d)급"
        org_prefix = org_type
        if org_type == "기초자치단체":
            org_prefix = "지방자치단체"
        elif org_type == "광역자치단체":
            org_prefix = "지방자치단체"
        return "{} {}급 {} ({} 담당)".format(
            org_prefix, grade_num, role_title, dept_title
        )


def _build_approval_chain(org_type: str, grade_num: int, role_title: str) -> str:
    """Build an approval chain contextual to org_type and grade."""
    base = APPROVAL_CHAINS[org_type]
    if grade_num <= 3:
        return base.replace("주무관 → ", "").replace("사무관 → ", "")
    if grade_num == 0 and "과장" in role_title:
        return "대리 → 과장(본인) → 부장 → 본부장 → 사장"
    if grade_num == 0 and "팀장" in role_title:
        return "주사 → 팀장(본인) → 부장 → 본부장"
    if grade_num == 7:
        return "주무관(본인) 초안 → 팀장 → 과장 → 국장 결재"
    if grade_num == 8:
        return "서기(본인) 초안 → 주무관 → 팀장 → 과장"
    if grade_num == 9:
        return "서기(본인) 초안 → 주무관 → 팀장"
    return base


# ---------------------------------------------------------------------------
# Persona generation
# ---------------------------------------------------------------------------


def _generate_one_persona(
    rng: random.Random,
    persona_type: str,
    org_type: str,
    grade_num: int,
    idx: int,
    gender: str,
    used_keys: set,
) -> Optional[Dict[str, Any]]:
    """Generate a single persona. Returns None if duplicate, otherwise adds to used_keys."""

    # Name
    name = _generate_name(rng, gender)

    # Age
    age = _determine_age(rng, grade_num)

    # Uniqueness check
    key = (name, age)
    if key in used_keys:
        return None
    used_keys.add(key)

    # Department - spread evenly by using idx
    dept_idx = idx % len(DEPARTMENTS)
    department = DEPARTMENTS[dept_idx]

    # Region
    region = _pick(rng, REGIONS_BY_ORG_TYPE[org_type])

    # Org
    org = _pick(rng, ORG_NAMES[org_type])

    # Role title
    if grade_num == 0:
        if org_type == "공공기관":
            role_title = _pick(rng, ["팀장", "과장", "담당관"])
        else:
            role_title = "전문직"
    else:
        role_title = _pick(rng, GRADE_TITLES[grade_num])

    # Grade string
    if grade_num == 0:
        grade = "공공기관"
    else:
        grade = "{}급".format(grade_num)

    # Build fields
    occupation = _build_occupation(org_type, grade_num, role_title, department, org)

    # Life stage
    career_years = _compute_career_years(rng, age, grade_num)
    life_stage_tpl = LIFE_STAGE_TEMPLATES.get(str(grade_num), {}).get(department, "{year}년차 공무원")
    life_stage = life_stage_tpl.format(year=career_years)

    # Summary
    summary = _pick(rng, SUMMARY_TEMPLATES[persona_type])

    # Pain points (STRING, comma-separated)
    pp_list = PAIN_POINT_TEMPLATES[persona_type][department]
    rng.shuffle(pp_list)
    pain_points = ", ".join(pp_list[:rng.randint(3, 4)])

    # Procurement context
    procurement_context = PROCUREMENT_CONTEXTS[org_type][department]

    # Budget cycle
    budget_cycle = BUDGET_CYCLES[org_type]

    # Approval chain
    approval_chain = _build_approval_chain(org_type, grade_num, role_title)

    # Objections
    objections = list(_pick(rng, OBJECTION_TEMPLATES[persona_type]))

    # Goals
    goals = GOAL_TEMPLATES[persona_type][department]

    # Tech savviness
    low, high = TECH_SAVVINESS_RANGE[persona_type]
    tech_savviness = rng.randint(low, high)

    return {
        "name": name,
        "age": age,
        "gender": gender,
        "region": region,
        "occupation": occupation,
        "persona_type": persona_type,
        "life_stage": life_stage,
        "summary": summary,
        "pain_points": pain_points,
        "procurement_context": procurement_context,
        "budget_cycle": budget_cycle,
        "approval_chain": approval_chain,
        "grade": grade,
        "department": department,
        "org": org,
        "org_type": org_type,
        "objections": objections,
        "goals": goals,
        "tech_savviness": tech_savviness,
    }


def generate_all_personas() -> List[Dict[str, Any]]:
    """Generate exactly 100 diverse Korean public servant personas."""
    rng = random.Random()

    personas: List[Dict[str, Any]] = []
    used_keys: set = set()

    gov_grades: List[int] = []
    for grade_num, count in GRADE_DISTRIBUTION:
        gov_grades.extend([grade_num] * count)
    rng.shuffle(gov_grades)

    gov_org_types = ["중앙부처", "광역자치단체", "기초자치단체"]
    gov_org_pool = []
    for ot in gov_org_types:
        gov_org_pool.extend([ot] * 25)
    rng.shuffle(gov_org_pool)

    assignments: List[tuple] = []
    for pt in PERSONA_TYPES:
        for _ in range(5):
            assignments.append((pt, "공공기관", 0))
        for _ in range(15):
            gn = gov_grades.pop()
            ot = gov_org_pool.pop()
            assignments.append((pt, ot, gn))

    rng.shuffle(assignments)

    rng.shuffle(assignments)

    gender_pool = ["남성"] * 60 + ["여성"] * 40
    rng.shuffle(gender_pool)

    idx = 0
    for i, (pt, ot, gn) in enumerate(assignments):
        gender = gender_pool[i]
        persona = _generate_one_persona(rng, pt, ot, gn, idx, gender, used_keys)
        if persona is not None:
            personas.append(persona)
            idx += 1

        if persona is None:
            # Try up to 20 times with different random values
            for _retry in range(20):
                persona = _generate_one_persona(rng, pt, ot, gn, idx, gender, used_keys)
                if persona is not None:
                    personas.append(persona)
                    idx += 1
                    break

        if len(personas) >= 100:
            break

    return personas[:100]


def _build_grade_pool(rng: random.Random) -> List[int]:
    pool: List[int] = []
    for grade_num, count in GRADE_DISTRIBUTION:
        pool.extend([grade_num] * count)
    rng.shuffle(pool)
    return pool


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate 100 diverse Korean public servant personas for AX adoption analysis."
    )
    parser.add_argument(
        "--output",
        default="examples/example-personas-100.json",
        help="Output JSON file path (default: examples/example-personas-100.json)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for reproducibility (default: 42)",
    )
    args = parser.parse_args(argv)

    random.seed(args.seed)

    personas = generate_all_personas()

    # Validate
    if len(personas) != 100:
        print("ERROR: Generated {} personas, expected 100".format(len(personas)), file=sys.stderr)
        return 1

    # Check for duplicates
    seen_keys: set = set()
    for p in personas:
        key = (p["name"], p["age"], p["org"])
        if key in seen_keys:
            print(
                "ERROR: Duplicate persona: {} age {} at {}".format(p["name"], p["age"], p["org"]),
                file=sys.stderr,
            )
            return 1
        seen_keys.add(key)

    # Check all fields present
    required_fields = [
        "name", "age", "gender", "region", "occupation", "persona_type",
        "life_stage", "summary", "pain_points", "procurement_context",
        "budget_cycle", "approval_chain",
        # New fields
        "grade", "department", "org", "org_type",
        "objections", "goals", "tech_savviness",
    ]
    for i, p in enumerate(personas):
        for field in required_fields:
            if field not in p:
                print(
                    "ERROR: Persona #{} missing field: {}".format(i, field),
                    file=sys.stderr,
                )
                return 1

    # Check occupation format for government grades
    import re
    grade_re = re.compile(r"(\d)급")
    for i, p in enumerate(personas):
        if p["org_type"] != "공공기관":
            match = grade_re.search(p["occupation"])
            if not match:
                print(
                    "ERROR: Persona #{} ({}) occupation missing grade pattern: {}".format(
                        i, p["name"], p["occupation"]
                    ),
                    file=sys.stderr,
                )
                return 1

    # Check pain_points is string
    for i, p in enumerate(personas):
        if not isinstance(p["pain_points"], str):
            print(
                "ERROR: Persona #{} ({}) pain_points is not string: {}".format(
                    i, p["name"], type(p["pain_points"])
                ),
                file=sys.stderr,
            )
            return 1

    # Check objections and goals are lists
    for i, p in enumerate(personas):
        if not isinstance(p["objections"], list):
            print(
                "ERROR: Persona #{} ({}) objections is not list".format(i, p["name"]),
                file=sys.stderr,
            )
            return 1
        if not isinstance(p["goals"], list):
            print(
                "ERROR: Persona #{} ({}) goals is not list".format(i, p["name"]),
                file=sys.stderr,
            )
            return 1

    # Check tech_savviness range
    for i, p in enumerate(personas):
        if not isinstance(p["tech_savviness"], int) or p["tech_savviness"] < 1 or p["tech_savviness"] > 5:
            print(
                "ERROR: Persona #{} ({}) tech_savviness out of range: {}".format(
                    i, p["name"], p["tech_savviness"]
                ),
                file=sys.stderr,
            )
            return 1

    # Write output
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(personas, f, ensure_ascii=False, indent=2)

    # Print summary
    print("Generated {} personas -> {}".format(len(personas), output_path))

    # Print distribution summary
    print("\nDistribution summary:")
    print("-" * 50)

    # persona_type distribution
    pt_counts: Dict[str, int] = {}
    for p in personas:
        pt_counts[p["persona_type"]] = pt_counts.get(p["persona_type"], 0) + 1
    print("persona_type:", dict(sorted(pt_counts.items())))

    # org_type distribution
    ot_counts: Dict[str, int] = {}
    for p in personas:
        ot_counts[p["org_type"]] = ot_counts.get(p["org_type"], 0) + 1
    print("org_type:", dict(sorted(ot_counts.items())))

    # grade distribution
    g_counts: Dict[str, int] = {}
    for p in personas:
        g_counts[p["grade"]] = g_counts.get(p["grade"], 0) + 1
    print("grade:", dict(sorted(g_counts.items())))

    # gender distribution
    gen_counts: Dict[str, int] = {}
    for p in personas:
        gen_counts[p["gender"]] = gen_counts.get(p["gender"], 0) + 1
    print("gender:", dict(sorted(gen_counts.items())))

    # age range
    ages = [p["age"] for p in personas]
    print("age: min={}, max={}, avg={:.1f}".format(min(ages), max(ages), sum(ages) / len(ages)))

    # department distribution
    dept_counts: Dict[str, int] = {}
    for p in personas:
        dept_counts[p["department"]] = dept_counts.get(p["department"], 0) + 1
    print("department:", dict(sorted(dept_counts.items())))

    return 0


if __name__ == "__main__":
    sys.exit(main())
