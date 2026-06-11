const fs = require('fs');
const path = require('path');

const documentsPath = path.join(__dirname, '..', '..', 'data', 'documents.json');

function readDocuments() {
  try {
    if (!fs.existsSync(documentsPath)) {
      return [];
    }

    const content = fs.readFileSync(documentsPath, 'utf8').trim();
    const parsed = content ? JSON.parse(content) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function getDocumentById(id) {
  return readDocuments().find((document) => String(document.id) === String(id)) || null;
}

function searchDocuments(query) {
  const keyword = String(query || '').toLowerCase();

  if (!keyword) {
    return [];
  }

  return readDocuments().filter((document) => {
    const analysis = document.analysis || {};
    const haystack = [
      document.title,
      document.content,
      document.department,
      document.sender,
      analysis.summary,
      Array.isArray(analysis.importanceReason) ? analysis.importanceReason.join(' ') : ''
    ].filter(Boolean).join(' ').toLowerCase();

    return haystack.includes(keyword);
  });
}

function listDueSoon(days = 3) {
  const limit = Number(days) || 3;

  return readDocuments().filter((document) => {
    const dueDate = document.dueDate || document.deadline;

    if (!dueDate || document.status === '완료') {
      return false;
    }

    const diffDays = getDueDateDiffDays(dueDate);
    return diffDays >= 0 && diffDays <= limit;
  });
}

function listOverdue() {
  return readDocuments().filter((document) => {
    const dueDate = document.dueDate || document.deadline;
    return document.status !== '완료' && dueDate && getDueDateDiffDays(dueDate) < 0;
  });
}

function getDocumentStats() {
  const documents = readDocuments();

  return {
    total: documents.length,
    inProgress: documents.filter((document) => document.status !== '완료').length,
    completed: documents.filter((document) => document.status === '완료').length,
    dueSoon: listDueSoon(3).length,
    overdue: listOverdue().length,
    emergency: documents.filter((document) => document.analysis && document.analysis.importance === '긴급').length
  };
}

function getDueDateDiffDays(dueDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);

  if (Number.isNaN(due.getTime())) {
    return 99;
  }

  return Math.ceil((due - today) / (1000 * 60 * 60 * 24));
}

module.exports = {
  readDocuments,
  getDocumentById,
  searchDocuments,
  listDueSoon,
  listOverdue,
  getDocumentStats
};
