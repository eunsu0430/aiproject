# Official Document Manager

Node.js 기반 공문 관리 웹 애플리케이션입니다. 공문 등록, 마감 일정 관리, 접수/생산 공문 구분, 수신부서 취합 현황 관리, Gmail 독촉 메일 초안 저장/발송을 지원합니다.

## 설치

```bash
npm install
```

## 환경변수

`.env.example`을 참고해 로컬 환경 또는 배포 환경에 아래 값을 설정합니다. 실제 `.env` 파일은 GitHub에 올리지 않습니다.

```text
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini

ADMIN_ID=admin
ADMIN_PASSWORD=
ADMIN_NAME=Admin

GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
GMAIL_FROM_EMAIL=
GMAIL_SENDER_NAME=
```

## 실행

```bash
npm start
```

접속 주소:

```text
http://localhost:3000
```

## MCP 실행

KORDOC MCP:

```bash
npm run mcp:kordoc
```

Gmail 독촉 메일 MCP:

```bash
npm run mcp:gmail
```
