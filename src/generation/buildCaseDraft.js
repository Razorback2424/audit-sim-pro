import { getCaseRecipe } from './recipeRegistry';
import { initialDisbursement, initialInstruction, initialReferenceDocument } from '../constants/caseFormDefaults';
import { DEFAULT_AUDIT_AREA } from '../models/caseConstants';

const ensureArray = (value, fallback) => (Array.isArray(value) && value.length > 0 ? value : fallback);

export const buildCaseDraftFromRecipe = ({ recipeId, overrides = {} }) => {
  const recipe = getCaseRecipe(recipeId);
  const result = recipe.build({ overrides });

  const disbursements = ensureArray(result.disbursements, [initialDisbursement()]);
  const referenceDocuments = ensureArray(result.referenceDocuments, [initialReferenceDocument()]);
  const instruction = result.instruction || initialInstruction();

  return {
    recipeId,
    caseName: result.caseName || '',
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
