const { fixedAssetsCoreV1 } = require('./fixedAssetsCoreV1');
const { AUDIT_AREAS } = require('../caseConstants');
const { initialInstruction } = require('../caseFormDefaults');

const fixedAssetsAdditionsV1 = {
  id: 'case.fixed-assets.additions.basic.v1',
  version: 1,
  label: 'Fixed Assets Additions Testing (Generated)',
  description: 'Vouch fixed asset additions to vendor support.',
  moduleTitle: 'Fixed Assets',
  pathId: 'foundations',
  pathTitle: 'Foundations',
  tier: 'foundations',
  caseLevel: 'basic',
  auditArea: AUDIT_AREAS.FIXED_ASSETS,
  primarySkill: 'Fixed Asset Additions',
  layoutType: 'fixed_assets',
  build: ({ overrides } = {}) => {
    const base = fixedAssetsCoreV1.build({ overrides });
    const instruction = {
      ...initialInstruction(),
      title: 'Fixed Assets: Additions Testing',
      moduleCode: 'FA-ADD-101',
      hook: {
        headline: 'Each addition is a claim: prove it happened, for the right amount, in the right period.',
        risk: 'Unsupported or misclassified additions inflate assets and understate expenses.',
        body: 'Vouch recorded additions to invoices, payment, and receiving evidence.',
      },
      heuristic: {
        rule_text: 'Ask: what is it, why is it an asset, how much, and when in service?',
        reminder: 'Invoice and receiving evidence should match the listing line.',
      },
      gateCheck: {
        question: 'Which document is the primary third-party support for a fixed asset addition?',
        success_message: 'Correct. The vendor invoice is the primary support for cost and occurrence.',
        failure_message: 'Payment or internal docs are corroborative; the invoice is primary support.',
        options: [
          {
            id: 'opt1',
            text: 'Vendor invoice or purchase agreement',
            correct: true,
            feedback: 'This confirms the purchase and the cost basis.',
          },
          {
            id: 'opt2',
            text: 'Internal capitalization memo only',
            correct: false,
            feedback: 'Internal memos are not primary third-party support.',
          },
        ],
      },
    };

    return {
      ...base,
      caseName: 'Fixed Assets Additions Testing',
      instruction,
      fixedAssetWorkflow: {
        steps: ['instruction', 'additions', 'results'],
        stepConfig: {
          additions: {
            submitLabel: 'Submit Additions Testing',
            visibleSections: {
              scopingSummary: false,
              leadSchedule: false,
              strategy: false,
              policy: true,
              evidence: true,
              additions: true,
              disposals: false,
              analytics: false,
              submit: true,
            },
          },
        },
      },
    };
  },
};

module.exports = { fixedAssetsAdditionsV1 };
