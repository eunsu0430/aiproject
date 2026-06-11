const loginForm = document.getElementById('loginForm');
const loginMessage = document.getElementById('loginMessage');
const uploadForm = document.getElementById('uploadForm');
const uploadMessage = document.getElementById('uploadMessage');
const documentList = document.getElementById('documentList');
const deadlineAlert = document.getElementById('deadlineAlert');
const documentDetail = document.getElementById('documentDetail');
const calendar = document.getElementById('calendar');
const calendarTitle = document.getElementById('calendarTitle');
const prevMonthButton = document.getElementById('prevMonthButton');
const nextMonthButton = document.getElementById('nextMonthButton');
const logoutButton = document.getElementById('logoutButton');

let currentCalendarDate = new Date();
let alertShownThisLoad = false;

async function loadDocuments() {
  if (!documentList) return;

  const response = await fetch('/api/documents');
  const documents = response.ok ? await response.json() : [];

  renderSummary(documents);
  renderDeadlineAlert(documents);
  renderCalendar(documents);
  renderDocumentRows(documents);
  showUrgentLoginAlert(documents);
}

function renderDocumentRows(documents) {
  documentList.innerHTML = documents.map((item) => `
    <tr class="${getRowClass(item)}" data-document-id="${escapeHtml(item.id)}">
      <td>${escapeHtml(item.title || '-')}</td>
      <td>${escapeHtml(item.sender || '-')}</td>
      <td>${escapeHtml(item.department || '-')}</td>
      <td>${escapeHtml(item.dueDate || item.deadline || '-')}</td>
      <td>${escapeHtml(item.status || '-')}</td>
      <td>${renderImportanceBadge(item.analysis && item.analysis.importance)}</td>
      <td>${escapeHtml(formatDate(item.createdAt))}</td>
      <td>
        ${item.status === '완료' ? '' : `<button class="complete-button" type="button" data-complete-id="${escapeHtml(item.id)}">완료</button>`}
        <button class="delete-button" type="button" data-delete-id="${escapeHtml(item.id)}">삭제</button>
      </td>
    </tr>
  `).join('');

  documentList.querySelectorAll('tr').forEach((row) => {
    row.addEventListener('click', () => {
      const selectedDocument = documents.find((item) => String(item.id) === row.dataset.documentId);
      renderDocumentDetail(selectedDocument);
    });
  });

  documentList.querySelectorAll('[data-delete-id]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      await deleteDocument(button.dataset.deleteId);
    });
  });

  documentList.querySelectorAll('[data-complete-id]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      await completeDocument(button.dataset.completeId);
    });
  });
}

function renderSummary(documents) {
  setText('totalCount', documents.length);
  setText('urgentDueCount', getUrgentDocuments(documents).length);
  setText('overdueCount', getOverdueDocuments(documents).length);
  setText('emergencyCount', documents.filter((item) => item.analysis && item.analysis.importance === '긴급').length);
}

function renderDeadlineAlert(documents) {
  if (!deadlineAlert) return;

  const urgent = getUrgentDocuments(documents);
  const overdue = getOverdueDocuments(documents);
  const alertDocuments = [...overdue, ...urgent.filter((item) => !overdue.some((overdueItem) => overdueItem.id === item.id))];

  if (alertDocuments.length === 0) {
    deadlineAlert.hidden = true;
    deadlineAlert.innerHTML = '';
    return;
  }

  deadlineAlert.hidden = false;
  deadlineAlert.innerHTML = `
    <h2>급한 공문</h2>
    <ul>
      ${alertDocuments.slice(0, 6).map((item) => {
        const dueDate = item.dueDate || item.deadline;
        const diffDays = getDueDateDiffDays(dueDate);
        const label = diffDays < 0 ? `기한 ${Math.abs(diffDays)}일 초과` : diffDays === 0 ? '오늘 마감' : `${diffDays}일 남음`;
        return `<li><strong>${escapeHtml(item.title || '-')}</strong><span>${escapeHtml(dueDate)} · ${label}</span></li>`;
      }).join('')}
    </ul>
  `;
}

