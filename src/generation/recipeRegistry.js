import { surlPromotadorCutoffV1 } from './recipes/surlPromotadorCutoffV1';

const RECIPES = [surlPromotadorCutoffV1];

export const listCaseRecipes = () => RECIPES.map(({ id, label, description }) => ({ id, label, description }));

export const getCaseRecipe = (recipeId) => {
  const match = RECIPES.find((recipe) => recipe.id === recipeId);
  if (!match) {
    throw new Error(`Unknown case recipe: ${recipeId}`);
  }
  return match;
};
