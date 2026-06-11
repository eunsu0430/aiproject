const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { appRoot } = require('./appPaths');

const execFileAsync = promisify(execFile);
const projectRoot = appRoot;
let workerServer = null;
let workerUrl = '';
let workerStartPromise = null;

function startKordocWorkerServer() {
  if (workerUrl) {
    return Promise.resolve(workerUrl);
  }

  if (workerStartPromise) {
    return workerStartPromise;
  }

  workerServer = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/parse') {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    try {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body || '{}');
      const parsed = await parseOfficialFileDirect(payload.filePath);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(parsed));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });

  workerStartPromise = new Promise((resolve, reject) => {
    workerServer.once('error', reject);
    workerServer.listen(0, '127.0.0.1', () => {
      const address = workerServer.address();
      workerUrl = `http://127.0.0.1:${address.port}`;
      console.log(`[kordoc-worker] hidden parser server started at ${workerUrl}`);
      resolve(workerUrl);
    });
  });

  return workerStartPromise;
}

async function parseOfficialFile(filePath) {
  if (workerUrl) {
    return parseViaKordocWorker(filePath);
  }

  return parseOfficialFileDirect(filePath);
}

async function parseViaKordocWorker(filePath) {
  const url = new URL('/parse', workerUrl);
  const body = JSON.stringify({ filePath: path.resolve(filePath) });
  const response = await postJson(url, body);
  const data = response.body ? JSON.parse(response.body) : {};

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(data.error || `KORDOC worker failed: ${response.statusCode}`);
  }

  return data;
}