function showUrgentLoginAlert(documents) {
  if (alertShownThisLoad) return;

  const urgent = getUrgentDocuments(documents);
  const overdue = getOverdueDocuments(documents);

  if (urgent.length === 0 && overdue.length === 0) return;

  alertShownThisLoad = true;
  const lines = [
    overdue.length > 0 ? `기한 초과 ${overdue.length}건` : '',
    urgent.length > 0 ? `3일 이내 마감 ${urgent.length}건` : ''
  ].filter(Boolean);

  alert(`급한 공문이 있습니다.\n${lines.join('\n')}`);
}

function renderCalendar(documents) {
  if (!calendar || !calendarTitle) return;

  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startDate = new Date(year, month, 1 - firstDay.getDay());
  const todayKey = toDateKey(new Date());

  calendarTitle.textContent = `${year}년 ${month + 1}월 마감 캘린더`;
  calendar.innerHTML = '';

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);

    const dateKey = toDateKey(date);
    const dayDocuments = documents.filter((item) => (item.dueDate || item.deadline) === dateKey);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = [
      'calendar-day',
      date.getMonth() !== month ? 'is-other-month' : '',
      dateKey === todayKey ? 'is-today' : '',
      dayDocuments.some((item) => getDueDateDiffDays(item.dueDate || item.deadline) < 0 && item.status !== '완료') ? 'has-overdue' : '',
      dayDocuments.some((item) => {
        const diff = getDueDateDiffDays(item.dueDate || item.deadline);
        return diff >= 0 && diff <= 3 && item.status !== '완료';
      }) ? 'has-urgent' : ''
    ].filter(Boolean).join(' ');

    cell.innerHTML = `
      <span class="day-number">${date.getDate()}</span>
      <span class="day-items">
        ${dayDocuments.slice(0, 3).map((item) => `<span>${escapeHtml(item.title || '-')}</span>`).join('')}
        ${dayDocuments.length > 3 ? `<em>+${dayDocuments.length - 3}</em>` : ''}
      </span>
    `;

    if (dayDocuments.length > 0) {
      cell.addEventListener('click', () => renderDocumentDetail(dayDocuments[0]));
    }

    calendar.appendChild(cell);
  }
}

async function deleteDocument(id) {
  if (!confirm('이 공문을 삭제하시겠습니까?')) return;

  const response = await fetch(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) {
    alert('공문 삭제에 실패했습니다.');
    return;
  }

  resetDetail();
  await loadDocuments();
}

