const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
require('dotenv').config();

const { analyzeDocument, extractProductionDocumentInfo } = require('./server/services/documentAnalyzer');
const { parseOfficialFile, startKordocWorkerServer } = require('./server/services/kordocMcpClient');
const { callEmailTool } = require('./server/services/emailMcpClient');
const { getPublicRuntimeStatus, readRuntimeSettings, writeRuntimeSettings } = require('./server/services/runtimeConfig');
const { dataDir, publicDir, uploadDir } = require('./server/services/appPaths');

const app = express();
const PORT = process.env.PORT || 3000;
const usersPath = path.join(dataDir, 'users.json');
const documentsPath = path.join(dataDir, 'documents.json');
const uploadTempDir = path.join(uploadDir, 'tmp');
const allowedUploadExtensions = new Set(['.pdf', '.hwp', '.hwpx', '.hwpml', '.docx', '.xls', '.xlsx']);

ensureDataFiles();
startKordocWorkerServer().catch((error) => {
  console.warn('[kordoc-worker]', error.message);
});

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

if (!fs.existsSync(uploadTempDir)) {
  fs.mkdirSync(uploadTempDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadTempDir,
    filename: (req, file, callback) => {
      const decodedName = decodeUploadName(file.originalname);
      callback(null, `${Date.now()}-${sanitizeFileName(decodedName)}`);
    }
  }),
  fileFilter: (req, file, callback) => {
    callback(null, allowedUploadExtensions.has(path.extname(decodeUploadName(file.originalname)).toLowerCase()));
  }
});

app.use(express.json({ limit: '2mb' }));
app.use(express.static(publicDir));

app.get('/', (req, res) => {
  res.redirect('/dashboard.html');
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'official-document-manager' });
});

app.post('/api/shutdown', (req, res) => {
  res.json({ ok: true });
  setTimeout(() => process.exit(0), 250);
});

app.get('/api/settings', (req, res) => {
  const settings = readRuntimeSettings();

  res.json({
    ...getPublicRuntimeStatus(),
    openaiKey: settings.openaiKey || '',
    gmailClientId: settings.gmailClientId || '',
    gmailClientSecret: settings.gmailClientSecret || '',
    gmailRefreshToken: settings.gmailRefreshToken || ''
  });
});

app.post('/api/settings', (req, res) => {
  writeRuntimeSettings(req.body || {});
  res.json(getPublicRuntimeStatus());
});

app.get('/api/email/status', async (req, res) => {
  try {
    const status = await callEmailTool('get_gmail_status', {});
    return res.json(status);
  } catch (error) {
    return res.status(500).json({
      configured: false,
      message: 'Gmail MCP 상태 확인에 실패했습니다.',
      detail: error.message
    });
  }
});

app.post('/api/login', (req, res) => {
  const { id, password } = req.body || {};
  const users = readJsonArray(usersPath, defaultUsers());
  const user = users.find((item) => item.id === id && item.password === password);

  if (!user) {
    return res.status(401).json({ message: 'Invalid ID or password.' });
  }

  return res.json({ id: user.id, name: user.name });
});

app.get('/api/documents', (req, res) => {
  res.json(readDocuments());
});

app.post('/api/documents', async (req, res) => {
  try {
    const documents = readDocuments();
    const document = await buildDocument(req.body || {}, documents);

    documents.push(document);
    writeJsonArray(documentsPath, documents);
    return res.status(201).json(document);
  } catch (error) {
    console.error('[documents:create]', error);
    return res.status(500).json({ message: '공문 저장에 실패했습니다.' });
  }
});

app.patch('/api/documents/:id/status', (req, res) => {
  const documents = readDocuments();
  const document = documents.find((item) => String(item.id) === String(req.params.id));

  if (!document) {
    return res.status(404).json({ message: 'Document not found.' });
  }

  document.status = normalizeStatus(req.body && req.body.status);
  document.completedAt = document.status === '완료' ? new Date().toISOString() : null;
  writeJsonArray(documentsPath, documents);
  return res.json(document);
});

