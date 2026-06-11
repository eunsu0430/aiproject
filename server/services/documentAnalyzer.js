const OpenAI = require('openai');
const { loadPersonas } = require('./personaLoader');
const { getRuntimeConfig } = require('./runtimeConfig');

const RISK_LEVELS = ['낮음', '보통', '높음', '긴급'];
const IMPORTANT_KEYWORDS = ['법정', '감사', '의회', '예산', '재난', '안전', '보고', '제출', '회신', '긴급', '즉시'];
const BROAD_TARGET_KEYWORDS = ['전 부서', '전체 부서', '전직원', '모든 부서', '각 부서'];
const ACTION_KEYWORDS = ['제출', '검토', '보고', '확인', '회신', '처리', '협조'];
const KNOWN_DEPARTMENTS = ['기획팀', '운영팀', '총무팀', '인사팀', '재무팀', '안전팀', '감사팀', '행정팀', '민원팀', '시설팀', '교육팀', '복지팀'];
const OPENAI_TIMEOUT_MS = 8000;
const OPENAI_CONTENT_LIMIT = 12000;

async function analyzeDocument(document) {
  const startedAt = Date.now();
  const personas = loadPersonas();
  const documentContext = buildDocumentContext(document);
  const ruleEvaluation = evaluateDocumentRisk(documentContext.content, documentContext.deadline, documentContext.departments);
  const ruleMs = Date.now() - startedAt;
  const aiEvaluation = await evaluateWithOpenAI(document, documentContext, ruleEvaluation);
  const aiMs = Date.now() - startedAt - ruleMs;
  const rulePersonaResult = evaluateAllPersonas(document, personas, {
    ...documentContext,
    documentRisk: ruleEvaluation,
    aiEvaluation
  });
  const personaRuleMs = Date.now() - startedAt - ruleMs - aiMs;
  const personaResult = await evaluatePersonasWithOpenAI(document, personas, {
    ...documentContext,
    documentRisk: ruleEvaluation,
    aiEvaluation
  }, rulePersonaResult);
  const personaAiMs = Date.now() - startedAt - ruleMs - aiMs - personaRuleMs;
  const importance = calculateFinalImportance(aiEvaluation, ruleEvaluation, personaResult.personaEvaluation);
  console.log(`[analyze:timing] rule=${ruleMs}ms openai1=${aiMs}ms personaRule=${personaRuleMs}ms openai2=${personaAiMs}ms total=${Date.now() - startedAt}ms`);

  return {
    summary: aiEvaluation.summary || summarize(documentContext.content),
    deadline: aiEvaluation.deadline || documentContext.deadline || '',
    departments: normalizeStringArray(aiEvaluation.departments, documentContext.departments),
    requiredActions: normalizeStringArray(aiEvaluation.requiredActions, extractRequiredActions(documentContext.content)),
    importance,
    importanceReason: buildImportanceReasons(aiEvaluation, ruleEvaluation, personaResult.personaEvaluation),
    aiEvaluation,
    personaEvaluation: personaResult.personaEvaluation,
    personaPanel: personaResult.personaPanel,
    aiMode: aiEvaluation.aiMode
  };
}

async function extractProductionDocumentInfo(document) {
  const fallback = buildProductionInfoFallback(document, 'rule-fallback-no-key');
  const config = getRuntimeConfig();
  const apiKey = config.openaiKey;

  if (!apiKey) {
    return fallback;
  }

  try {
    const client = createOpenAIClient(apiKey);
    const response = await client.chat.completions.create({
      model: config.openaiModel || 'gpt-4o-mini',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: [
            '너는 한국 공문에서 생산 문서의 취합 정보를 추출하는 도우미다.',
            '위험도, 중요도, 페르소나 평가는 하지 않는다.',
            '수신자/수신부서, 회신기한, 짧은 취합 목적만 추출한다.',
            '수신자에는 결재자, 담당자, 시행기관, 주소, 전화번호, 이메일, 문서번호, 제목, 경유/참조 라벨을 넣지 않는다.',
            '반드시 JSON만 반환한다.',
            'JSON 필드는 recipients(array of strings), responseDueDate(YYYY-MM-DD or empty string), summary(string) 이다.'
          ].join('\n')
        },
        {
          role: 'user',
          content: JSON.stringify({
            title: document.title,
            department: document.department,
            dueDate: document.dueDate || document.deadline,
            content: String(document.content || document.parsedContent || '').slice(0, 12000)
          })
        }
      ],
      response_format: { type: 'json_object' }
    });
    const parsed = JSON.parse(response.choices[0].message.content);

    return normalizeProductionInfo(parsed, fallback, 'openai-production-extract');
  } catch (error) {
    return {
      ...fallback,
      aiMode: 'rule-fallback-production-extract-error',
      errorMessage: error.message
    };
  }
}

