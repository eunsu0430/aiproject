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
const documentTypeSelect = document.getElementById('documentType');
const outgoingFields = document.getElementById('outgoingFields');

let currentCalendarDate = new Date();
let alertShownThisLoad = false;
let selectedDocumentId = null;

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
    <tr class="${getRowClass(item)} ${String(item.id) === String(selectedDocumentId) ? 'is-selected' : ''}" data-document-id="${escapeHtml(item.id)}">
      <td>${escapeHtml(item.title || '-')}</td>
      <td>${renderDocumentTypeBadge(item)}</td>
      <td>${escapeHtml(item.sender || '-')}</td>
      <td>${escapeHtml(item.department || '-')}</td>
      <td>${escapeHtml(getCalendarDate(item) || '-')}</td>
      <td>${escapeHtml(formatRecipientProgress(item))}</td>
      <td>${escapeHtml(item.status || '-')}</td>
      <td>${getDocumentType(item) === 'outgoing' ? '-' : renderImportanceBadge(item.analysis && item.analysis.importance)}</td>
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
      if (String(selectedDocumentId) === String(row.dataset.documentId)) {
        resetDetail();
        renderDocumentRows(documents);
        return;
      }

      renderDocumentDetail(selectedDocument);
      renderDocumentRows(documents);
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
  setText('emergencyCount', documents.filter((item) => getDocumentType(item) === 'incoming' && item.analysis && item.analysis.importance === '긴급').length);
  setText('incomingOpenCount', documents.filter((item) => getDocumentType(item) === 'incoming' && item.status !== '완료').length);
  setText('outgoingPendingCount', documents.filter((item) => getDocumentType(item) === 'outgoing' && getRecipientProgress(item).pending > 0).length);
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
    const dayDocuments = documents.filter((item) => getCalendarDate(item) === dateKey);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = [
      'calendar-day',
      date.getMonth() !== month ? 'is-other-month' : '',
      dateKey === todayKey ? 'is-today' : '',
      dayDocuments.some((item) => getDueDateDiffDays(getCalendarDate(item)) < 0 && item.status !== '완료') ? 'has-overdue' : '',
      dayDocuments.some((item) => {
        const diff = getDueDateDiffDays(getCalendarDate(item));
        return diff >= 0 && diff <= 3 && item.status !== '완료';
      }) ? 'has-urgent' : '',
      dayDocuments.some((item) => getDocumentType(item) === 'outgoing') ? 'has-outgoing' : '',
      dayDocuments.some((item) => getDocumentType(item) === 'incoming') ? 'has-incoming' : ''
    ].filter(Boolean).join(' ');

    cell.innerHTML = `
      <span class="day-number">${date.getDate()}</span>
      <span class="day-items">
        ${dayDocuments.slice(0, 3).map((item) => `<span class="${getDocumentType(item) === 'outgoing' ? 'day-item-outgoing' : 'day-item-incoming'}">${escapeHtml(getCalendarItemLabel(item))}</span>`).join('')}
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

  selectedDocumentId = item.id;
  const analysis = item.analysis || {};
  documentDetail.innerHTML = `
    <h2>${escapeHtml(item.title || '공문 상세')}</h2>
    <dl class="detail-list">
      <dt>업무 구분</dt><dd>${renderDocumentTypeBadge(item)}</dd>
      <dt>발신기관</dt><dd>${escapeHtml(item.sender || '-')}</dd>
      <dt>담당부서</dt><dd>${escapeHtml(item.department || formatList(analysis.departments))}</dd>
      <dt>제출기한</dt><dd>${escapeHtml(item.dueDate || item.deadline || '-')}</dd>
      <dt>회신기한</dt><dd>${escapeHtml(getDocumentType(item) === 'outgoing' ? item.responseDueDate || item.dueDate || item.deadline || '-' : '-')}</dd>
      <dt>취합현황</dt><dd>${escapeHtml(formatRecipientProgress(item))}</dd>
      <dt>상태</dt><dd>${escapeHtml(item.status || '-')}</dd>
      <dt>파일 정보</dt><dd>${escapeHtml(formatFileInfo(item.fileInfo))}</dd>
      <dt>비고</dt><dd>${escapeHtml(item.note || '-')}</dd>
      <dt>내용</dt><dd>${escapeHtml(item.content || item.parsedContent || '-')}</dd>
    </dl>
    ${renderRecipients(item)}
    ${renderAnalysisSections(item, analysis)}
  `;

  documentDetail.querySelectorAll('[data-recipient-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      await updateRecipientStatus(item.id, button.dataset.recipientId, button.dataset.nextStatus);
    });
  });

  documentDetail.querySelectorAll('[data-reminder-recipient-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      await handleReminderAction(item.id, button.dataset.reminderRecipientId, button.dataset.reminderAction);
    });
  });
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

function renderAnalysisSections(item, analysis) {
  if (getDocumentType(item) === 'outgoing') {
    return `
      <h3>취합 관리</h3>
      <p class="empty-detail">생산 공문은 AI/페르소나 평가 없이 수신부서 회신 현황만 관리합니다.</p>
    `;
  }

  return `
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

