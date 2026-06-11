const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..', '..');
const dataDir = path.join(projectRoot, 'data');
const settingsPath = path.join(dataDir, 'runtime-settings.json');

function readRuntimeSettings() {
  try {
    if (!fs.existsSync(settingsPath)) {
      return {};
    }

    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (error) {
    return {};
  }
}

function writeRuntimeSettings(settings) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(settingsPath, JSON.stringify(sanitizeSettings(settings), null, 2));
}

function sanitizeSettings(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};

  return {
    openaiKey: String(source.openaiKey || '').trim(),
    openaiModel: String(source.openaiModel || 'gpt-4o-mini').trim() || 'gpt-4o-mini',
    gmailClientId: String(source.gmailClientId || '').trim(),
    gmailClientSecret: String(source.gmailClientSecret || '').trim(),
    gmailRefreshToken: String(source.gmailRefreshToken || '').trim(),
    gmailFromEmail: String(source.gmailFromEmail || '').trim(),
    gmailSenderName: String(source.gmailSenderName || '').trim()
  };
}

function getRuntimeConfig() {
  const settings = readRuntimeSettings();

  return {
    openaiKey: settings.openaiKey || process.env.OPENAI || process.env.OPENAI_API_KEY || '',
    openaiModel: settings.openaiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    gmailClientId: settings.gmailClientId || process.env.GMAIL_CLIENT_ID || '',
    gmailClientSecret: settings.gmailClientSecret || process.env.GMAIL_CLIENT_SECRET || '',
    gmailRefreshToken: settings.gmailRefreshToken || process.env.GMAIL_REFRESH_TOKEN || '',
    gmailFromEmail: settings.gmailFromEmail || process.env.GMAIL_FROM_EMAIL || '',
    gmailSenderName: settings.gmailSenderName || process.env.GMAIL_SENDER_NAME || ''
  };
}

function getPublicRuntimeStatus() {
  const config = getRuntimeConfig();

  return {
    openaiConfigured: Boolean(config.openaiKey),
    gmailConfigured: Boolean(config.gmailClientId && config.gmailClientSecret && config.gmailRefreshToken),
    openaiModel: config.openaiModel,
    gmailFromEmail: config.gmailFromEmail,
    gmailSenderName: config.gmailSenderName
  };
}

function getMcpEnv() {
  const config = getRuntimeConfig();

  return {
    ...process.env,
    OPENAI: config.openaiKey,
    OPENAI_API_KEY: config.openaiKey,
    OPENAI_MODEL: config.openaiModel,
    GMAIL_CLIENT_ID: config.gmailClientId,
    GMAIL_CLIENT_SECRET: config.gmailClientSecret,
    GMAIL_REFRESH_TOKEN: config.gmailRefreshToken,
    GMAIL_FROM_EMAIL: config.gmailFromEmail,
    GMAIL_SENDER_NAME: config.gmailSenderName
  };
}

module.exports = {
  getMcpEnv,
  getPublicRuntimeStatus,
  getRuntimeConfig,
  readRuntimeSettings,
  writeRuntimeSettings
};