async function completeDocument(id) {
  const response = await fetch(`/api/documents/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: '완료' })
  });

  if (!response.ok) {
    alert('완료 처리에 실패했습니다.');
    return;
  }

  resetDetail();
  await loadDocuments();
}

function renderDocumentDetail(item) {
  if (!documentDetail || !item) return;

  const analysis = item.analysis || {};
  documentDetail.innerHTML = `
    <h2>${escapeHtml(item.title || '공문 상세')}</h2>
    <dl class="detail-list">
      <dt>발신기관</dt><dd>${escapeHtml(item.sender || '-')}</dd>
      <dt>담당부서</dt><dd>${escapeHtml(item.department || formatList(analysis.departments))}</dd>
      <dt>제출기한</dt><dd>${escapeHtml(item.dueDate || item.deadline || '-')}</dd>
      <dt>상태</dt><dd>${escapeHtml(item.status || '-')}</dd>
      <dt>파일 정보</dt><dd>${escapeHtml(formatFileInfo(item.fileInfo))}</dd>
      <dt>비고</dt><dd>${escapeHtml(item.note || '-')}</dd>
      <dt>내용</dt><dd>${escapeHtml(item.content || item.parsedContent || '-')}</dd>
    </dl>
    <h3>최종 분석 결과</h3>
    <dl class="detail-list">
      <dt>요약</dt><dd>${escapeHtml(analysis.summary || '-')}</dd>
      <dt>중요도</dt><dd>${renderImportanceBadge(analysis.importance)}</dd>
      <dt>판단 이유</dt><dd>${escapeHtml(formatList(analysis.importanceReason))}</dd>
      <dt>필요 조치</dt><dd>${escapeHtml(formatList(analysis.requiredActions))}</dd>
      <dt>분석 모드</dt><dd>${escapeHtml(analysis.aiMode || '-')}</dd>
    </dl>
    <h3>1차 AI 평가</h3>
    ${renderAiEvaluation(analysis.aiEvaluation)}
    <h3>2차 페르소나 평가</h3>
    ${renderPersonaEvaluation(analysis.personaEvaluation)}
    <h3>대표 평가자</h3>
    ${renderPersonaPanel(analysis.personaPanel)}
  `;
}

function renderAiEvaluation(evaluation) {
  if (!evaluation) return '<p class="empty-detail">1차 AI 평가 결과가 없습니다.</p>';

  return `
    <dl class="detail-list">
      <dt>AI 중요도</dt><dd>${renderImportanceBadge(evaluation.importance)}</dd>
      <dt>AI 모드</dt><dd>${escapeHtml(evaluation.aiMode || '-')}</dd>
      <dt>AI 요약</dt><dd>${escapeHtml(evaluation.summary || '-')}</dd>
      <dt>AI 판단</dt><dd>${escapeHtml(formatList(evaluation.importanceReason))}</dd>
    </dl>
  `;
}

function renderPersonaEvaluation(evaluation) {
  if (!evaluation) return '<p class="empty-detail">페르소나 평가 요약이 없습니다.</p>';

  const distribution = evaluation.riskDistribution || {};

  return `
    <div class="persona-evaluation">
      <div><span>전체</span><strong>${escapeHtml(evaluation.totalPersonas || 0)}</strong></div>
      <div><span>평가</span><strong>${escapeHtml(evaluation.evaluatedPersonas || 0)}</strong></div>
      <div><span>대표</span><strong>${escapeHtml(evaluation.selectedPanelCount || 0)}</strong></div>
      <div><span>평균</span><strong>${escapeHtml(evaluation.averageScore || 0)}</strong></div>
      <div><span>최고</span><strong>${escapeHtml(evaluation.maxScore || 0)}</strong></div>
    </div>
    <dl class="detail-list compact-detail">
      <dt>위험 분포</dt><dd>${escapeHtml(formatRiskDistribution(distribution))}</dd>
      <dt>관련 부서</dt><dd>${escapeHtml(formatList(evaluation.matchedDepartments))}</dd>
      <dt>관련 역할</dt><dd>${escapeHtml(formatList(evaluation.matchedRoles))}</dd>
    </dl>
  `;
}

function renderPersonaPanel(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<p class="empty-detail">대표 평가자가 없습니다.</p>';
  }

  return `<div class="persona-panel-list">
    ${items.map((item) => `
      <article class="persona-panel-item">
        <header>
          <strong>${escapeHtml(item.name || '-')}</strong>
          ${renderImportanceBadge(item.riskLevel)}
        </header>
        <dl class="detail-list compact-detail">
          <dt>역할</dt><dd>${escapeHtml(item.role || '-')}</dd>
          <dt>부서</dt><dd>${escapeHtml(item.department || '-')}</dd>
          <dt>점수</dt><dd>${escapeHtml(item.score || 0)}</dd>
          <dt>키워드</dt><dd>${escapeHtml(formatList(item.matchedKeywords))}</dd>
          <dt>의견</dt><dd>${escapeHtml(item.comment || '-')}</dd>
          <dt>출처</dt><dd>${escapeHtml(item.sourceFile || '-')}</dd>
        </dl>
      </article>
    `).join('')}
  </div>`;
}

function resetDetail() {
  if (documentDetail) {
    documentDetail.innerHTML = '<h2>공문 상세</h2><p class="empty-detail">목록이나 캘린더에서 공문을 선택하면 분석 결과를 확인할 수 있습니다.</p>';
  }
}

function getUrgentDocuments(documents) {
  return documents.filter((item) => {
    const dueDate = item.dueDate || item.deadline;
    const diffDays = dueDate ? getDueDateDiffDays(dueDate) : 99;
    return item.status !== '완료' && diffDays >= 0 && diffDays <= 3;
  });
}

function getOverdueDocuments(documents) {
  return documents.filter((item) => {
    const dueDate = item.dueDate || item.deadline;
    return item.status !== '완료' && dueDate && getDueDateDiffDays(dueDate) < 0;
  });
}

function getDueDateClass(dueDate, status) {
  if (!dueDate || status === '완료') return '';

  const diffDays = getDueDateDiffDays(dueDate);
  if (diffDays < 0) return 'is-overdue';
  if (diffDays <= 3) return 'is-urgent';
  return '';
}

function getRowClass(item) {
  const classes = [getDueDateClass(item.dueDate || item.deadline, item.status)];
  const importance = item.analysis && item.analysis.importance;

  if (importance === '긴급') classes.push('is-emergency');
  else if (importance === '높음') classes.push('is-high');

  return classes.filter(Boolean).join(' ');
}

function renderImportanceBadge(importance) {
  const value = importance || '보통';
  return `<span class="importance-badge importance-${escapeClass(value)}">${escapeHtml(value)}</span>`;
}

function formatList(items) {
  return Array.isArray(items) && items.length > 0 ? items.join(', ') : '-';
}

function formatRiskDistribution(distribution) {
  return ['낮음', '보통', '높음', '긴급']
    .map((level) => `${level} ${distribution[level] || 0}명`)
    .join(', ');
}

function formatFileInfo(fileInfo) {
  if (!fileInfo) return '-';
  const parser = fileInfo.parser ? `, ${fileInfo.parser}` : '';
  return `${fileInfo.originalName || '-'} (${fileInfo.size || 0} bytes${parser})`;
}

function getDueDateDiffDays(dueDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);

  if (Number.isNaN(due.getTime())) return 99;
  return Math.ceil((due - today) / (1000 * 60 * 60 * 24));
}

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDate(value) {
  return value ? String(value).slice(0, 10) : '-';
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeClass(value) {
  return String(value).replace(/[^\w가-힣-]/g, '');
}

if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const id = document.getElementById('userId').value;
    const password = document.getElementById('password').value;

    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, password })
    });

    if (!response.ok) {
      loginMessage.textContent = 'ID 또는 PW가 올바르지 않습니다.';
      return;
    }

    const user = await response.json();
    localStorage.setItem('user', JSON.stringify(user));
    window.location.href = '/dashboard.html';
  });
}

if (documentList) {
  const user = localStorage.getItem('user');
  if (!user) window.location.href = '/';
  else loadDocuments();
}

if (uploadForm) {
  uploadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = uploadForm.querySelector('button[type="submit"]');
    if (submitButton && submitButton.disabled) return;

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = '처리 중';
    }

    uploadMessage.textContent = '공문을 파싱하고 분석하는 중입니다.';

    try {
      const response = await fetch('/api/documents/upload', {
        method: 'POST',
        body: new FormData(uploadForm)
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({ message: '파일 업로드에 실패했습니다.' }));
        uploadMessage.textContent = result.message || '파일 업로드에 실패했습니다.';
        return;
      }

      uploadForm.reset();
      uploadMessage.textContent = '공문을 등록했습니다.';
      resetDetail();
      await loadDocuments();
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = '등록';
      }
    }
  });
}

if (prevMonthButton) {
  prevMonthButton.addEventListener('click', async () => {
    currentCalendarDate = new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth() - 1, 1);
    await loadDocuments();
  });
}

if (nextMonthButton) {
  nextMonthButton.addEventListener('click', async () => {
    currentCalendarDate = new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth() + 1, 1);
    await loadDocuments();
  });
}

if (logoutButton) {
  logoutButton.addEventListener('click', () => {
    localStorage.removeItem('user');
    window.location.href = '/';
  });
}