async function parseOfficialFileDirect(filePath) {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Upload file not found: ${absolutePath}`);
  }

  const jsonResult = await parseWithKordocApi(absolutePath).catch((error) => ({ error }));

  if (!jsonResult.error) {
    return normalizeKordocResult(jsonResult, 'kordoc-api');
  }

  const markdownResult = await runKordoc(absolutePath, 'markdown').catch(async (error) => {
    return parseWithBuiltInFallback(absolutePath, `kordoc failed: ${jsonResult.error.message}; markdown fallback failed: ${error.message}`);
  });

  if (markdownResult && typeof markdownResult === 'object') {
    return markdownResult;
  }

  return normalizeTextResult(markdownResult, 'kordoc-markdown');
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 120000
    }, (response) => {
      const chunks = [];

      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode || 0,
          body: Buffer.concat(chunks).toString('utf8')
        });
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('KORDOC worker request timed out.'));
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

async function parseWithBuiltInFallback(filePath, parserError) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.pdf') {
    return parsePdfWithPdfjs(filePath, parserError);
  }

  if (extension === '.docx') {
    return parseDocxWithZip(filePath, parserError);
  }

  if (extension === '.hwpx' || extension === '.hwpml') {
    return parseHwpxWithZip(filePath, parserError);
  }

  if (extension === '.xlsx' || extension === '.xls') {
    return parseSpreadsheetWithZip(filePath, parserError);
  }

  if (extension === '.hwp') {
    return parseHwpBinaryFallback(filePath, parserError);
  }

  throw new Error(parserError);
}

async function parseWithKordocApi(filePath) {
  const kordoc = await import('kordoc');
  const buffer = fs.readFileSync(filePath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const result = await kordoc.parse(arrayBuffer, { filePath });

  if (!result || result.success === false) {
    throw new Error(result && result.error ? result.error : 'kordoc parse failed');
  }

  return result;
}

async function runKordoc(filePath, format) {
  if (process.pkg) {
    throw new Error('kordoc CLI is not available inside the standalone EXE.');
  }

  const { command, args } = getKordocCommand(filePath, format);
  const { stdout } = await execFileAsync(command, args, {
    cwd: projectRoot,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 50
  });

  if (format === 'json') {
    return JSON.parse(stdout);
  }

  return stdout;
}

function getKordocCommand(filePath, format) {
  const localCli = path.join(projectRoot, 'node_modules', 'kordoc', 'dist', 'cli.js');
  const args = ['--format', format, '--silent', filePath];

  if (fs.existsSync(localCli)) {
    return {
      command: process.execPath,
      args: [localCli, ...args]
    };
  }

  return {
    command: process.platform === 'win32' ? 'kordoc.cmd' : 'kordoc',
    args
  };
}

async function loadZip(filePath) {
  const JSZip = require('jszip');
  return JSZip.loadAsync(fs.readFileSync(filePath));
}

async function parseDocxWithZip(filePath, parserError) {
  const zip = await loadZip(filePath);
  const documentXml = await readZipText(zip, 'word/document.xml');
  const text = extractTextFromWordXml(documentXml);

  return {
    markdown: text,
    text,
    metadata: { parserError },
    parser: 'docx-zip-fallback'
  };
}

async function parseHwpxWithZip(filePath, parserError) {
  const zip = await loadZip(filePath);
  const sectionFiles = Object.keys(zip.files)
    .filter((name) => /(?:Contents\/section|BodyText\/section|section)\d+\.xml$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
  const texts = [];

  for (const fileName of sectionFiles) {
    const xml = await readZipText(zip, fileName);
    const text = extractTextFromXml(xml);
    if (text) texts.push(text);
  }

  const text = texts.join('\n\n').trim();

  return {
    markdown: text,
    text,
    metadata: { parserError },
    parser: 'hwpx-zip-fallback'
  };
}

async function parseSpreadsheetWithZip(filePath, parserError) {
  const zip = await loadZip(filePath);
  const sharedStrings = await readSharedStrings(zip);
  const sheetFiles = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
  const rows = [];

  for (const fileName of sheetFiles) {
    const xml = await readZipText(zip, fileName);
    rows.push(...extractRowsFromSheetXml(xml, sharedStrings));
  }

  const text = rows.map((row) => row.filter(Boolean).join(' ')).filter(Boolean).join('\n');

  return {
    markdown: text,
    text,
    metadata: { parserError },
    parser: 'xlsx-zip-fallback'
  };
}

async function readZipText(zip, fileName) {
  const file = zip.file(fileName) || findZipFile(zip, fileName);

  if (!file) {
    return '';
  }

  return file.async('string');
}

function findZipFile(zip, fileName) {
  const normalized = normalizeZipPath(fileName);
  const actualName = Object.keys(zip.files).find((name) => normalizeZipPath(name) === normalized);
  return actualName ? zip.file(actualName) : null;
}

function normalizeZipPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

async function readSharedStrings(zip) {
  const xml = await readZipText(zip, 'xl/sharedStrings.xml');

  if (!xml) {
    return [];
  }

  return Array.from(xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g))
    .map((match) => extractTextFromXml(match[1]));
}

function extractRowsFromSheetXml(xml, sharedStrings) {
  return Array.from(String(xml || '').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g))
    .map((rowMatch) => Array.from(rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g))
      .map((cellMatch) => {
        const attributes = cellMatch[1] || '';
        const cellXml = cellMatch[2] || '';
        const rawValue = (cellXml.match(/<v[^>]*>([\s\S]*?)<\/v>/) || [])[1] || '';

        if (/\bt=["']s["']/.test(attributes)) {
          return sharedStrings[Number(rawValue)] || '';
        }

        return decodeXml(rawValue);
      }));
}

function extractTextFromWordXml(xml) {
  return Array.from(String(xml || '').matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g))
    .map((match) => extractTextFromXml(match[1]))
    .filter(Boolean)
    .join('\n');
}

function extractTextFromXml(xml) {
  return decodeXml(String(xml || '')
    .replace(/<[^>]*br[^>]*>/gi, '\n')
    .replace(/<[^>]*tab[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function parseHwpBinaryFallback(filePath, parserError) {
  const buffer = fs.readFileSync(filePath);
  const candidates = [
    extractReadableText(buffer.toString('utf8')),
    extractReadableText(buffer.toString('utf16le'))
  ];
  const text = candidates
    .sort((a, b) => getReadableScore(b) - getReadableScore(a))[0]
    .slice(0, 30000);

  return {
    markdown: text,
    text,
    metadata: { parserError },
    parser: 'hwp-binary-fallback'
  };
}

function extractReadableText(value) {
  return Array.from(String(value || '').matchAll(/[가-힣A-Za-z0-9()[\]{}.,:;'"!?/@#%&+\-_=~\s]{2,}/g))
    .map((match) => match[0].replace(/\s+/g, ' ').trim())
    .filter((item) => item.length >= 2)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getReadableScore(value) {
  const text = String(value || '');
  const hangul = (text.match(/[가-힣]/g) || []).length;
  const alphaNumeric = (text.match(/[A-Za-z0-9]/g) || []).length;
  return hangul * 3 + alphaNumeric;
}

function normalizeKordocResult(result, parser) {
  if (Array.isArray(result)) {
    return normalizeKordocResult(result[0] || {}, parser);
  }

  const normalized = result && typeof result === 'object' ? result : {};
  const markdown = normalized.markdown || normalized.content || normalized.text || normalized.output || '';

  return {
    markdown,
    text: normalized.text || markdown,
    metadata: normalized.metadata || normalized.meta || {},
    parser
  };
}

async function parsePdfWithPdfjs(filePath, kordocError) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(filePath));
  const loadingTask = pdfjs.getDocument({
    data,
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false
  });
  const pdf = await loadingTask.promise;
  const pages = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textContent.items.map((item) => item.str || '').join(' ').trim();

      if (text) {
        pages.push(`## Page ${pageNumber}\n\n${text}`);
      }
    }
  } finally {
    if (typeof pdf.destroy === 'function') {
      await pdf.destroy();
    }
  }

  return {
    markdown: pages.join('\n\n'),
    text: pages.join('\n\n'),
    metadata: {
      kordocError
    },
    parser: 'pdfjs-fallback'
  };
}

function normalizeTextResult(value, parser) {
  return {
    markdown: String(value || ''),
    text: String(value || ''),
    metadata: {},
    parser
  };
}

module.exports = {
  parseOfficialFile,
  startKordocWorkerServer
};