function renderRecipients(item) {
  if (getDocumentType(item) !== 'outgoing') {
    return '';
  }

  const recipients = Array.isArray(item.recipients) ? item.recipients : [];

  if (recipients.length === 0) {
    return '<section class="recipient-section"><h3>수신부서 취합</h3><p class="empty-detail">등록된 수신부서가 없습니다.</p></section>';
  }

  return `
    <section class="recipient-section">
      <h3>수신부서 취합</h3>
      <div class="recipient-summary">${escapeHtml(formatRecipientProgress(item))}</div>
      <div class="recipient-list">
        ${recipients.map((recipient) => {
          const isReceived = recipient.status === 'received';
          return `
            <article class="recipient-item ${isReceived ? 'is-received' : 'is-pending'}">
              <div>
                <strong>${escapeHtml(recipient.name || '-')}</strong>
                <span>${isReceived ? `수신 완료 ${formatDate(recipient.receivedAt)}` : '미수신'}</span>
                <label class="recipient-email-label">
                  <span>담당자 이메일</span>
                  <input type="email" value="${escapeHtml(recipient.email || '')}" data-recipient-email="${escapeHtml(recipient.id)}" placeholder="name@example.com">
                </label>
                <div class="recipient-reminder-actions">
                  <button type="button" class="draft-button" data-reminder-recipient-id="${escapeHtml(recipient.id)}" data-reminder-action="draft">메일 임시저장</button>
                  <button type="button" class="send-button" data-reminder-recipient-id="${escapeHtml(recipient.id)}" data-reminder-action="send">바로 발송</button>
                </div>
                ${recipient.lastReminderAt ? `<p>최근 독촉: ${escapeHtml(formatDate(recipient.lastReminderAt))} (${escapeHtml(recipient.reminderStatus || '-')})</p>` : ''}
                ${recipient.note ? `<p>${escapeHtml(recipient.note)}</p>` : ''}
              </div>
              <button
                type="button"
                class="${isReceived ? 'pending-button' : 'received-button'}"
                data-recipient-id="${escapeHtml(recipient.id)}"
                data-next-status="${isReceived ? 'pending' : 'received'}"
              >${isReceived ? '미수신으로 변경' : '받음 처리'}</button>
            </article>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

async function handleReminderAction(documentId, recipientId, action) {
  const emailInput = documentDetail.querySelector(`[data-recipient-email="${cssEscape(recipientId)}"]`);
  const email = emailInput ? emailInput.value.trim() : '';
  const label = action === 'send' ? '바로 발송' : '임시저장';

  if (!email) {
    alert('담당자 이메일을 입력해 주세요.');
    return;
  }

  if (action === 'send' && !confirm('독촉 메일을 바로 발송할까요?')) {
    return;
  }

  const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/recipients/${encodeURIComponent(recipientId)}/reminder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, action })
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    alert([result.message || `독촉 메일 ${label}에 실패했습니다.`, result.detail].filter(Boolean).join('\n'));
    return;
  }

  renderDocumentDetail(result.document);
  await loadDocuments();
  alert(`독촉 메일 ${label}이 완료되었습니다.`);
}

