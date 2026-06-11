const fs = require('fs');
const path = require('path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { parseOfficialFile } = require('../services/kordocMcpClient');

const server = new McpServer({
  name: 'kordoc-document-parser',
  version: '1.0.0'
});

server.tool(
  'parse_document',
  'HWP, HWPX, PDF, XLSX, DOCX 문서를 파싱해 Markdown 텍스트를 반환합니다. PDF에서 kordoc가 실패하면 pdfjs fallback을 사용합니다.',
  {
    file_path: z.string().min(1).describe('파싱할 문서의 절대 경로 또는 프로젝트 기준 상대 경로')
  },
  async ({ file_path }) => {
    try {
      const resolvedPath = resolveInputPath(file_path);
      const parsed = await parseOfficialFile(resolvedPath);
      const text = parsed.markdown || parsed.text || '';

      if (!text.trim()) {
        return toText(`파싱 결과가 비어 있습니다: ${resolvedPath}`, true);
      }

      return toText([
        `[parser: ${parsed.parser || 'kordoc'}]`,
        `[file: ${resolvedPath}]`,
        '',
        text
      ].join('\n'));
    } catch (error) {
      return toText(`파싱 실패: ${error.message}`, true);
    }
  }
);

server.tool(
  'parse_metadata',
  '문서를 파싱하고 추출 가능한 메타데이터와 파서 정보를 JSON으로 반환합니다.',
  {
    file_path: z.string().min(1).describe('메타데이터를 확인할 문서의 절대 경로 또는 프로젝트 기준 상대 경로')
  },
  async ({ file_path }) => {
    try {
      const resolvedPath = resolveInputPath(file_path);
      const parsed = await parseOfficialFile(resolvedPath);

      return toText(JSON.stringify({
        filePath: resolvedPath,
        parser: parsed.parser || 'kordoc',
        metadata: parsed.metadata || {},
        textLength: String(parsed.markdown || parsed.text || '').length
      }, null, 2));
    } catch (error) {
      return toText(`메타데이터 추출 실패: ${error.message}`, true);
    }
  }
);

server.tool(
  'detect_format',
  '파일 확장자와 존재 여부를 확인합니다.',
  {
    file_path: z.string().min(1).describe('확인할 문서의 절대 경로 또는 프로젝트 기준 상대 경로')
  },
  async ({ file_path }) => {
    try {
      const resolvedPath = resolveInputPath(file_path);
      const stat = fs.statSync(resolvedPath);

      return toText(JSON.stringify({
        filePath: resolvedPath,
        extension: path.extname(resolvedPath).toLowerCase().replace('.', ''),
        size: stat.size
      }, null, 2));
    } catch (error) {
      return toText(`파일 확인 실패: ${error.message}`, true);
    }
  }
);

function resolveInputPath(filePath) {
  const projectRoot = path.join(__dirname, '..', '..');
  const resolvedPath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(projectRoot, filePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`파일을 찾을 수 없습니다: ${resolvedPath}`);
  }

  const allowedExtensions = new Set(['.pdf', '.hwp', '.hwpx', '.hwpml', '.docx', '.xls', '.xlsx']);
  const extension = path.extname(resolvedPath).toLowerCase();

  if (!allowedExtensions.has(extension)) {
    throw new Error(`지원하지 않는 확장자입니다: ${extension}`);
  }

  return resolvedPath;
}

function toText(text, isError = false) {
  return {
    content: [
      {
        type: 'text',
        text
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
