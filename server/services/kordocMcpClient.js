const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');
const zlib = require('zlib');
const { appRoot, userDataRoot } = require('./appPaths');

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

  const kordocError = formatError(jsonResult.error);
  console.warn(`[kordoc:api] ${kordocError}`);

  const markdownResult = await runKordoc(absolutePath, 'markdown').catch(async (error) => {
    return parseWithBuiltInFallback(absolutePath, `kordoc failed: ${kordocError}; markdown fallback failed: ${formatError(error)}`);
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
    return parsePdfWithPdfjs(filePath, parserError)
      .catch(() => parsePdfRawTextFallback(filePath, parserError));
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
  const kordoc = await loadKordoc().catch((error) => {
    throw new Error(`loadKordoc failed: ${formatError(error)}`);
  });
  const buffer = fs.readFileSync(filePath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const result = await kordoc.parse(arrayBuffer, { filePath }).catch((error) => {
    throw new Error(`kordoc.parse failed: ${formatError(error)}`);
  });

  if (!result || result.success === false) {
    throw new Error(result && result.error ? result.error : 'kordoc parse failed');
  }

  return result;
}

async function loadKordoc() {
  if (!process.pkg) {
    return import('kordoc');
  }

  const kordocDist = process.pkg
    ? path.join(appRoot, 'node_modules', 'kordoc', 'dist')
    : path.dirname(require.resolve('kordoc'));
  const kordocVersion = readPackageVersion(path.join(kordocDist, '..', 'package.json'));
  const cacheRoot = path.join(userDataRoot, 'runtime-cache', 'kordoc');
  const cacheDist = path.join(cacheRoot, 'dist');
  const cacheEntry = path.join(cacheDist, 'index.js');
  const cacheVersion = `kordoc:${kordocVersion};pdfjs:${getPdfjsVersion()};deps:10`;

  if (!fs.existsSync(cacheEntry) || readCacheVersion(cacheRoot) !== cacheVersion) {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
    fs.mkdirSync(cacheRoot, { recursive: true });
    copyDirectory(kordocDist, cacheDist);
    copyKordocRuntimeDependencies(cacheRoot);
    patchCachedKordocDist(cacheDist);
    fs.writeFileSync(path.join(cacheRoot, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));
    writeCacheVersion(cacheRoot, cacheVersion);
  }

  return import(pathToFileURL(cacheEntry).href);
}

function copyDirectory(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });

  fs.readdirSync(sourceDir, { withFileTypes: true }).forEach((entry) => {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      return;
    }

    fs.copyFileSync(sourcePath, targetPath);
  });
}

function copyKordocRuntimeDependencies(cacheRoot) {
  const copied = new Set();
  [
    '@xmldom/xmldom',
    'cfb',
    'commander',
    'jszip',
    'markdown-it',
    'pdfjs-dist',
    'zod'
  ].forEach((name) => copyPackageForKordoc(cacheRoot, name, copied));

  writeOptionalModuleStub(path.join(cacheRoot, 'node_modules', '@napi-rs', 'canvas'));
  writeOptionalModuleStub(path.join(cacheRoot, 'node_modules', 'canvas'));
}

