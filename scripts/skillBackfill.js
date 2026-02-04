/**
 * Helpers to normalize legacy skill labels for recipes and cases.
 * These functions do not write data; they only build update payloads.
 */
const toTrimmedString = (value) => {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
};

const normalizePrimarySkill = (value, { moduleId, moduleTitle, title, caseName }) => {
  const skill = toTrimmedString(value);
  const label = `${toTrimmedString(moduleTitle || title || caseName)} ${toTrimmedString(moduleId)}`.trim();
  const isSurl = /surl/i.test(label);
  if ((!skill || skill.toLowerCase() === 'cutoff') && isSurl) {
    return 'SURL';
  }
  return skill;
};

export const buildRecipeSkillBackfill = (recipeDoc) => {
  if (!recipeDoc) return null;
  const nextSkill = normalizePrimarySkill(recipeDoc.primarySkill, {
    moduleId: recipeDoc.moduleId || recipeDoc.id,
    moduleTitle: recipeDoc.moduleTitle,
    title: recipeDoc.title,
  });
  if (nextSkill === toTrimmedString(recipeDoc.primarySkill)) return null;
  return { id: recipeDoc.id, updates: { primarySkill: nextSkill } };
};

export const buildCaseSkillBackfill = (caseDoc) => {
  if (!caseDoc) return null;
  const nextSkill = normalizePrimarySkill(caseDoc.primarySkill, {
    moduleId: caseDoc.moduleId,
    moduleTitle: caseDoc.moduleTitle,
    title: caseDoc.title,
    caseName: caseDoc.caseName,
  });
  if (nextSkill === toTrimmedString(caseDoc.primarySkill)) return null;
  return { id: caseDoc.id, updates: { primarySkill: nextSkill } };
};

export const buildSkillBackfillPlan = ({ recipes = [], cases = [] } = {}) => {
  return {
    recipes: recipes.map(buildRecipeSkillBackfill).filter(Boolean),
    cases: cases.map(buildCaseSkillBackfill).filter(Boolean),
  };
};