function normalizeProductionInfo(value, fallback, aiMode) {
  const source = value && typeof value === 'object' ? value : {};
  const recipients = normalizeProductionRecipients(source.recipients);
  const responseDueDate = normalizeDateLike(source.responseDueDate);

  return {
    recipients: recipients.length > 0 ? recipients : fallback.recipients,
    responseDueDate: responseDueDate || fallback.responseDueDate,
    summary: String(source.summary || fallback.summary || '').trim(),
    aiMode
  };
}

function buildProductionInfoFallback(document, aiMode) {
  const content = String(document.content || document.parsedContent || '');
  const recipients = normalizeProductionRecipients(extractRecipientCandidates(content, document.department));
  const responseDueDate = normalizeDateLike(document.responseDueDate || document.dueDate || document.deadline || extractDeadline(content));

  return {
    recipients,
    responseDueDate,
    summary: recipients.length > 0
      ? `생산 공문 수신 대상 ${recipients.length}곳의 회신을 취합합니다.`
      : '생산 공문 수신부서 회신을 취합합니다.',
    aiMode
  };
}

function normalizeProductionRecipients(value) {
  const items = Array.isArray(value) ? value : String(value || '').split(/[\n,;，ㆍ·、]+/);
  const blocked = /^(수신|수신자|참조|경유|제목|시행|접수|결재|협조자|전화|전송|주소|우|공개|끝|담당|주무관|과장|국장|기관장)$/;
  const result = [];

  items
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
    .map((item) => item.replace(/^(수신자?|참조|경유)\s*[:：]?\s*/, '').trim())
    .map((item) => item.replace(/\s+(제목|시행|접수|결재|협조자|전화|전송|주소|우|공개|끝)\b.*$/, '').trim())
    .map((item) => item.replace(/\s*\(.*?참조.*?\)\s*/g, '').trim())
    .filter((item) => item.length >= 2 && item.length <= 60)
    .filter((item) => !blocked.test(item))
    .filter((item) => !/^\d+$/.test(item))
    .filter((item) => !/[0-9]{2,4}-[0-9]{3,4}-[0-9]{4}/.test(item))
    .filter((item) => !/@/.test(item))
    .filter((item) => !/^https?:\/\//i.test(item))
    .forEach((item) => {
      if (!result.includes(item)) {
        result.push(item);
      }
    });

  return result.slice(0, 80);
}

function extractRecipientCandidates(content, ownDepartment) {
  const source = String(content || '');
  const compact = source.replace(/\s+/g, ' ');
  const candidates = [];
  const receiveBlock = compact.match(/수신자?\s*[:：]?\s*(.+?)(?:\s+\(?경유\)?|\s+제목\s+|\s+1\.|\s+시행\s+|\s+접수\s+|$)/);

  if (receiveBlock && receiveBlock[1]) {
    receiveBlock[1]
      .split(/[,，ㆍ·;、]|\s{2,}/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => candidates.push(item));
  }

  if (candidates.length > 0) {
    return candidates.filter((item) => item !== ownDepartment);
  }

  Array.from(source.matchAll(/(?:본청|직속기관|교육지원청|공립|사립|초|중|고|특수|학교|부서|과|팀|센터|기관|원|청|장)[가-힣A-Za-z0-9·ㆍ\-\s()]{0,30}/g))
    .map((match) => match[0].trim())
    .filter(Boolean)
    .forEach((item) => candidates.push(item));

  return candidates.filter((item) => item !== ownDepartment);
}

function normalizeDateLike(value) {
  const text = String(value || '').trim();
  const currentYear = String(new Date().getFullYear());

  if (!text) {
    return '';
  }

  const iso = text.match(/20\d{2}[-.\/]\s*\d{1,2}[-.\/]\s*\d{1,2}/);
  if (iso) {
    return normalizeDateString(iso[0]);
  }

  const korean = text.match(/(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/);
  if (korean) {
    return `${korean[1]}-${korean[2].padStart(2, '0')}-${korean[3].padStart(2, '0')}`;
  }

  const koreanWithoutYear = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (koreanWithoutYear) {
    return `${currentYear}-${koreanWithoutYear[1].padStart(2, '0')}-${koreanWithoutYear[2].padStart(2, '0')}`;
  }

  const shortDate = text.match(/(?<!\d)(\d{1,2})\s*[.\/]\s*(\d{1,2})\s*[.\/]?/);
  if (shortDate) {
    return `${currentYear}-${shortDate[1].padStart(2, '0')}-${shortDate[2].padStart(2, '0')}`;
  }

  return '';
}

async function evaluateWithOpenAI(document, context, fallbackRisk) {
  const config = getRuntimeConfig();
  const apiKey = config.openaiKey;

  if (!apiKey) {
    return buildRuleAiFallback(context, fallbackRisk, 'rule-fallback-no-key');
  }

  try {
    const client = createOpenAIClient(apiKey);
    const response = await client.chat.completions.create({
      model: config.openaiModel || 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: [
            '너는 한국 공문 업무관리 시스템의 1차 AI 평가자다.',
            '공문을 요약하고 기한, 담당 부서, 필요 조치, 중요도를 판단한다.',
            '반드시 JSON만 반환한다.',
            'importance는 낮음, 보통, 높음, 긴급 중 하나다.',
            'JSON 필드는 summary, deadline, departments, requiredActions, importance, importanceReason 이어야 한다.'
          ].join('\n')
        },
        {
          role: 'user',
          content: JSON.stringify({
            title: document.title,
            sender: document.sender,
            department: document.department,
            dueDate: document.dueDate || document.deadline,
            content: String(document.content || document.parsedContent || '').slice(0, OPENAI_CONTENT_LIMIT)
          })
        }
      ],
      response_format: { type: 'json_object' }
    });
    const parsed = JSON.parse(response.choices[0].message.content);

    return normalizeAiEvaluation(parsed, context, fallbackRisk, 'openai');
  } catch (error) {
    return buildRuleAiFallback(context, fallbackRisk, 'rule-fallback-openai-error', error.message);
  }
}

