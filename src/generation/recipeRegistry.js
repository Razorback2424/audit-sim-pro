import { surlSeedAlphaCutoffV1 } from './recipes/surlSeedAlphaCutoffV1';
import { surlIntermediateCutoffV1 } from './recipes/surlIntermediateCutoffV1';
import { surlAdvancedCutoffV1 } from './recipes/surlAdvancedCutoffV1';
import { outstandingCheckTestingBasicV1 } from './recipes/outstandingCheckTestingBasicV1';
import { fixedAssetsCoreV1 } from './recipes/fixedAssetsCoreV1';
import { fixedAssetsRollforwardV1 } from './recipes/fixedAssetsRollforwardV1';
import { fixedAssetsScopingV1 } from './recipes/fixedAssetsScopingV1';
import { fixedAssetsAdditionsV1 } from './recipes/fixedAssetsAdditionsV1';
import { fixedAssetsDisposalsV1 } from './recipes/fixedAssetsDisposalsV1';
import { fixedAssetsAnalyticsV1 } from './recipes/fixedAssetsAnalyticsV1';

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

export const listCaseRecipes = () =>
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

export const getCaseRecipe = (recipeId) => {
  const match = RECIPES.find((recipe) => recipe.id === recipeId);
  if (!match) {
    throw new Error(`Unknown case recipe: ${recipeId}`);
  }
  return match;
};