async function updateRecipientStatus(documentId, recipientId, nextStatus) {
  const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/recipients/${encodeURIComponent(recipientId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: nextStatus })
  });

  if (!response.ok) {
    alert('수신부서 상태 변경에 실패했습니다.');
    return;
  }

  const updatedDocument = await response.json();
  renderDocumentDetail(updatedDocument);
  await loadDocuments();
}

function resetDetail() {
  selectedDocumentId = null;
  if (documentDetail) {
    documentDetail.innerHTML = '<h2>공문 상세</h2><p class="empty-detail">목록이나 캘린더에서 공문을 선택하면 분석 결과를 확인할 수 있습니다.</p>';
  }
}

function getDocumentType(item) {
  return item && item.documentType === 'outgoing' ? 'outgoing' : 'incoming';
}

function getCalendarDate(item) {
  if (getDocumentType(item) === 'outgoing') {
    return item.responseDueDate || item.dueDate || item.deadline || '';
  }

  return item.dueDate || item.deadline || '';
}

function getCalendarItemLabel(item) {
  const prefix = getDocumentType(item) === 'outgoing' ? '취합' : '제출';
  return `[${prefix}] ${item.title || '-'}`;
}

function renderDocumentTypeBadge(item) {
  const type = getDocumentType(item);
  const label = type === 'outgoing' ? '생산/취합' : '접수/제출';

  return `<span class="type-badge type-${type}">${label}</span>`;
}

function getRecipientProgress(item) {
  const progress = item && item.recipientProgress ? item.recipientProgress : null;
  const recipients = Array.isArray(item && item.recipients) ? item.recipients : [];
  const received = progress ? Number(progress.received) || 0 : recipients.filter((recipient) => recipient.status === 'received').length;
  const total = progress ? Number(progress.total) || recipients.length : recipients.length;

  return {
    total,
    received,
    pending: Math.max(total - received, 0)
  };
}

function formatRecipientProgress(item) {
  if (getDocumentType(item) !== 'outgoing') {
    return '-';
  }

  const progress = getRecipientProgress(item);
  return `${progress.received}/${progress.total} 접수, ${progress.pending} 미수신`;
}

function getUrgentDocuments(documents) {
  return documents.filter((item) => {
    const dueDate = getCalendarDate(item);
    const diffDays = dueDate ? getDueDateDiffDays(dueDate) : 99;
    return item.status !== '완료' && diffDays >= 0 && diffDays <= 3;
  });
}

function getOverdueDocuments(documents) {
  return documents.filter((item) => {
    const dueDate = getCalendarDate(item);
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
  const classes = [getDueDateClass(getCalendarDate(item), item.status), `type-${getDocumentType(item)}-row`];
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

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(String(value));
  }

  return String(value).replace(/["\\]/g, '\\$&');
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

if (documentTypeSelect && outgoingFields) {
  const syncOutgoingFields = () => {
    outgoingFields.hidden = documentTypeSelect.value !== 'outgoing';
  };

  documentTypeSelect.addEventListener('change', syncOutgoingFields);
  syncOutgoingFields();
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
      const formData = new FormData(uploadForm);
      if (documentTypeSelect) {
        formData.set('documentType', documentTypeSelect.value);
      }

      const response = await fetch('/api/documents/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({ message: '파일 업로드에 실패했습니다.' }));
        uploadMessage.textContent = result.message || '파일 업로드에 실패했습니다.';
        return;
      }

      uploadForm.reset();
      if (outgoingFields) {
        outgoingFields.hidden = true;
      }
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