function normalizeAiEvaluation(value, context, fallbackRisk, aiMode, errorMessage) {
  const source = value && typeof value === 'object' ? value : {};
  const normalizedDeadline = normalizeDateLike(source.deadline) || normalizeDateLike(context.deadline);

  return {
    summary: source.summary || summarize(context.content),
    deadline: normalizedDeadline || '',
    departments: normalizeStringArray(source.departments, context.departments),
    requiredActions: normalizeStringArray(source.requiredActions, extractRequiredActions(context.content)),
    importance: RISK_LEVELS.includes(source.importance) ? source.importance : fallbackRisk.riskLevel,
    importanceReason: normalizeStringArray(source.importanceReason, fallbackRisk.reasons),
    aiMode,
    errorMessage: errorMessage || ''
  };
}

function buildRuleAiFallback(context, fallbackRisk, aiMode, errorMessage) {
  return normalizeAiEvaluation({
    summary: summarize(context.content),
    deadline: context.deadline,
    departments: context.departments,
    requiredActions: extractRequiredActions(context.content),
    importance: fallbackRisk.riskLevel,
    importanceReason: fallbackRisk.reasons
  }, context, fallbackRisk, aiMode, errorMessage);
}

function evaluateAllPersonas(document, personas, context) {
  const normalizedPersonas = Array.isArray(personas) ? personas : [];
  const personaContext = buildPersonaRuleContext(document, context);
  const evaluations = normalizedPersonas.map((persona) => evaluatePersona(persona, document, personaContext));
  const sorted = evaluations
    .slice()
    .sort((a, b) => b.score - a.score || RISK_LEVELS.indexOf(b.riskLevel) - RISK_LEVELS.indexOf(a.riskLevel));
  const personaPanel = sorted.slice(0, 10).map(toPersonaPanelItem);

  return {
    personaEvaluation: buildPersonaEvaluation(evaluations, personaPanel),
    personaPanel
  };
}

