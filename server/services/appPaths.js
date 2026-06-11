const os = require('os');
const path = require('path');

const appName = 'OfficialDocumentManager';
const appRoot = path.join(__dirname, '..', '..');

function getUserDataRoot() {
  if (process.env.OFFICIAL_DOCUMENT_MANAGER_HOME) {
    return path.resolve(process.env.OFFICIAL_DOCUMENT_MANAGER_HOME);
  }

  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || os.homedir(), appName);
  }

  return path.join(os.homedir(), '.official-document-manager');
}

const userDataRoot = getUserDataRoot();

module.exports = {
  appRoot,
  dataDir: path.join(userDataRoot, 'data'),
  publicDir: path.join(appRoot, 'public'),
  uploadDir: path.join(userDataRoot, 'uploads'),
  userDataRoot
};
