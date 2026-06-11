const OpenAI = require('openai');
const { loadPersonas } = require('./personaLoader');

const RISK_LEVELS = ['낮음', '보통', '높음', '긴급'];
const IMPORTANT_KEYWORDS = ['법정', '감사', '의회', '예산', '재난', '안전', '보고', '제출', '회신', '긴급', '즉시'];
const BROAD_TARGET_KEYWORDS = ['전 부서', '전체 부서', '전직원', '모든 부서', '각 부서'];
const ACTION_KEYWORDS = ['제출', '검토', '보고', '확인', '회신', '처리', '협조'];
const KNOWN_DEPARTMENTS = ['기획팀', '운영팀', '총무팀', '인사팀', '재무팀', '안전팀', '감사팀', '행정팀', '민원팀', '시설팀', '교육팀', '복지팀'];

async function analyzeDocument(document) {
  const personas = loadPersonas();
  const documentContext = buildDocumentContext(document);
  const ruleEvaluation = evaluateDocumentRisk(documentContext.content, documentContext.deadline, documentContext.departments);
  const aiEvaluation = await evaluateWithOpenAI(document, documentContext, ruleEvaluation);
  const personaResult = evaluateAllPersonas(document, personas, {
    ...documentContext,
    documentRisk: ruleEvaluation,
    aiEvaluation
  });
  const importance = calculateFinalImportance(aiEvaluation, ruleEvaluation, personaResult.personaEvaluation);

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

async function evaluateWithOpenAI(document, context, fallbackRisk) {
  const apiKey = process.env.OPENAI || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return buildRuleAiFallback(context, fallbackRisk, 'rule-fallback-no-key');
  }

  try {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
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
            content: document.content || document.parsedContent || ''
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

  return {
    summary: source.summary || summarize(context.content),
    deadline: source.deadline || context.deadline || '',
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
  const evaluations = normalizedPersonas.map((persona) => evaluatePersona(persona, document, context));
  const sorted = evaluations
    .slice()
    .sort((a, b) => b.score - a.score || RISK_LEVELS.indexOf(b.riskLevel) - RISK_LEVELS.indexOf(a.riskLevel));
  const personaPanel = sorted.slice(0, 10).map(toPersonaPanelItem);

  return {
    personaEvaluation: buildPersonaEvaluation(evaluations, personaPanel),
    personaPanel
  };
}

function evaluatePersona(persona, document, context) {
  const personaText = [persona.name, persona.role, persona.department, persona.content].filter(Boolean).join(' ');
  const matchedKeywords = findMatchedKeywords(context.content, personaText, document.department, context.departments);
  let score = matchedKeywords.length * 2;

  score += Math.floor(context.documentRisk.score / 3);
  score += getRiskBaseScore(context.aiEvaluation.importance);

  if (context.deadline) {
    const diffDays = getDueDateDiffDays(context.deadline);
    if (diffDays < 0) score += 5;
    else if (diffDays <= 1) score += 4;
    else if (diffDays <= 3) score += 3;
    else if (diffDays <= 7) score += 1;
  }

  if (hasAnyKeyword(context.content, BROAD_TARGET_KEYWORDS)) {
    score += 3;
  }

  if (document.department && persona.department && includesLoose(persona.department, document.department)) {
    score += 5;
  }

  context.departments.forEach((department) => {
    if (persona.department && includesLoose(persona.department, department)) {
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

function findMatchedKeywords(documentText, personaText, documentDepartment, departments) {
  const candidates = [
    ...IMPORTANT_KEYWORDS,
    ...ACTION_KEYWORDS,
    ...BROAD_TARGET_KEYWORDS,
    ...KNOWN_DEPARTMENTS,
    documentDepartment,
    ...departments
  ].filter(Boolean);
  const matched = new Set();

  candidates.forEach((keyword) => {
    if (includesLoose(documentText, keyword) && includesLoose(personaText, keyword)) {
      matched.add(keyword);
    }
  });

  tokenize(documentText).forEach((token) => {
    if (token.length >= 2 && includesLoose(personaText, token)) {
      matched.add(token);
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
  const before = source.slice(Math.max(0, index - 80), index);
  const after = source.slice(index, Math.min(source.length, index + 100));
  const context = `${before} ${after}`;
  let score = 0;

  if (/제출|회신|등록|신청|참여|진단|응답|납부|보고|검토|처리/.test(context)) score += 6;
  if (/기한|마감|까지|완료|기일|기간/.test(context)) score += 8;
  if (/[~～-]\s*(?:20\d{2}[-.\/년\s]*)?\d{1,2}/.test(before) || /[~～-]/.test(before)) score += 5;
  if (/시행|접수|작성|발송|관련|문서번호|감사관-\d+/.test(context)) score -= 7;
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

module.exports = {
  analyzeDocument
};