function buildPersonaRuleContext(document, context) {
  const normalizedContent = normalizeText(context.content);
  const documentTokens = tokenize(context.content);
  const normalizedDocumentTokens = documentTokens.map((token) => ({
    raw: token,
    normalized: normalizeText(token)
  })).filter((token) => token.normalized.length >= 2);
  const candidates = [
    ...IMPORTANT_KEYWORDS,
    ...ACTION_KEYWORDS,
    ...BROAD_TARGET_KEYWORDS,
    ...KNOWN_DEPARTMENTS,
    document.department,
    ...context.departments
  ]
    .filter(Boolean)
    .map((keyword) => ({
      raw: keyword,
      normalized: normalizeText(keyword)
    }))
    .filter((item) => item.normalized && normalizedContent.includes(item.normalized));

  return {
    ...context,
    normalizedContent,
    documentTokens,
    normalizedDocumentTokens,
    matchingCandidates: candidates,
    hasBroadTarget: hasAnyNormalizedKeyword(normalizedContent, BROAD_TARGET_KEYWORDS),
    deadlineDiffDays: context.deadline ? getDueDateDiffDays(context.deadline) : null,
    normalizedDocumentDepartment: normalizeText(document.department),
    normalizedDepartments: context.departments.map((department) => normalizeText(department)).filter(Boolean)
  };
}

async function evaluatePersonasWithOpenAI(document, personas, context, fallbackResult) {
  const config = getRuntimeConfig();
  const apiKey = config.openaiKey;

  if (!apiKey || !context.aiEvaluation || context.aiEvaluation.aiMode !== 'openai') {
    return fallbackResult;
  }

  const candidates = fallbackResult.personaPanel.slice(0, 25).map((persona) => ({
    id: persona.id,
    name: persona.name,
    role: persona.role,
    department: persona.department,
    score: persona.score,
    riskLevel: persona.riskLevel,
    matchedKeywords: persona.matchedKeywords,
    comment: persona.comment
  }));

  try {
    const client = createOpenAIClient(apiKey);
    const response = await client.chat.completions.create({
      model: config.openaiModel || 'gpt-4o-mini',
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: [
            '너는 한국 공문 업무관리 시스템의 2차 페르소나 평가자다.',
            '1차 AI 평가 결과와 후보 페르소나를 보고 실제 업무상 영향을 받을 페르소나를 선별한다.',
            '공문의 기한, 담당부서, 필요조치, 위험도를 기준으로 페르소나별 점수와 코멘트를 다시 판단한다.',
            '반드시 JSON만 반환한다.',
            'JSON 필드는 personaEvaluation(object), personaPanel(array) 이다.',
            'personaEvaluation 필드: totalPersonas, evaluatedPersonas, selectedPanelCount, riskDistribution, averageScore, maxScore, matchedDepartments, matchedRoles.',
            'personaPanel 항목 필드: id, name, role, department, riskLevel, score, matchedKeywords, comment, sourceFile.',
            'riskLevel은 낮음, 보통, 높음, 긴급 중 하나다.'
          ].join('\n')
        },
        {
          role: 'user',
          content: JSON.stringify({
            document: {
              title: document.title,
              sender: document.sender,
              department: document.department,
              deadline: context.deadline,
              content: context.content.slice(0, OPENAI_CONTENT_LIMIT)
            },
            firstEvaluation: context.aiEvaluation,
            ruleRisk: context.documentRisk,
            totalPersonaCount: Array.isArray(personas) ? personas.length : 0,
            candidatePersonas: candidates
          })
        }
      ],
      response_format: { type: 'json_object' }
    });
    const parsed = JSON.parse(response.choices[0].message.content);

    return normalizeOpenAiPersonaResult(parsed, fallbackResult, personas);
  } catch (error) {
    return {
      ...fallbackResult,
      personaEvaluation: {
        ...fallbackResult.personaEvaluation,
        aiMode: 'rule-fallback-persona-openai-error',
        errorMessage: error.message
      }
    };
  }
}

