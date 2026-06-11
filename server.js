const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
require('dotenv').config();

const { analyzeDocument } = require('./server/services/documentAnalyzer');
const { parseOfficialFile } = require('./server/services/kordocMcpClient');

const app = express();
const PORT = process.env.PORT || 3000;
const dataDir = path.join(__dirname, 'data');
const usersPath = path.join(dataDir, 'users.json');
const documentsPath = path.join(dataDir, 'documents.json');
const uploadDir = path.join(__dirname, 'uploads');
const uploadTempDir = path.join(uploadDir, 'tmp');
const allowedUploadExtensions = new Set(['.pdf', '.hwp', '.hwpx', '.hwpml', '.docx', '.xls', '.xlsx']);

ensureDataFiles();

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
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'official-document-manager' });
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

app.post('/api/documents/upload', upload.single('officialFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: '지원하지 않는 파일이거나 파일이 없습니다.' });
    }

    const parsed = await parseOfficialFile(req.file.path);
    const parsedText = parsed.markdown || parsed.text || parsed.content || '';

    if (!parsedText.trim()) {
      return res.status(422).json({ message: '문서 파싱 결과가 비어 있습니다. 파일 형식 또는 내용을 확인해 주세요.' });
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
      department: (parsed.metadata && parsed.metadata.department) || req.body.department || '',
      note: req.body.note || '',
      fileInfo: {
        originalName,
        fileName: req.file.filename,
        path: null,
        size: req.file.size,
        mimetype: req.file.mimetype,
        parser: parsed.parser || 'kordoc'
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
  const document = {
    id: getNextId(documents),
    title: body.title || '제목 없음',
    sender: body.sender || '',
    content: body.content || '',
    dueDate: body.dueDate || body.deadline || '',
    department: body.department || '',
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
  readJsonArray(documentsPath, [], true);
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
  const dates = [];
  const isoMatches = source.matchAll(/20\d{2}[-.\/]\s*\d{1,2}[-.\/]\s*\d{1,2}/g);
  const koreanMatches = source.matchAll(/(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g);
  const shortMatches = source.matchAll(/(?<!\d)(\d{1,2})\s*[.\/]\s*(\d{1,2})\s*[.\/]?/g);
  const firstYear = (source.match(/20\d{2}/) || [new Date().getFullYear()])[0];

  for (const match of isoMatches) {
    dates.push(normalizeDateString(match[0]));
  }

  for (const match of koreanMatches) {
    dates.push(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`);
  }

  for (const match of shortMatches) {
    dates.push(`${firstYear}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`);
  }

  return dates
    .filter((date) => !Number.isNaN(new Date(date).getTime()))
    .sort((a, b) => new Date(b) - new Date(a))[0] || '';
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
