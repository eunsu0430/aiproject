const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const {
  readDocuments,
  getDocumentById,
  searchDocuments,
  listDueSoon,
  listOverdue,
  getDocumentStats
} = require('./documentTools');

const server = new McpServer({
  name: 'official-document-manager',
  version: '1.0.0'
});

server.tool('list_documents', '최근 공문 목록을 반환합니다.', {}, async () => {
  return toText(readDocuments().slice(-20).reverse());
});

server.tool('get_document', 'id로 공문 상세를 반환합니다.', {
  id: z.union([z.string(), z.number()])
}, async ({ id }) => {
  return toText(getDocumentById(id));
});

server.tool('search_documents', '제목, 내용, 담당부서, 발신기관, 분석 결과에서 공문을 검색합니다.', {
  query: z.string()
}, async ({ query }) => {
  return toText(searchDocuments(query));
});

server.tool('list_due_soon', '기본 3일 이내 마감 공문을 반환합니다.', {
  days: z.number().optional()
}, async ({ days }) => {
  return toText(listDueSoon(days || 3));
});

server.tool('list_overdue', '기한이 지난 진행중 공문을 반환합니다.', {}, async () => {
  return toText(listOverdue());
});

server.tool('get_document_stats', '공문 통계 정보를 반환합니다.', {}, async () => {
  return toText(getDocumentStats());
});

function toText(data) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2)
      }
    ]
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
