const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const FUNCTIONS_SHARED_DIR = path.join(ROOT_DIR, 'functions', 'generation', 'shared');
const SRC_SHARED_DIR = path.join(ROOT_DIR, 'src', 'shared', 'generation');

const HEADER = '// AUTO-GENERATED from functions/generation/shared. Do not edit directly.\n';

const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });

const transformCjsToEsm = (content, replacements = []) => {
  let next = content;
  replacements.forEach(([from, to]) => {
    next = next.replace(from, to);
  });
  next = next.replace(/module\.exports\s*=\s*{/g, 'export {');
  return next;
};

const writeFile = (destPath, content) => {
  fs.writeFileSync(destPath, `${HEADER}${content.trim()}\n`);
};

const syncSharedFile = ({ sourceFile, destFile, replacements = [] }) => {
  const sourcePath = path.join(FUNCTIONS_SHARED_DIR, sourceFile);
  const destPath = path.join(SRC_SHARED_DIR, destFile);
  const content = fs.readFileSync(sourcePath, 'utf8');
  const esm = transformCjsToEsm(content, replacements);
  writeFile(destPath, esm);
};

const syncRecipeDisplay = () => {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const { listCaseRecipes } = require(path.join(ROOT_DIR, 'functions', 'generation', 'recipeRegistry'));
  const recipes = listCaseRecipes();
  const serialized = JSON.stringify(recipes, null, 2);
  const body = `const RECIPES = Object.freeze(${serialized});\n\n` +
    `export const listCaseRecipes = () => RECIPES.map((recipe) => ({ ...recipe }));\n\n` +
    `export const getCaseRecipe = (recipeId) => {\n` +
    `  const match = RECIPES.find((recipe) => recipe.id === recipeId);\n` +
    `  if (!match) {\n` +
    `    throw new Error('Unknown case recipe: ' + recipeId);\n` +
    `  }\n` +
    `  return match;\n` +
    `};\n\n` +
    `export { RECIPES };\n`;
  writeFile(path.join(SRC_SHARED_DIR, 'recipeDisplay.js'), body);
};

const main = () => {
  ensureDir(SRC_SHARED_DIR);

  syncSharedFile({
    sourceFile: 'caseConstants.js',
    destFile: 'caseConstants.js',
  });

  syncSharedFile({
    sourceFile: 'caseFormHelpers.js',
    destFile: 'caseFormHelpers.js',
  });

  syncSharedFile({
    sourceFile: 'caseFormDefaults.js',
    destFile: 'caseFormDefaults.js',
    replacements: [
      [
        "const { getUUID } = require('../getUUID');",
        "import getUUID from '../../utils/getUUID';",
      ],
      [
        "const { DEFAULT_ANSWER_KEY_CLASSIFICATION, buildSingleAnswerKey } = require('./caseFormHelpers');",
        "import { DEFAULT_ANSWER_KEY_CLASSIFICATION, buildSingleAnswerKey } from './caseFormHelpers';",
      ],
    ],
  });

  syncRecipeDisplay();
};

main();
