const { surlSeedAlphaCutoffV1 } = require('./recipes/surlSeedAlphaCutoffV1');
const { surlIntermediateCutoffV1 } = require('./recipes/surlIntermediateCutoffV1');
const { surlAdvancedCutoffV1 } = require('./recipes/surlAdvancedCutoffV1');
const { outstandingCheckTestingBasicV1 } = require('./recipes/outstandingCheckTestingBasicV1');
const { fixedAssetsCoreV1 } = require('./recipes/fixedAssetsCoreV1');
const { fixedAssetsRollforwardV1 } = require('./recipes/fixedAssetsRollforwardV1');
const { fixedAssetsScopingV1 } = require('./recipes/fixedAssetsScopingV1');
const { fixedAssetsAdditionsV1 } = require('./recipes/fixedAssetsAdditionsV1');
const { fixedAssetsDisposalsV1 } = require('./recipes/fixedAssetsDisposalsV1');
const { fixedAssetsAnalyticsV1 } = require('./recipes/fixedAssetsAnalyticsV1');

const RECIPES = [
  surlSeedAlphaCutoffV1,
  surlIntermediateCutoffV1,
  surlAdvancedCutoffV1,
  outstandingCheckTestingBasicV1,
  fixedAssetsCoreV1,
  fixedAssetsRollforwardV1,
  fixedAssetsScopingV1,
  fixedAssetsAdditionsV1,
  fixedAssetsDisposalsV1,
  fixedAssetsAnalyticsV1,
];

const listCaseRecipes = () =>
  RECIPES.map((recipe) => ({
    id: recipe.id,
    label: recipe.label,
    description: recipe.description,
    moduleTitle: recipe.moduleTitle || recipe.label,
    pathId: recipe.pathId || '',
    tier: recipe.tier || 'foundations',
    auditArea: recipe.auditArea || '',
    primarySkill: recipe.primarySkill || '',
    caseLevel: recipe.caseLevel || '',
    version: Number.isFinite(Number(recipe.version)) ? Number(recipe.version) : 1,
  }));

const getCaseRecipe = (recipeId) => {
  const match = RECIPES.find((recipe) => recipe.id === recipeId);
  if (!match) {
    throw new Error(`Unknown case recipe: ${recipeId}`);
  }
  return match;
};

module.exports = { listCaseRecipes, getCaseRecipe };