function normalizeOpenAiPersonaResult(value, fallbackResult, personas) {
  const source = value && typeof value === 'object' ? value : {};
  const fallbackEvaluation = fallbackResult.personaEvaluation;
  const fallbackPanel = fallbackResult.personaPanel;
  const panel = Array.isArray(source.personaPanel) && source.personaPanel.length > 0
    ? source.personaPanel.map((item, index) => normalizeOpenAiPersonaPanelItem(item, fallbackPanel[index])).filter(Boolean).slice(0, 10)
    : fallbackPanel;
  const riskDistribution = buildRiskDistribution(panel, source.personaEvaluation && source.personaEvaluation.riskDistribution);
  const totalScore = panel.reduce((sum, item) => sum + (Number(item.score) || 0), 0);
  const evaluation = source.personaEvaluation && typeof source.personaEvaluation === 'object'
    ? source.personaEvaluation
    : {};

  return {
    personaEvaluation: {
      totalPersonas: Number(evaluation.totalPersonas) || (Array.isArray(personas) ? personas.length : fallbackEvaluation.totalPersonas),
      evaluatedPersonas: Number(evaluation.evaluatedPersonas) || panel.length,
      selectedPanelCount: panel.length,
      riskDistribution,
      averageScore: Number(evaluation.averageScore) || (panel.length > 0 ? Number((totalScore / panel.length).toFixed(2)) : 0),
      maxScore: Number(evaluation.maxScore) || panel.reduce((max, item) => Math.max(max, Number(item.score) || 0), 0),
      matchedDepartments: normalizeStringArray(evaluation.matchedDepartments, panel.map((item) => item.department).filter(Boolean)).slice(0, 20),
      matchedRoles: normalizeStringArray(evaluation.matchedRoles, panel.map((item) => item.role).filter(Boolean)).slice(0, 20),
      aiMode: 'openai-persona'
    },
    personaPanel: panel
  };
}

function normalizeOpenAiPersonaPanelItem(item, fallback) {
  const source = item && typeof item === 'object' ? item : {};
  const base = fallback || {};
  const riskLevel = RISK_LEVELS.includes(source.riskLevel) ? source.riskLevel : base.riskLevel || '낮음';

  return {
    id: source.id || base.id || '',
    name: source.name || base.name || '-',
    role: source.role || base.role || '-',
    department: source.department || base.department || '',
    riskLevel,
    score: Number(source.score) || Number(base.score) || 0,
    matchedKeywords: normalizeStringArray(source.matchedKeywords, base.matchedKeywords || []),
    comment: source.comment || base.comment || '',
    sourceFile: source.sourceFile || base.sourceFile || ''
  };
}

function buildRiskDistribution(panel, sourceDistribution) {
  const distribution = { 낮음: 0, 보통: 0, 높음: 0, 긴급: 0 };

  if (sourceDistribution && typeof sourceDistribution === 'object') {
    RISK_LEVELS.forEach((level) => {
      distribution[level] = Number(sourceDistribution[level]) || 0;
    });
  }

  if (Object.values(distribution).some((value) => value > 0)) {
    return distribution;
  }

  panel.forEach((item) => {
    distribution[RISK_LEVELS.includes(item.riskLevel) ? item.riskLevel : '낮음'] += 1;
  });

  return distribution;
}

function evaluatePersona(persona, document, context) {
  const personaText = [persona.name, persona.role, persona.department, persona.content].filter(Boolean).join(' ');
  const normalizedPersonaText = normalizeText(personaText);
  const normalizedPersonaDepartment = normalizeText(persona.department);
  const matchedKeywords = findMatchedKeywords(context, normalizedPersonaText);
  let score = matchedKeywords.length * 2;

  score += Math.floor(context.documentRisk.score / 3);
  score += getRiskBaseScore(context.aiEvaluation.importance);

  if (context.deadlineDiffDays !== null) {
    const diffDays = context.deadlineDiffDays;
    if (diffDays < 0) score += 5;
    else if (diffDays <= 1) score += 4;
    else if (diffDays <= 3) score += 3;
    else if (diffDays <= 7) score += 1;
  }

  if (context.hasBroadTarget) {
    score += 3;
  }

  if (context.normalizedDocumentDepartment && normalizedPersonaDepartment.includes(context.normalizedDocumentDepartment)) {
    score += 5;
  }

  context.normalizedDepartments.forEach((department) => {
    if (normalizedPersonaDepartment && normalizedPersonaDepartment.includes(department)) {
      score += 4;
    }
  });

  score += getRoleBoost(persona.role, context.content);

  return {
    persona,
    score,
    riskLevel: getRiskLevelByScore(score),
    matchedKeywords,
    comment: buildPersonaComment(persona, score, matchedKeywords, context)
  };
}

