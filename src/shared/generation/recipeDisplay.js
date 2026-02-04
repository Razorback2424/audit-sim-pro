// AUTO-GENERATED from functions/generation/shared. Do not edit directly.
const RECIPES = Object.freeze([
  {
    "id": "case.surl.seed.alpha.v1",
    "label": "SURL Cutoff (Generated)",
    "description": "Unrecorded liability trap with post-close disbursements and service-date cutoff.",
    "moduleTitle": "SURL",
    "pathId": "foundations",
    "tier": "foundations",
    "auditArea": "payables",
    "primarySkill": "SURL",
    "caseLevel": "basic",
    "version": 1
  },
  {
    "id": "case.surl.intermediate.v1",
    "label": "SURL Intermediate Cutoff (Generated)",
    "description": "Intermediate SURL with tie-out gate, scoped selection, and allocation trap.",
    "moduleTitle": "SURL",
    "pathId": "foundations",
    "tier": "foundations",
    "auditArea": "payables",
    "primarySkill": "SURL",
    "caseLevel": "intermediate",
    "version": 1
  },
  {
    "id": "case.surl.advanced.v1",
    "label": "SURL Advanced Cutoff (Generated)",
    "description": "Advanced SURL with tie-out gate, scoped selection, and allocation trap.",
    "moduleTitle": "SURL",
    "pathId": "foundations",
    "tier": "advanced",
    "auditArea": "payables",
    "primarySkill": "SURL",
    "caseLevel": "advanced",
    "version": 1
  },
  {
    "id": "case.cash.outstanding-check.basic.v1",
    "label": "Outstanding Check Testing (Generated)",
    "description": "Reverse-direction cutoff testing with December-written checks clearing in January.",
    "moduleTitle": "Cash",
    "pathId": "foundations",
    "tier": "foundations",
    "auditArea": "cash",
    "primarySkill": "Outstanding Check Testing",
    "caseLevel": "basic",
    "version": 1
  },
  {
    "id": "case.fixed-assets.core.v1",
    "label": "Fixed Assets Core (Generated)",
    "description": "PP&E rollforward tie-out, scoping, additions, disposals, and analytics.",
    "moduleTitle": "Fixed Assets",
    "pathId": "foundations",
    "tier": "foundations",
    "auditArea": "fixed_assets",
    "primarySkill": "Fixed Assets",
    "caseLevel": "basic",
    "version": 2
  }
]);

export const listCaseRecipes = () => RECIPES.map((recipe) => ({ ...recipe }));

export const getCaseRecipe = (recipeId) => {
  const match = RECIPES.find((recipe) => recipe.id === recipeId);
  if (!match) {
    throw new Error('Unknown case recipe: ' + recipeId);
  }
  return match;
};

export { RECIPES };
