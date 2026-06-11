# 공문 관리 AI POC

공문 파일을 등록하면 접수 공문과 생산 공문을 구분하고, 마감 일정과 취합 현황을 관리하는 Windows용 POC 프로젝트입니다.  
사용자는 `공문관리.exe`를 실행해 일반 프로그램처럼 사용할 수 있고, 내부에서는 Node.js 서버와 MCP 도구가 자동으로 동작합니다.

## 주요 기능

- 접수 공문 등록 및 마감 일정 관리
- 생산 공문 등록 및 수신자별 회신 취합 현황 관리
- 달력에서 내가 제출해야 하는 공문과 내가 취합해야 하는 공문을 구분 표시
- KORDOC 기반 문서 파싱 MCP 연동
- OpenAI 기반 1차 공문 분석
- OpenAI 기반 2차 페르소나 평가
- Gmail MCP를 통한 독촉 메일 초안 임시저장 또는 발송
- 로컬 파일 기반 데이터 저장

## 실행 방법

처음 한 번만 의존성을 설치합니다.

```bash
npm install
```

이후에는 프로젝트 폴더에 있는 아래 파일을 실행합니다.

```text
공문관리.exe
```

실행하면 내부 서버가 자동으로 켜지고 브라우저 앱 창이 열립니다. 사용자는 `localhost` 주소를 직접 다룰 필요가 없습니다.

## 첫 실행 환경설정

처음 실행하면 환경설정 창에서 아래 값을 입력합니다. 입력한 값은 이 PC의 `data/runtime-settings.json`에만 저장되며, `.gitignore`에 의해 GitHub에는 올라가지 않습니다.

| 항목 | 필수 | 설명 |
| --- | --- | --- |
| `OPENAI` | 필수 | OpenAI API 키입니다. 공문 분석과 페르소나 평가에 사용합니다. |
| `OPENAI_MODEL` | 선택 | 사용할 OpenAI 모델입니다. 기본값은 `gpt-4o-mini`입니다. |
| `GMAIL_CLIENT_ID` | Gmail 사용 시 필수 | Google Cloud OAuth 클라이언트 ID입니다. |
| `GMAIL_CLIENT_SECRET` | Gmail 사용 시 필수 | Google Cloud OAuth 클라이언트 보안 비밀번호입니다. |
| `GMAIL_REFRESH_TOKEN` | Gmail 사용 시 필수 | Gmail API용 OAuth refresh token입니다. |
| `GMAIL_FROM_EMAIL` | 선택 | 발신자 이메일 주소입니다. 비워도 Gmail 계정 기준으로 동작합니다. |
| `GMAIL_SENDER_NAME` | 선택 | 메일에 표시할 발신자 이름입니다. |

Windows 환경변수에 같은 이름으로 값을 넣어도 사용할 수 있습니다. 앱 화면에서 저장한 값이 있으면 화면 설정값을 우선 사용합니다.

## 개발 실행

브라우저에서 직접 확인하고 싶을 때는 서버를 실행합니다.

```bash
npm start
```

기본 주소는 아래와 같습니다.

```text
http://127.0.0.1:3000/dashboard.html
```

## MCP 실행 명령어

일반 사용 중에는 앱이 필요한 MCP를 내부에서 호출합니다. 개발 중 직접 실행해야 할 때만 아래 명령어를 사용합니다.

```bash
npm run mcp:kordoc
npm run mcp:gmail
```

## EXE 다시 만들기

런처 코드가 바뀐 경우 아래 명령어로 `공문관리.exe`를 다시 만들 수 있습니다.

```bash
npx --yes pkg launcher/official-document-launcher.js --targets node18-win-x64 --output 공문관리.exe
```

`공문관리.exe`는 로컬 실행 파일이라 GitHub에는 올리지 않습니다.

## 보안 및 GitHub 업로드 기준

GitHub에 올리지 않는 파일은 `.gitignore`에서 제외합니다.

- `.env`, `.env.*`
- `data/`
- `upload/`, `uploads/`
- `backup/`, `backups/`
- `result/`, `results/`
- 엑셀, CSV, PDF, HWP, HWPX, DOC 파일
- 압축 파일
- `*.exe`
- `credentials.json`, `client_secret*.json`
- 인증서와 개인키 파일

실제 API 키, refresh token, 문서 원본, 업로드 파일, 업무 데이터는 저장소에 포함하지 않습니다.  
공유용 예시는 `.env.example`처럼 실제 값이 없는 파일만 사용합니다.

## 프로젝트 구조

```text
public/                     화면 파일
server.js                   Express 서버
server/services/            공문 분석, MCP 클라이언트, 런타임 설정
server/mcp/                 KORDOC, Gmail MCP 서버
persona/examples/           페르소나 예시 데이터
launcher/                   Windows EXE 런처 코드
data/                       로컬 데이터 저장소, GitHub 제외
uploads/                    업로드 문서 저장소, GitHub 제외
```

## 동작 방식

1. `공문관리.exe`가 프로젝트 폴더를 기준으로 내부 서버를 실행합니다.
2. 브라우저 앱 창에서 `dashboard.html`을 엽니다.
3. 파일 등록 시 KORDOC MCP가 문서를 파싱합니다.
4. 접수 공문은 OpenAI 1차 분석과 OpenAI 2차 페르소나 평가를 수행합니다.
5. 생산 공문은 수신자, 회신기한, 취합 현황을 중심으로 관리합니다.
6. 독촉 메일은 Gmail MCP를 통해 초안 저장 또는 발송합니다.

## 주의사항

- 이 프로젝트는 POC 용도입니다.
- Gmail 기능을 사용하려면 Google Cloud에서 Gmail API를 활성화해야 합니다.
- OAuth 테스트 앱 상태라면 테스트 사용자에 본인 Google 계정을 추가해야 합니다.
- 폴더를 다른 PC로 옮긴 뒤에는 `npm install`을 다시 실행해야 할 수 있습니다.