function findMatchedKeywords(context, normalizedPersonaText) {
  const matched = new Set();

  context.matchingCandidates.forEach((keyword) => {
    if (normalizedPersonaText.includes(keyword.normalized)) {
      matched.add(keyword.raw);
    }
  });

  context.normalizedDocumentTokens.forEach((token) => {
    if (normalizedPersonaText.includes(token.normalized)) {
      matched.add(token.raw);
    }
  });

  return Array.from(matched).slice(0, 12);
}

function buildPersonaEvaluation(evaluations, personaPanel) {
  const riskDistribution = { 낮음: 0, 보통: 0, 높음: 0, 긴급: 0 };
  const matchedDepartments = new Set();
  const matchedRoles = new Set();
  const totalScore = evaluations.reduce((sum, item) => {
    riskDistribution[item.riskLevel] += 1;

    if (item.score > 0 && item.persona.department) {
      matchedDepartments.add(item.persona.department);
    }

    if (item.score > 0 && item.persona.role) {
      matchedRoles.add(item.persona.role);
    }

    return sum + item.score;
  }, 0);
  const maxScore = evaluations.reduce((max, item) => Math.max(max, item.score), 0);

  return {
    totalPersonas: evaluations.length,
    evaluatedPersonas: evaluations.length,
    selectedPanelCount: personaPanel.length,
    riskDistribution,
    averageScore: evaluations.length > 0 ? Number((totalScore / evaluations.length).toFixed(2)) : 0,
    maxScore,
    matchedDepartments: Array.from(matchedDepartments).slice(0, 20),
    matchedRoles: Array.from(matchedRoles).slice(0, 20)
  };
}

function toPersonaPanelItem(evaluation) {
  return {
    id: evaluation.persona.id,
    name: evaluation.persona.name,
    role: evaluation.persona.role,
    department: evaluation.persona.department,
    riskLevel: evaluation.riskLevel,
    score: evaluation.score,
    matchedKeywords: evaluation.matchedKeywords,
    comment: evaluation.comment,
    sourceFile: evaluation.persona.sourceFile
  };
}

function evaluateDocumentRisk(content, deadline, departments) {
  const reasons = [];
  let score = 0;

  if (deadline) {
    const diffDays = getDueDateDiffDays(deadline);
    if (diffDays < 0) {
      score += 5;
      reasons.push('제출 기한이 지났습니다.');
    } else if (diffDays <= 3) {
      score += 4;
      reasons.push('제출 기한이 3일 이내입니다.');
    } else if (diffDays <= 7) {
      score += 1;
      reasons.push('제출 기한이 7일 이내입니다.');
    }
  }

  if (hasAnyKeyword(content, BROAD_TARGET_KEYWORDS)) {
    score += 3;
    reasons.push('전 부서 또는 전체 대상 공문입니다.');
  }

  const importantMatches = IMPORTANT_KEYWORDS.filter((keyword) => includesLoose(content, keyword));
  if (importantMatches.length > 0) {
    score += Math.min(importantMatches.length * 2, 8);
    reasons.push(`중요 키워드가 포함되어 있습니다: ${importantMatches.join(', ')}`);
  }

  if (departments.length > 1) {
    score += 2;
    reasons.push('관련 부서가 여러 곳입니다.');
  }

  if (reasons.length === 0) {
    reasons.push('긴급 판단 기준에 크게 해당하지 않습니다.');
  }

  return {
    score,
    riskLevel: getRiskLevelByScore(score),
    reasons
  };
}

