const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { getMcpEnv } = require('./runtimeConfig');

const projectRoot = path.join(__dirname, '..', '..');
const gmailMcpServerPath = path.join(projectRoot, 'server', 'mcp', 'gmailReminderMcpServer.js');

async function callEmailTool(name, args) {
  const client = new Client({
    name: 'official-document-manager-web',
    version: '1.0.0'
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [gmailMcpServerPath],
    env: getMcpEnv(),
    stderr: 'pipe'
  });

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name,
      arguments: args
    });

    return parseToolResult(result);
  } finally {
    try {
      await client.close();
    } catch (error) {
      // Ignore close errors from short-lived MCP calls.
    }
  }
}

function parseToolResult(result) {
  const text = result && Array.isArray(result.content)
    ? result.content.map((item) => item.text || '').join('\n').trim()
    : '';

  if (result && result.isError) {
    throw new Error(text || 'Email MCP tool failed.');
  }

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(text);
  }
}

module.exports = {
  callEmailTool
};
