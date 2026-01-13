import { getCaseRecipe } from './recipeRegistry';
import { initialDisbursement, initialInstruction, initialReferenceDocument } from '../constants/caseFormDefaults';
import { DEFAULT_AUDIT_AREA, getCaseLevelLabel, normalizeCaseLevel } from '../models/caseConstants';

const ensureArray = (value, fallback) => (Array.isArray(value) && value.length > 0 ? value : fallback);

const formatGenerationStamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

const buildGeneratedCaseName = ({ baseName, caseLevel }) => {
  const levelLabel = getCaseLevelLabel(caseLevel);
  const stamp = formatGenerationStamp();
  return [baseName, levelLabel, stamp].filter(Boolean).join(' · ');
};

export const buildCaseDraftFromRecipe = ({ recipeId, overrides = {} }) => {
  const recipe = getCaseRecipe(recipeId);
  const result = recipe.build({ overrides });

  const disbursements = ensureArray(result.disbursements, [initialDisbursement()]);
  const referenceDocuments = ensureArray(result.referenceDocuments, [initialReferenceDocument()]);
  const instruction = result.instruction || initialInstruction();
  const resolvedCaseLevel = normalizeCaseLevel(
    result?.generationPlan?.caseLevel || result?.caseLevel || overrides?.caseLevel
  );
  const baseCaseName = result.caseName || '';

  return {
    recipeId,
    caseName: buildGeneratedCaseName({ baseName: baseCaseName, caseLevel: resolvedCaseLevel }),
    auditArea: result.auditArea || DEFAULT_AUDIT_AREA,
    layoutType: result.layoutType || 'two_pane',
    layoutConfigRaw: result.layoutConfigRaw || '',
    instruction,
    disbursements,
    referenceDocuments,
    cashContext: result.cashContext || null,
    cashOutstandingItems: result.cashOutstandingItems || null,
    cashCutoffItems: result.cashCutoffItems || null,
    cashRegisterItems: result.cashRegisterItems || null,
    cashReconciliationMap: result.cashReconciliationMap || null,
    faSummary: result.faSummary || null,
    faRisk: result.faRisk || null,
    faAdditions: result.faAdditions || null,
    faDisposals: result.faDisposals || null,
    generationPlan: result.generationPlan || null,
  };
};