function calculateFinalImportance(aiEvaluation, ruleEvaluation, personaEvaluation) {
  const aiRiskScore = getRiskBaseScore(aiEvaluation.importance);

  if (aiEvaluation.importance === '긴급' || ruleEvaluation.score >= 12 || personaEvaluation.maxScore >= 22 || personaEvaluation.riskDistribution.긴급 >= 5) {
    return '긴급';
  }

  if (aiEvaluation.importance === '높음' || aiRiskScore >= 4 || ruleEvaluation.score >= 7 || personaEvaluation.maxScore >= 14 || personaEvaluation.riskDistribution.높음 + personaEvaluation.riskDistribution.긴급 >= 10) {
    return '높음';
  }

  if (aiEvaluation.importance === '보통' || ruleEvaluation.score >= 3 || personaEvaluation.averageScore >= 4 || personaEvaluation.riskDistribution.보통 > 0) {
    return '보통';
  }

  return '낮음';
}

function buildImportanceReasons(aiEvaluation, ruleEvaluation, personaEvaluation) {
  const distribution = personaEvaluation.riskDistribution;
  const dominantRisk = Object.keys(distribution).sort((a, b) => distribution[b] - distribution[a])[0] || '낮음';
  const reasons = [
    `1차 AI 평가 결과는 ${aiEvaluation.importance}입니다. (${aiEvaluation.aiMode})`,
    ...aiEvaluation.importanceReason.map((reason) => `AI 판단: ${reason}`),
    `2차 페르소나 평가에서 전체 ${personaEvaluation.evaluatedPersonas}명을 평가했습니다.`,
    `가장 많은 페르소나 위험군은 ${dominantRisk}(${distribution[dominantRisk]}명)입니다.`,
    `페르소나 최고 점수는 ${personaEvaluation.maxScore}점, 평균 점수는 ${personaEvaluation.averageScore}점입니다.`,
    ...ruleEvaluation.reasons
  ];

  if (aiEvaluation.errorMessage) {
    reasons.push(`AI 호출 실패로 규칙 기반 1차 평가를 사용했습니다: ${aiEvaluation.errorMessage}`);
  }

  return reasons;
}

function getRiskBaseScore(level) {
  if (level === '긴급') return 6;
  if (level === '높음') return 4;
  if (level === '보통') return 2;
  return 0;
}

function getRoleBoost(role, content) {
  let boost = 0;

  if (/부서장|기관장|관리자|사무관|팀장/.test(role) && /보고|의회|감사|법정|예산/.test(content)) {
    boost += 3;
  }

  if (/서무|주무관|사무원|행정/.test(role) && /제출|회신|처리|확인/.test(content)) {
    boost += 2;
  }

  if (/안전|경찰|재난|시설/.test(role) && /안전|재난|시설|사고/.test(content)) {
    boost += 3;
  }

  return boost;
}

function buildPersonaComment(persona, score, matchedKeywords, context) {
  const keywordText = matchedKeywords.length > 0 ? matchedKeywords.slice(0, 5).join(', ') : '직접 일치 키워드 없음';
  const deadlineText = context.deadline ? `기한 ${context.deadline}` : '기한 없음';

  return `${persona.role} 관점에서 ${deadlineText}, 1차 AI 중요도 ${context.aiEvaluation.importance}, 일치 키워드(${keywordText}) 기준으로 ${score}점 평가되었습니다.`;
}

function buildDocumentContext(document) {
  const content = [document.title, document.content || document.parsedContent, document.department, document.dueDate, document.deadline]
    .filter(Boolean)
    .join('\n');

  return {
    content,
    deadline: document.dueDate || document.deadline || extractDeadline(content),
    departments: extractDepartments(content, document.department)
  };
}

function summarize(content) {
  if (!content) {
    return '내용이 없습니다.';
  }

  return content.length > 120 ? `${content.slice(0, 120)}...` : content;
}

function extractDeadline(content) {
  const source = String(content || '');
  const candidates = collectDateCandidates(source);

  if (candidates.length === 0) {
    return '';
  }

  return candidates
    .sort((a, b) => b.score - a.score || new Date(a.date) - new Date(b.date))[0].date;
}