app.patch('/api/documents/:id/recipients/:recipientId', (req, res) => {
  const documents = readDocuments();
  const document = documents.find((item) => String(item.id) === String(req.params.id));

  if (!document) {
    return res.status(404).json({ message: 'Document not found.' });
  }

  const recipient = Array.isArray(document.recipients)
    ? document.recipients.find((item) => String(item.id) === String(req.params.recipientId))
    : null;

  if (!recipient) {
    return res.status(404).json({ message: 'Recipient not found.' });
  }

  recipient.status = req.body && req.body.status === 'received' ? 'received' : 'pending';
  recipient.note = req.body && typeof req.body.note === 'string' ? req.body.note : recipient.note || '';
  recipient.receivedAt = recipient.status === 'received' ? new Date().toISOString() : null;
  document.recipientProgress = getRecipientProgress(document.recipients);

  if (document.documentType === 'outgoing' && document.recipientProgress.total > 0) {
    document.status = document.recipientProgress.pending === 0 ? '완료' : '진행중';
    document.completedAt = document.recipientProgress.pending === 0 ? new Date().toISOString() : null;
  }

  writeJsonArray(documentsPath, documents);
  return res.json(document);
});

app.post('/api/documents/:id/recipients/:recipientId/reminder', async (req, res) => {
  try {
    const documents = readDocuments();
    const document = documents.find((item) => String(item.id) === String(req.params.id));

    if (!document) {
      return res.status(404).json({ message: 'Document not found.' });
    }

    const recipient = Array.isArray(document.recipients)
      ? document.recipients.find((item) => String(item.id) === String(req.params.recipientId))
      : null;

    if (!recipient) {
      return res.status(404).json({ message: 'Recipient not found.' });
    }

    const email = String(req.body && req.body.email || recipient.email || '').trim();
    const action = req.body && req.body.action === 'send' ? 'send' : 'draft';

    if (!email) {
      return res.status(400).json({ message: '담당자 이메일을 입력해 주세요.' });
    }

    const toolName = action === 'send' ? 'send_reminder_email' : 'create_reminder_draft';
    const result = await callEmailTool(toolName, {
      to: email,
      recipientName: recipient.name || document.department || '담당자',
      documentTitle: document.title || '공문',
      responseDueDate: document.responseDueDate || document.dueDate || document.deadline || '',
      documentSummary: document.analysis && document.analysis.summary || summarizeForEmail(document.content || document.parsedContent || ''),
      progressText: formatRecipientProgressText(document),
      requiredAction: getReminderRequiredAction(document),
      senderName: req.body && req.body.senderName || '',
      customMessage: req.body && req.body.customMessage || ''
    });

    recipient.email = email;
    recipient.reminderStatus = action === 'send' ? 'sent' : 'drafted';
    recipient.lastReminderAt = new Date().toISOString();
    recipient.reminderHistory = Array.isArray(recipient.reminderHistory) ? recipient.reminderHistory : [];
    recipient.reminderHistory.push({
      action,
      email,
      at: recipient.lastReminderAt,
      subject: result.subject || '',
      draftId: result.draftId || '',
      messageId: result.messageId || ''
    });

    writeJsonArray(documentsPath, documents);
    return res.json({ document, recipient, emailResult: result });
  } catch (error) {
    console.error('[gmail:reminder]', error);
    return res.status(500).json({
      message: 'Gmail 독촉 메일 처리에 실패했습니다.',
      detail: error.message
    });
  }
});

