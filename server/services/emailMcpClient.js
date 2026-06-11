const path = require('path');
const { getMcpEnv } = require('./runtimeConfig');

const projectRoot = path.join(__dirname, '..', '..');
const gmailMcpServerPath = path.join(projectRoot, 'server', 'mcp', 'gmailReminderMcpServer.js');

async function callEmailTool(name, args) {
  if (process.pkg) {
    return callEmailToolDirect(name, args);
  }

  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
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

async function callEmailToolDirect(name, args) {
  const env = getMcpEnv();
  const previousEnv = {
    GMAIL_CLIENT_ID: process.env.GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET: process.env.GMAIL_CLIENT_SECRET,
    GMAIL_REFRESH_TOKEN: process.env.GMAIL_REFRESH_TOKEN,
    GMAIL_FROM_EMAIL: process.env.GMAIL_FROM_EMAIL,
    GMAIL_SENDER_NAME: process.env.GMAIL_SENDER_NAME
  };

  Object.entries(env).forEach(([key, value]) => {
    process.env[key] = value;
  });

  try {
    const { callGmailToolDirect } = require('../mcp/gmailReminderMcpServer');
    return callGmailToolDirect(name, args || {});
  } finally {
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
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