function collectDateCandidates(source) {
  const candidates = [];
  const firstYear = (source.match(/20\d{2}/) || [new Date().getFullYear()])[0];
  const patterns = [
    /20\d{2}[-.\/]\s*\d{1,2}[-.\/]\s*\d{1,2}/g,
    /(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g,
    /(?<!\d)(\d{1,2})\s*[.\/]\s*(\d{1,2})\s*[.\/]?/g
  ];

  patterns.forEach((pattern, patternIndex) => {
    for (const match of source.matchAll(pattern)) {
      const date = patternIndex === 0
        ? normalizeDateString(match[0])
        : patternIndex === 1
          ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
          : `${firstYear}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;

      if (Number.isNaN(new Date(date).getTime())) {
        continue;
      }

      candidates.push({
        date,
        score: scoreDateCandidate(source, match.index || 0, date)
      });
    }
  });

  return candidates;
}

function scoreDateCandidate(source, index, date) {
  const before = source.slice(Math.max(0, index - 120), index);
  const after = source.slice(index, Math.min(source.length, index + 140));
  const context = `${before} ${after}`;
  let score = 0;

  if (/제출|회신|등록|신청|참여|진단|응답|납부|보고|검토|처리|취합|제출처/.test(context)) score += 6;
  if (/기한|마감|까지|완료|기일|기간|제출일|회신일|신청일|등록일/.test(context)) score += 8;
  if (/제출\s*기한|회신\s*기한|자료\s*제출|의견\s*제출|제출\s*바람|회신\s*바람|까지\s*(제출|회신|등록|신청)/.test(context)) score += 12;
  if (/[~～-]\s*(?:20\d{2}[-.\/년\s]*)?\d{1,2}/.test(before) || /[~～-]/.test(before)) score += 5;
  if (/시행일|접수일|작성일|발송일|문서번호|등록번호|접수번호|감사관-\d+/.test(context)) score -= 12;
  else if (/시행|접수|작성|발송|관련|문서번호/.test(context)) score -= 5;
  if (/전화|팩스|우편|주소|사업비|예산|금액|원\b/.test(context)) score -= 3;

  const diffDays = getDueDateDiffDays(date);
  if (diffDays < -365) score -= 4;
  else if (diffDays < 0) score += 1;
  else if (diffDays <= 30) score += 4;
  else if (diffDays <= 120) score += 2;

  return score;
}

function normalizeDateString(value) {
  const parts = String(value).replace(/\s+/g, '').replace(/[.\/]/g, '-').split('-');
  return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
}

function extractDepartments(content, department) {
  const departments = KNOWN_DEPARTMENTS.filter((item) => content.includes(item));
  const labeledDepartments = Array.from(String(content || '').matchAll(/(?:담당부서|관련부서|처리부서|협조부서)\s*[:：-]?\s*([^\n\r]+)/g))
    .map((match) => match[1].trim().replace(/[.,;].*$/, ''));

  labeledDepartments.forEach((item) => {
    if (item && !departments.includes(item)) {
      departments.push(item);
    }
  });

  if (department && !departments.includes(department)) {
    departments.push(department);
  }

  return departments;
}

function extractRequiredActions(content) {
  const actions = ACTION_KEYWORDS.filter((keyword) => includesLoose(content, keyword));
  return actions.length > 0 ? actions : ['확인'];
}

function normalizeStringArray(value, fallback) {
  return Array.isArray(value) && value.length > 0 ? value.map(String) : fallback;
}

function getRiskLevelByScore(score) {
  if (score >= 20) return '긴급';
  if (score >= 12) return '높음';
  if (score >= 5) return '보통';
  return '낮음';
}

function hasAnyKeyword(text, keywords) {
  return keywords.some((keyword) => includesLoose(text, keyword));
}

function hasAnyNormalizedKeyword(normalizedText, keywords) {
  return keywords.some((keyword) => normalizedText.includes(normalizeText(keyword)));
}

function includesLoose(text, keyword) {
  return normalizeText(text).includes(normalizeText(keyword));
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function tokenize(text) {
  return Array.from(new Set(String(text || '').match(/[가-힣A-Za-z0-9]{2,}/g) || []))
    .filter((token) => !/^\d+$/.test(token))
    .slice(0, 80);
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

function createOpenAIClient(apiKey) {
  return new OpenAI({
    apiKey,
    timeout: OPENAI_TIMEOUT_MS,
    maxRetries: 0
  });
}

module.exports = {
  analyzeDocument,
  extractProductionDocumentInfo
};