app.post('/api/documents/upload', upload.single('officialFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: '지원하지 않는 파일이거나 파일이 없습니다.' });
    }

    const parsed = await parseOfficialFile(req.file.path);
    const parsedText = parsed.markdown || parsed.text || parsed.content || '';

    if (!parsedText.trim()) {
      return res.status(422).json({
        message: '문서 파싱 결과가 비어 있습니다. 파일 형식 또는 내용을 확인해 주세요.',
        detail: parsed.metadata && (parsed.metadata.parserError || parsed.metadata.kordocError) || '',
        parser: parsed.parser || ''
      });
    }

    const originalName = decodeUploadName(req.file.originalname);
    const titleCandidates = [
      parsed.metadata && parsed.metadata.title,
      extractTitleFromText(parsedText),
      stripExtension(originalName)
    ];
    const documents = readDocuments();
    const document = await buildDocument({
      title: chooseBestKoreanText(titleCandidates, '제목 없음'),
      sender: (parsed.metadata && (parsed.metadata.author || parsed.metadata.creator)) || extractSenderFromText(parsedText) || '파일 업로드',
      content: parsedText,
      dueDate: req.body.dueDate || '',
      dueDateSource: req.body.dueDate ? 'user' : 'auto',
      documentType: getDocumentTypeFromBody(req.body),
      recipients: req.body.recipients || '',
      responseDueDate: req.body.responseDueDate || req.body.dueDate || '',
      department: (parsed.metadata && parsed.metadata.department) || req.body.department || '',
      note: req.body.note || '',
      fileInfo: {
        originalName,
        fileName: req.file.filename,
        path: null,
        size: req.file.size,
        mimetype: req.file.mimetype,
        parser: parsed.parser || 'kordoc',
        parserError: parsed.metadata && (parsed.metadata.parserError || parsed.metadata.kordocError) || ''
      },
      parsedContent: parsedText
    }, documents);

    documents.push(document);
    writeJsonArray(documentsPath, documents);
    return res.status(201).json(document);
  } catch (error) {
    console.error('[documents:upload]', error);
    return res.status(500).json({
      message: '문서 파싱 또는 공문 저장에 실패했습니다.',
      detail: error.message
    });
  } finally {
    cleanupUploadedTempFile(req.file && req.file.path);
  }
});

app.delete('/api/documents/:id', (req, res) => {
  const documents = readDocuments();
  const nextDocuments = documents.filter((document) => String(document.id) !== String(req.params.id));

  if (nextDocuments.length === documents.length) {
    return res.status(404).json({ message: 'Document not found.' });
  }

  writeJsonArray(documentsPath, nextDocuments);
  return res.json({ message: 'Deleted.' });
});

async function buildDocument(body, documents) {
  const userProvidedDueDate = body.dueDateSource === 'user';
  const documentType = getDocumentTypeFromBody(body);
  const recipients = documentType === 'outgoing' ? normalizeRecipients(body.recipients) : [];
  const document = {
    id: getNextId(documents),
    documentType,
    title: body.title || '제목 없음',
    sender: body.sender || '',
    content: body.content || '',
    dueDate: body.dueDate || body.deadline || '',
    responseDueDate: body.responseDueDate || body.dueDate || body.deadline || '',
    department: body.department || '',
    recipients,
    recipientProgress: getRecipientProgress(recipients),
    note: body.note || '',
    status: '진행중',
    createdAt: new Date().toISOString()
  };

  if (body.fileInfo) {
    document.fileInfo = body.fileInfo;
  }

  if (body.parsedContent) {
    document.parsedContent = body.parsedContent;
  }

  if (document.documentType === 'outgoing') {
    const productionInfo = await extractProductionDocumentInfo(document);

    if (productionInfo.recipients.length > 0) {
      document.recipients = normalizeRecipients(productionInfo.recipients);
      document.recipientProgress = getRecipientProgress(document.recipients);
    } else if (document.recipients.length === 0) {
      document.recipients = normalizeRecipients(extractRecipientsFromText(document.content, document.department));
      document.recipientProgress = getRecipientProgress(document.recipients);
    }

    document.responseDueDate = productionInfo.responseDueDate || document.responseDueDate || document.dueDate || document.deadline || '';
    document.dueDate = document.dueDate || document.responseDueDate || '';
    document.deadline = document.responseDueDate || document.dueDate || '';
    document.analysis = buildOutgoingTrackingAnalysis(document, productionInfo);
    return document;
  }

  document.analysis = await analyzeDocument(document);
  if (!userProvidedDueDate && document.analysis.deadline) {
    document.dueDate = document.analysis.deadline;
  } else {
    document.dueDate = document.dueDate || document.analysis.deadline || extractDateFromText(document.content) || '';
  }

  document.deadline = document.analysis.deadline || document.dueDate || '';

  if (!document.department && Array.isArray(document.analysis.departments)) {
    document.department = document.analysis.departments[0] || '';
  }

  return document;
}

