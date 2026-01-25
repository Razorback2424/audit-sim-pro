import { surlSeedAlphaCutoffV1 } from './recipes/surlSeedAlphaCutoffV1';
import { surlIntermediateCutoffV1 } from './recipes/surlIntermediateCutoffV1';
import { surlAdvancedCutoffV1 } from './recipes/surlAdvancedCutoffV1';
import { outstandingCheckTestingBasicV1 } from './recipes/outstandingCheckTestingBasicV1';

const RECIPES = [
  surlSeedAlphaCutoffV1,
  surlIntermediateCutoffV1,
  surlAdvancedCutoffV1,
  outstandingCheckTestingBasicV1,
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
