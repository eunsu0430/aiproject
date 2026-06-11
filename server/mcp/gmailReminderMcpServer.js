const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
require('dotenv').config();

const server = new McpServer({
  name: 'gmail-reminder-mailer',
  version: '1.0.0'
});

const reminderInputSchema = {
  to: z.string().email(),
  recipientName: z.string().min(1),
  documentTitle: z.string().min(1),
  responseDueDate: z.string().optional(),
  senderName: z.string().optional(),
  customMessage: z.string().optional()
};

server.tool(
  'preview_reminder_email',
  '미수신 수신부서 담당자에게 보낼 독촉 메일 제목과 본문을 생성합니다. Gmail에는 저장하거나 발송하지 않습니다.',
  reminderInputSchema,
  async (input) => {
    return toJson(buildReminderEmail(input));
  }
);

server.tool(
  'create_reminder_draft',
  '미수신 수신부서 담당자에게 보낼 독촉 메일을 Gmail 임시보관함에 저장합니다.',
  reminderInputSchema,
  async (input) => {
    const email = buildReminderEmail(input);
    const draft = await createGmailDraft({
      to: input.to,
      subject: email.subject,
      body: email.body
    });

    return toJson({
      ...email,
      provider: 'gmail',
      action: 'draft',
      draftId: draft.id,
      messageId: draft.message && draft.message.id
    });
  }
);

server.tool(
  'send_reminder_email',
  '미수신 수신부서 담당자에게 독촉 메일을 Gmail로 바로 발송합니다.',
  reminderInputSchema,
  async (input) => {
    const email = buildReminderEmail(input);
    const message = await sendGmailMessage({
      to: input.to,
      subject: email.subject,
      body: email.body
    });

    return toJson({
      ...email,
      provider: 'gmail',
      action: 'send',
      messageId: message.id,
      threadId: message.threadId
    });
  }
);

server.tool(
  'get_gmail_status',
  'Gmail OAuth 환경변수가 설정되어 있는지 확인합니다.',
  {},
  async () => {
    return toJson({
      configured: Boolean(getGmailConfig().clientId && getGmailConfig().clientSecret && getGmailConfig().refreshToken),
      fromEmail: getGmailConfig().fromEmail || ''
    });
  }
);

server.tool(
  'test_gmail_profile',
  '현재 Gmail OAuth 토큰으로 Gmail profile API를 호출해 인증 상태를 확인합니다.',
  {},
  async () => {
    const accessToken = await getAccessToken();
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    return toJson(await parseGmailResponse(response, 'gmail.profile'));
  }
);

function buildReminderEmail(input) {
  const senderName = input.senderName || process.env.GMAIL_SENDER_NAME || '담당자';
  const dueText = input.responseDueDate ? `${input.responseDueDate}까지` : '기한 내';
  const subject = `[회신 요청] ${input.documentTitle}`;
  const customMessage = input.customMessage ? `\n${input.customMessage.trim()}\n` : '';
  const body = [
    `${input.recipientName} 담당자님, 안녕하세요.`,
    '',
    `아래 공문 관련 자료가 아직 회신되지 않아 확인 요청드립니다.`,
    '',
    `- 공문명: ${input.documentTitle}`,
    `- 회신기한: ${dueText}`,
    customMessage,
    '이미 회신하셨다면 본 메일은 참고만 부탁드립니다.',
    '확인 후 회신 부탁드립니다.',
    '',
    '감사합니다.',
    senderName
  ].filter((line) => line !== '').join('\n');

  return {
    to: input.to,
    recipientName: input.recipientName,
    subject,
    body
  };
}

async function createGmailDraft({ to, subject, body }) {
  const accessToken = await getAccessToken();
  const raw = buildRawMessage({ to, subject, body });
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message: { raw } })
  });

  return parseGmailResponse(response, 'gmail.drafts.create');
}

async function sendGmailMessage({ to, subject, body }) {
  const accessToken = await getAccessToken();
  const raw = buildRawMessage({ to, subject, body });
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw })
  });

  return parseGmailResponse(response, 'gmail.messages.send');
}

async function getAccessToken() {
  const config = getGmailConfig();

  if (!config.clientId || !config.clientSecret || !config.refreshToken) {
    throw new Error('Gmail OAuth environment variables are missing.');
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: 'refresh_token'
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const data = await parseGmailResponse(response, 'oauth.token');

  if (!data.access_token) {
    throw new Error('Gmail access token was not returned.');
  }

  return data.access_token;
}

function buildRawMessage({ to, subject, body }) {
  const config = getGmailConfig();
  const senderName = process.env.GMAIL_SENDER_NAME || config.fromEmail;
  const from = config.fromEmail ? `From: ${encodeMimeWord(senderName)} <${config.fromEmail}>` : '';
  const headers = [
    from,
    `To: ${to}`,
    `Subject: ${encodeMimeWord(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit'
  ].filter(Boolean);

  return base64UrlEncode(`${headers.join('\r\n')}\r\n\r\n${body}`);
}

function encodeMimeWord(value) {
  return `=?UTF-8?B?${Buffer.from(String(value), 'utf8').toString('base64')}?=`;
}

function base64UrlEncode(value) {
  return Buffer.from(String(value), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function parseGmailResponse(response, context) {
  const text = await response.text();
  const data = parseJsonOrText(text);

  if (!response.ok) {
    const detail = getGoogleErrorDetail(data, text);
    throw new Error(`${context || 'google.api'} failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`);
  }

  return data;
}

function parseJsonOrText(text) {
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return { raw: text };
  }
}

function getGoogleErrorDetail(data, text) {
  if (data && data.error) {
    if (typeof data.error === 'string') {
      return [data.error, data.error_description].filter(Boolean).join(': ');
    }

    return [
      data.error.message,
      data.error.status,
      Array.isArray(data.error.errors) ? data.error.errors.map((item) => item.reason || item.message).filter(Boolean).join(', ') : ''
    ].filter(Boolean).join(' | ');
  }

  return text ? String(text).slice(0, 500) : '';
}

function getGmailConfig() {
  return {
    clientId: process.env.GMAIL_CLIENT_ID || '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET || '',
    refreshToken: process.env.GMAIL_REFRESH_TOKEN || '',
    fromEmail: process.env.GMAIL_FROM_EMAIL || ''
  };
}

function toJson(data, isError = false) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2)
      }
    ],
    isError
  };
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
