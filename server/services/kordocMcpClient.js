const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { appRoot } = require('./appPaths');

const execFileAsync = promisify(execFile);
const projectRoot = appRoot;

async function parseOfficialFile(filePath) {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Upload file not found: ${absolutePath}`);
  }

  const jsonResult = await parseWithKordocApi(absolutePath).catch((error) => ({ error }));

  if (!jsonResult.error) {
    return normalizeKordocResult(jsonResult, 'kordoc-api');
  }

  const markdownResult = await runKordoc(absolutePath, 'markdown').catch(async (error) => {
    if (path.extname(absolutePath).toLowerCase() === '.pdf') {
      return parsePdfWithPdfjs(absolutePath, `${jsonResult.error.message}; ${error.message}`);
    }

    throw new Error(`kordoc failed: ${jsonResult.error.message}; markdown fallback failed: ${error.message}`);
  });

  if (markdownResult && typeof markdownResult === 'object') {
    return markdownResult;
  }

  return normalizeTextResult(markdownResult, 'kordoc-markdown');
}

async function parseWithKordocApi(filePath) {
  const kordoc = require('kordoc');
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
  parseOfficialFile
};
