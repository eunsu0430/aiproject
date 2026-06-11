const fs = require('fs');
const path = require('path');

let personaCache = null;

function loadPersonas() {
  if (personaCache) {
    return personaCache;
  }

  const examplesPath = path.join(__dirname, '..', '..', 'persona', 'examples');

  try {
    if (!fs.existsSync(examplesPath)) {
      personaCache = getDefaultPersonas();
      logPersonaLoad(personaCache.length, true);
      return personaCache;
    }

    const files = collectPersonaFiles(examplesPath);
    const personas = files
      .flatMap((filePath) => readPersonasFromFile(filePath, examplesPath))
      .map((persona, index) => normalizePersona(persona, index))
      .filter(Boolean);
    const deduped = dedupePersonas(personas);

    personaCache = deduped.length > 0 ? deduped : getDefaultPersonas();
    logPersonaLoad(personaCache.length, deduped.length === 0);
    return personaCache;
  } catch (error) {
    personaCache = getDefaultPersonas();
    logPersonaLoad(personaCache.length, true);
    return personaCache;
  }
}

function collectPersonaFiles(rootDir) {
  const files = [];

  function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const entryPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(entryPath);
        return;
      }

      if (/\.(json|txt|md)$/i.test(entry.name)) {
        files.push(entryPath);
      }
    });
  }

  walk(rootDir);
  return files;
}

function readPersonasFromFile(filePath, rootDir) {
  const sourceFile = path.relative(rootDir, filePath).replace(/\\/g, '/');

  try {
    const content = fs.readFileSync(filePath, 'utf8');

    if (filePath.toLowerCase().endsWith('.json')) {
      return extractPersonaItems(JSON.parse(content)).map((item) => ({
        ...item,
        sourceFile
      }));
    }

    return [{
      id: sourceFile,
      name: path.basename(filePath, path.extname(filePath)),
      role: path.basename(filePath, path.extname(filePath)),
      department: '',
      content,
      sourceFile
    }];
  } catch (error) {
    return [];
  }
}

function extractPersonaItems(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === 'object') {
    for (const key of ['personas', 'data', 'items', 'examples']) {
      if (Array.isArray(value[key])) {
        return value[key];
      }
    }

    return [value];
  }

  return [];
}

function normalizePersona(persona, index) {
  if (!persona || typeof persona !== 'object') {
    return null;
  }

  const sourceFile = String(persona.sourceFile || '');
  const id = String(persona.id || persona.uuid || persona.nemotron_uuid || `${sourceFile}#${index + 1}`);
  const name = String(persona.name || persona.personaName || persona.title || persona.fileName || `페르소나 ${index + 1}`);
  const role = String(persona.role || persona.grade || persona.occupation || persona.persona_type || name);
  const department = String(persona.department || persona.dept || persona.org || persona.organization || persona.org_type || '');
  const content = buildPersonaContent(persona);

  return {
    id,
    name,
    role,
    department,
    content,
    sourceFile
  };
}

function buildPersonaContent(persona) {
  const parts = [
    persona.content,
    persona.life_persona,
    persona.professional_persona,
    persona.demographic_background,
    persona.career_goals_and_ambitions,
    persona.persona_type,
    persona.occupation,
    persona.grade,
    persona.org,
    persona.org_type,
    Array.isArray(persona.goals) ? persona.goals.join(' ') : '',
    Array.isArray(persona.pain_points) ? persona.pain_points.join(' ') : '',
    Array.isArray(persona.objections) ? persona.objections.join(' ') : ''
  ];

  return parts.filter(Boolean).map(String).join('\n');
}

function dedupePersonas(personas) {
  const seen = new Set();
  const result = [];

  personas.forEach((persona) => {
    const key = persona.id || `${persona.name}|${persona.role}|${persona.department}`;
    const fallbackKey = `${persona.name}|${persona.role}|${persona.department}`;
    const dedupeKey = String(key || fallbackKey).toLowerCase();

    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      result.push(persona);
    }
  });

  return result;
}

function getDefaultPersonas() {
  return [
    {
      id: 'default-clerk',
      name: '서무 담당자',
      role: '서무 담당자',
      department: '공통',
      content: '접수, 배부, 제출기한, 회신 여부를 확인하는 실무 담당자',
      sourceFile: 'fallback'
    },
    {
      id: 'default-team-lead',
      name: '팀장',
      role: '팀장',
      department: '공통',
      content: '부서 대응 방향, 보고 필요성, 일정 위험을 판단하는 팀장',
      sourceFile: 'fallback'
    },
    {
      id: 'default-director',
      name: '부서장',
      role: '부서장',
      department: '공통',
      content: '기관 리스크, 대외 보고, 법정 의무와 책임 소재를 판단하는 부서장',
      sourceFile: 'fallback'
    }
  ];
}

function logPersonaLoad(count, fallback) {
  const mode = fallback ? 'fallback' : 'examples';
  console.log(`[personaLoader] loaded ${count} personas from ${mode}`);
}

module.exports = {
  loadPersonas
};