function patchCachedKordocDist(cacheDist) {
  const cacheRoot = path.dirname(cacheDist);
  const pdfjsPath = path.join(cacheDist, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs');
  const pdfjsWorkerPath = path.join(cacheDist, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs');
  const importSpecifiers = {
    '@xmldom/xmldom': packageFileUrl(cacheRoot, '@xmldom/xmldom'),
    jszip: packageFileUrl(cacheRoot, 'jszip'),
    'markdown-it': packageFileUrl(cacheRoot, 'markdown-it')
  };
  const cfbMainPath = packageMainPath(cacheRoot, 'cfb');
  const pdfjsSpecifier = pathToFileURL(pdfjsPath).href;
  const pdfjsWorkerSpecifier = pathToFileURL(pdfjsWorkerPath).href;

  fs.readdirSync(cacheDist)
    .filter((name) => name.endsWith('.js'))
    .forEach((name) => {
      const pdfParserPath = path.join(cacheDist, name);
      const source = fs.readFileSync(pdfParserPath, 'utf8');
      let patched = source.replaceAll(
        'require2("cfb")',
        cfbMainPath ? `require2(${JSON.stringify(cfbMainPath)})` : 'require2("cfb")'
      );

      Object.entries(importSpecifiers).forEach(([packageName, specifier]) => {
        if (specifier) {
          patched = patched.replaceAll(`"${packageName}"`, `"${specifier}"`);
        }
      });

      patched = patched.replaceAll(
        '"pdfjs-dist/legacy/build/',
        '"../node_modules/pdfjs-dist/legacy/build/'
      )
        .replaceAll(
          '"../node_modules/pdfjs-dist/legacy/build/pdf.mjs"',
          `"${pdfjsSpecifier}"`
        )
        .replace(
          'import * as pdfjsWorker from "../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs";',
          'const pdfjsWorker = {};'
        )
        .replace(
          'GlobalWorkerOptions.workerSrc = "";',
          `GlobalWorkerOptions.workerSrc = "${pdfjsWorkerSpecifier}";`
        )
        .replace(
          'data: new Uint8Array(buffer),\n    useSystemFonts: true,',
          'data: new Uint8Array(buffer),\n    disableWorker: true,\n    useWorkerFetch: false,\n    useSystemFonts: true,'
        );

      if (patched !== source) {
        fs.writeFileSync(pdfParserPath, patched);
      }
    });

  if (!fs.existsSync(pdfjsPath)) {
    return;
  }

  const pdfjsSource = fs.readFileSync(pdfjsPath, 'utf8');
  const pdfjsPatched = pdfjsSource.replaceAll(
    'canvas = require("@napi-rs/canvas");',
    'canvas = {};'
  );

  if (pdfjsPatched !== pdfjsSource) {
    fs.writeFileSync(pdfjsPath, pdfjsPatched);
  }
}

function packageFileUrl(cacheRoot, packageName) {
  const mainPath = packageMainPath(cacheRoot, packageName);
  return mainPath ? pathToFileURL(mainPath).href : '';
}

function packageMainPath(cacheRoot, packageName) {
  const packageRoot = path.join(cacheRoot, 'node_modules', packageName);
  const packageJsonPath = path.join(packageRoot, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return '';
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const entry = typeof pkg.main === 'string'
      ? pkg.main
      : typeof pkg.module === 'string'
        ? pkg.module
        : 'index.js';
    const entryPath = path.join(packageRoot, entry);

    if (fs.existsSync(entryPath)) {
      return entryPath;
    }

    if (!path.extname(entryPath) && fs.existsSync(`${entryPath}.js`)) {
      return `${entryPath}.js`;
    }

    return entryPath;
  } catch (error) {
    return path.join(packageRoot, 'index.js');
  }
}

function copyPackageForKordoc(cacheRoot, packageName, copied) {
  if (copied.has(packageName)) {
    return;
  }

  const sourceRoot = getPackageRoot(packageName);
  if (!sourceRoot || !fs.existsSync(sourceRoot)) {
    return;
  }

  copied.add(packageName);
  copyDirectory(sourceRoot, path.join(cacheRoot, 'node_modules', packageName));

  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'));
    Object.keys(pkg.dependencies || {}).forEach((dependency) => copyPackageForKordoc(cacheRoot, dependency, copied));
  } catch (error) {
    // Package metadata is optional for the cache copy.
  }
}

function getPackageRoot(packageName) {
  if (process.pkg) {
    return path.join(appRoot, 'node_modules', packageName);
  }

  try {
    let current = path.dirname(require.resolve(packageName));

    while (current && current !== path.dirname(current)) {
      if (fs.existsSync(path.join(current, 'package.json'))) {
        return current;
      }
      current = path.dirname(current);
    }
  } catch (error) {
    return '';
  }

  return '';
}

function writeOptionalModuleStub(moduleRoot) {
  fs.mkdirSync(moduleRoot, { recursive: true });
  fs.writeFileSync(path.join(moduleRoot, 'package.json'), JSON.stringify({
    name: path.basename(moduleRoot),
    main: 'index.js'
  }, null, 2));
  fs.writeFileSync(path.join(moduleRoot, 'index.js'), 'module.exports = {};\n');
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
  const pdfjs = await loadPdfjs();
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
      parserError: kordocError,
      kordocError
    },
    parser: 'pdfjs-fallback'
  };
}

function formatError(error) {
  if (!error) {
    return 'Unknown error';
  }

  if (error.stack) {
    return error.stack;
  }

  return error.message || String(error);
}

function parsePdfRawTextFallback(filePath, parserError) {
  const buffer = fs.readFileSync(filePath);
  const chunks = extractPdfTextChunks(buffer);
  const text = chunks
    .map((chunk) => normalizePdfText(chunk))
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    markdown: text,
    text,
    metadata: { parserError },
    parser: 'pdf-raw-fallback'
  };
}

function extractPdfTextChunks(buffer) {
  const chunks = [];
  const source = buffer.toString('latin1');
  const streamPattern = /<<(?:.|\r|\n)*?>>\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/g;
  let match;

  while ((match = streamPattern.exec(source)) !== null) {
    const dictionary = match[0].slice(0, match[0].indexOf('stream'));
    const streamBuffer = Buffer.from(match[1], 'latin1');
    const decoded = decodePdfStream(streamBuffer, dictionary);
    chunks.push(...extractPdfTextOperators(decoded));
  }

  chunks.push(...extractPdfTextOperators(source));
  return chunks;
}