function ensureDataFiles() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  readJsonArray(usersPath, defaultUsers(), true);
  syncAdminUserFromEnv();
  readJsonArray(documentsPath, [], true);
}

function syncAdminUserFromEnv() {
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) return;

  const adminId = process.env.ADMIN_ID || 'admin';
  const adminName = process.env.ADMIN_NAME || '관리자';
  const users = readJsonArray(usersPath, [], true);
  const adminUser = users.find((user) => user.id === adminId);

  if (adminUser) {
    adminUser.password = adminPassword;
    adminUser.name = adminUser.name || adminName;
  } else {
    users.push({ id: adminId, password: adminPassword, name: adminName });
  }

  writeJsonArray(usersPath, users);
}

function readDocuments() {
  return readJsonArray(documentsPath, [], true);
}

function readJsonArray(filePath, fallback, repair = false) {
  try {
    if (!fs.existsSync(filePath)) {
      if (repair) writeJsonArray(filePath, fallback);
      return fallback;
    }

    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (!content) {
      if (repair) writeJsonArray(filePath, fallback);
      return fallback;
    }

    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    if (repair) writeJsonArray(filePath, fallback);
    return fallback;
  }
}

function writeJsonArray(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function getNextId(documents) {
  const ids = documents.map((item) => Number(item.id)).filter(Number.isFinite);
  return ids.length > 0 ? Math.max(...ids) + 1 : 1;
}

function normalizeStatus(status) {
  return status === '완료' ? '완료' : '진행중';
}

function getDocumentTypeFromBody(body) {
  const rawType = String(body && body.documentType || '').trim().toLowerCase();

  if (['outgoing', 'production', 'produced'].includes(rawType)) {
    return 'outgoing';
  }

  if (/생산|취합|발송|수신/.test(rawType)) {
    return 'outgoing';
  }

  if (body && (String(body.recipients || '').trim() || String(body.responseDueDate || '').trim())) {
    return 'outgoing';
  }

  return 'incoming';
}

function normalizeRecipients(value) {
  if (Array.isArray(value)) {
    return value
      .map((item, index) => normalizeRecipientItem(item, index))
      .filter(Boolean);
  }

  return String(value || '')
    .split(/[\n,;]+/)
    .map((name, index) => normalizeRecipientItem(name, index))
    .filter(Boolean);
}

function normalizeRecipientItem(value, index) {
  const source = value && typeof value === 'object' ? value : { name: value };
  const name = String(source.name || source.department || '').trim();

  if (!name) {
    return null;
  }

  return {
    id: String(source.id || `recipient-${index + 1}-${sanitizeFileName(name).slice(0, 24)}`),
    name,
    status: source.status === 'received' ? 'received' : 'pending',
    receivedAt: source.receivedAt || null,
    note: source.note || ''
  };
}

function getRecipientProgress(recipients) {
  const items = Array.isArray(recipients) ? recipients : [];
  const received = items.filter((item) => item.status === 'received').length;

  return {
    total: items.length,
    received,
    pending: Math.max(items.length - received, 0)
  };
}

function buildOutgoingTrackingAnalysis(document, productionInfo = {}) {
  const progress = getRecipientProgress(document.recipients);

  return {
    summary: productionInfo.summary || `생산 공문 취합 대상 ${progress.total}곳 중 ${progress.received}곳 접수, ${progress.pending}곳 미수신`,
    deadline: document.responseDueDate || document.dueDate || '',
    departments: document.recipients.map((recipient) => recipient.name),
    requiredActions: progress.pending > 0 ? ['수신부서 회신 확인', '미수신 부서 독촉'] : ['취합 완료'],
    importance: '',
    importanceReason: ['생산 공문은 AI/페르소나 평가 없이 수신부서 취합 현황만 관리합니다.'],
    aiMode: productionInfo.aiMode || 'tracking-only',
    extractionError: productionInfo.errorMessage || ''
  };
}

function formatRecipientProgressText(document) {
  if (!document || document.documentType !== 'outgoing') {
    return '';
  }

  const progress = getRecipientProgress(document.recipients);
  return `전체 ${progress.total}곳 중 ${progress.received}곳 접수, ${progress.pending}곳 미수신`;
}

function getReminderRequiredAction(document) {
  const dueDate = document && (document.responseDueDate || document.dueDate || document.deadline);
  const dueText = dueDate ? `${dueDate}까지 자료 회신` : '요청 자료 회신';

  return `${dueText} 부탁드립니다. 이미 제출하셨다면 회신 여부만 확인해 주세요.`;
}

function summarizeForEmail(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();

  if (!text) {
    return '';
  }

  return text.length > 220 ? `${text.slice(0, 220)}...` : text;
}

function extractRecipientsFromText(text, ownDepartment) {
  const source = String(text || '').replace(/\s+/g, ' ');
  const recipients = [];
  const patterns = [
    /수신\s*[:：]?\s*([^ 참조 경유 제목 시행 접수]+(?:\s+[^ 참조 경유 제목 시행 접수]+){0,20})/,
    /수신자\s*[:：]?\s*([^ 참조 경유 제목 시행 접수]+(?:\s+[^ 참조 경유 제목 시행 접수]+){0,20})/
  ];

  patterns.forEach((pattern) => {
    const match = source.match(pattern);
    if (match && match[1]) {
      match[1]
        .split(/[,，ㆍ·;、]|\s{2,}/)
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((item) => recipients.push(item));
    }
  });

  return Array.from(new Set(recipients))
    .filter((item) => item !== ownDepartment)
    .slice(0, 50);
}

function defaultUsers() {
  return [{
    id: process.env.ADMIN_ID || 'admin',
    password: process.env.ADMIN_PASSWORD || '',
    name: process.env.ADMIN_NAME || '관리자'
  }];
}

function decodeUploadName(name) {
  const value = String(name || 'uploaded-file');

  return repairLatin1Mojibake(value);
}

function sanitizeFileName(name) {
  return String(name || 'uploaded-file').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function stripExtension(fileName) {
  return path.basename(fileName, path.extname(fileName));
}

function extractTitleFromText(text) {
  const raw = String(text || '').replace(/^## Page \d+\s*/gm, '').trim();
  const titleMatch = raw.match(/제목\s+(.+?)(?:\s+\d+\.\s|(?:\s+붙임)|(?:\s+시행)|$)/s);

  if (titleMatch) {
    return repairLatin1Mojibake(titleMatch[1].replace(/\s+/g, ' ').trim().slice(0, 120));
  }

  const firstUsefulLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length >= 4 && !line.startsWith('## Page'));

  return firstUsefulLine ? repairLatin1Mojibake(firstUsefulLine.slice(0, 80)) : '';
}

function extractSenderFromText(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => /청|부|구|시|군|학교|기관|센터/.test(line) && line.length <= 40) || '';
}

function extractDateFromText(text) {
  const source = String(text || '');
  const candidates = collectDateCandidatesFromText(source);

  return candidates
    .sort((a, b) => b.score - a.score || new Date(a.date) - new Date(b.date))[0]?.date || '';
}

function collectDateCandidatesFromText(source) {
  const candidates = [];
  const firstYear = (source.match(/20\d{2}/) || [new Date().getFullYear()])[0];
  const patterns = [
    /20\d{2}[-.\/]\s*\d{1,2}[-.\/]\s*\d{1,2}/g,
    /(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g,
    /(?<!\d)(\d{1,2})\s*월\s*(\d{1,2})\s*일/g,
    /(?<!\d)(\d{1,2})\s*[.\/]\s*(\d{1,2})\s*[.\/]?/g
  ];

  patterns.forEach((pattern, patternIndex) => {
    for (const match of source.matchAll(pattern)) {
      const date = patternIndex === 0
        ? normalizeDateString(match[0])
        : patternIndex === 1
          ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
          : `${firstYear}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;

      if (!Number.isNaN(new Date(date).getTime())) {
        candidates.push({
          date,
          score: scoreDateCandidateFromText(source, match.index || 0, date)
        });
      }
    }
  });

  return candidates;
}

function scoreDateCandidateFromText(source, index, date) {
  const before = source.slice(Math.max(0, index - 120), index);
  const after = source.slice(index, Math.min(source.length, index + 140));
  const context = `${before} ${after}`;
  let score = 0;

  if (/제출|회신|등록|신청|참여|진단|응답|납부|보고|검토|처리|취합|제출처/.test(context)) score += 6;
  if (/기한|마감|까지|완료|기일|기간|제출일|회신일|신청일|등록일/.test(context)) score += 8;
  if (/제출\s*기한|회신\s*기한|자료\s*제출|의견\s*제출|제출\s*바람|회신\s*바람|까지\s*(제출|회신|등록|신청)/.test(context)) score += 12;
  if (/[~～-]\s*(?:20\d{2}[-.\/년\s]*)?\d{1,2}/.test(before) || /[~～-]/.test(before)) score += 5;
  if (/시행일|접수일|작성일|발송일|문서번호|등록번호|접수번호|감사관-\d+/.test(context)) score -= 12;
  else if (/시행|접수|작성|발송|관련|문서번호/.test(context)) score -= 5;
  if (/전화|팩스|우편|주소|사업비|예산|금액|원\b/.test(context)) score -= 3;

  const diffDays = getDueDateDiffDays(date);
  if (diffDays < -365) score -= 4;
  else if (diffDays < 0) score += 1;
  else if (diffDays <= 30) score += 4;
  else if (diffDays <= 120) score += 2;

  return score;
}

function normalizeDateString(value) {
  const parts = String(value).replace(/\s+/g, '').replace(/[.\/]/g, '-').split('-');
  return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
}

function chooseBestKoreanText(values, fallback) {
  const candidates = values
    .filter(Boolean)
    .map((value) => repairLatin1Mojibake(String(value).trim()))
    .filter(Boolean);

  if (candidates.length === 0) {
    return fallback;
  }

  return candidates
    .sort((a, b) => getTextQualityScore(b) - getTextQualityScore(a))[0] || fallback;
}

function repairLatin1Mojibake(value) {
  const text = String(value || '');

  if (!text) {
    return text;
  }

  if (/[가-힣]/.test(text) && !/[ÃÂêëìíîïð]/.test(text)) {
    return text;
  }

  try {
    const decoded = Buffer.from(text, 'latin1').toString('utf8');
    return getTextQualityScore(decoded) > getTextQualityScore(text) ? decoded : text;
  } catch (error) {
    return text;
  }
}

function getTextQualityScore(value) {
  const text = String(value || '');
  const hangul = (text.match(/[가-힣]/g) || []).length;
  const ascii = (text.match(/[A-Za-z0-9]/g) || []).length;
  const mojibake = (text.match(/[�ÃÂêëìíîïð]/g) || []).length;
  const cjkMojibake = (text.match(/[怨臾遺湲嫄寃쒖쓽꾨]/g) || []).length;

  return hangul * 5 + ascii - mojibake * 8 - cjkMojibake * 2;
}

function cleanupUploadedTempFile(filePath) {
  if (!filePath) {
    return;
  }

  try {
    const resolved = path.resolve(filePath);
    const tempRoot = path.resolve(uploadTempDir);

    if (resolved.startsWith(tempRoot)) {
      fs.unlinkSync(resolved);
    }
  } catch (error) {
    console.warn('[upload:cleanup]', error.message);
  }
}

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