function decodePdfStream(streamBuffer, dictionary) {
  const filters = String(dictionary || '');

  if (/\/FlateDecode\b/.test(filters)) {
    try {
      return zlib.inflateSync(trimPdfStreamBuffer(streamBuffer)).toString('latin1');
    } catch (error) {
      return streamBuffer.toString('latin1');
    }
  }

  return streamBuffer.toString('latin1');
}

function trimPdfStreamBuffer(buffer) {
  let start = 0;
  let end = buffer.length;

  while (start < end && (buffer[start] === 0x0d || buffer[start] === 0x0a)) start += 1;
  while (end > start && (buffer[end - 1] === 0x0d || buffer[end - 1] === 0x0a)) end -= 1;
  return buffer.subarray(start, end);
}

function extractPdfTextOperators(source) {
  const text = String(source || '');
  const blocks = Array.from(text.matchAll(/BT([\s\S]*?)ET/g)).map((match) => match[1]);
  const targets = blocks.length > 0 ? blocks : [text];
  const chunks = [];

  targets.forEach((block) => {
    Array.from(block.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj/g)).forEach((match) => {
      chunks.push(decodePdfLiteral(match[0].replace(/\s*Tj$/, '')));
    });

    Array.from(block.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)).forEach((match) => {
      chunks.push(decodePdfHex(match[1]));
    });

    Array.from(block.matchAll(/\[((?:.|\r|\n)*?)\]\s*TJ/g)).forEach((match) => {
      const arrayContent = match[1];
      Array.from(arrayContent.matchAll(/\((?:\\.|[^\\)])*\)|<([0-9A-Fa-f\s]+)>/g)).forEach((item) => {
        const value = item[0].startsWith('<')
          ? decodePdfHex(item[1])
          : decodePdfLiteral(item[0]);
        chunks.push(value);
      });
      chunks.push('\n');
    });
  });

  return chunks;
}

function decodePdfLiteral(value) {
  const inner = String(value || '').replace(/^\(/, '').replace(/\)$/, '');
  const bytes = [];

  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];

    if (char === '\\') {
      const next = inner[index + 1];
      if (/[0-7]/.test(next || '')) {
        const octal = inner.slice(index + 1).match(/^[0-7]{1,3}/)[0];
        bytes.push(parseInt(octal, 8));
        index += octal.length;
        continue;
      }

      const escaped = { n: 10, r: 13, t: 9, b: 8, f: 12, '\\': 92, '(': 40, ')': 41 }[next];
      if (escaped !== undefined) {
        bytes.push(escaped);
        index += 1;
        continue;
      }
    }

    bytes.push(char.charCodeAt(0) & 0xff);
  }

  return decodePdfBytes(Buffer.from(bytes));
}

function decodePdfHex(value) {
  const clean = String(value || '').replace(/\s+/g, '');
  const even = clean.length % 2 === 0 ? clean : `${clean}0`;
  return decodePdfBytes(Buffer.from(even, 'hex'));
}

function decodePdfBytes(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return decodeUtf16Be(buffer.subarray(2));
  }

  if (buffer.includes(0x00)) {
    return decodeUtf16Be(buffer);
  }

  return buffer.toString('utf8');
}

function decodeUtf16Be(buffer) {
  const evenLength = buffer.length - (buffer.length % 2);
  return Buffer.from(buffer.subarray(0, evenLength)).swap16().toString('utf16le');
}

function normalizePdfText(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .trim();
}

async function loadPdfjs() {
  if (!process.pkg) {
    return import('pdfjs-dist/legacy/build/pdf.mjs');
  }

  const cacheVersion = `pdfjs:${getPdfjsVersion()}`;
  const sourcePath = getPdfjsEntryPath();
  const cacheRoot = path.join(userDataRoot, 'runtime-cache', 'pdfjs-dist');
  const cacheDir = path.join(cacheRoot, 'legacy', 'build');
  const cachePath = path.join(cacheDir, 'pdf.mjs');

  if (!fs.existsSync(cachePath) || readCacheVersion(cacheRoot) !== cacheVersion) {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.copyFileSync(sourcePath, cachePath);
    writeCacheVersion(cacheRoot, cacheVersion);
  }

  return import(pathToFileURL(cachePath).href);
}

function getPdfjsVersion() {
  const pdfjsMain = getPdfjsEntryPath();
  return readPackageVersion(path.join(pdfjsMain, '..', '..', '..', 'package.json'));
}

function getPdfjsEntryPath() {
  return process.pkg
    ? path.join(appRoot, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs')
    : require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
}

function readPackageVersion(packagePath) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(packagePath), 'utf8')).version || 'unknown';
  } catch (error) {
    return 'unknown';
  }
}

function readCacheVersion(cacheRoot) {
  try {
    return fs.readFileSync(path.join(cacheRoot, '.version'), 'utf8').trim();
  } catch (error) {
    return '';
  }
}

function writeCacheVersion(cacheRoot, version) {
  fs.mkdirSync(cacheRoot, { recursive: true });
  fs.writeFileSync(path.join(cacheRoot, '.version'), version);
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
