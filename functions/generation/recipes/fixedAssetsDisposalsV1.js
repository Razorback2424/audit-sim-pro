const { fixedAssetsCoreV1 } = require('./fixedAssetsCoreV1');
const { AUDIT_AREAS } = require('../shared/caseConstants');
const { initialInstruction } = require('../shared/caseFormDefaults');

const fixedAssetsDisposalsV1 = {
  id: 'case.fixed-assets.disposals.basic.v1',
  version: 1,
  label: 'Fixed Assets Disposals Testing (Generated)',
  description: 'Validate disposals and gain/loss accounting.',
  moduleTitle: 'Fixed Assets',
  pathId: 'foundations',
  pathTitle: 'Foundations',
  tier: 'foundations',
  caseLevel: 'basic',
  auditArea: AUDIT_AREAS.FIXED_ASSETS,
  primarySkill: 'Fixed Asset Disposals',
  layoutType: 'fixed_assets',
  build: ({ overrides } = {}) => {
    const base = fixedAssetsCoreV1.build({ overrides });
    const instruction = {
      ...initialInstruction(),
      title: 'Fixed Assets: Disposals Testing',
      moduleCode: 'FA-DISP-101',
      hook: {
        headline: 'Disposed assets should leave the books and the gain or loss should make sense.',
        risk: 'Ghost assets or misclassified gains distort PP&E and income.',
        body: 'Vouch disposals to support and recompute gain/loss.',
      },
      heuristic: {
        rule_text: 'Prove the disposal event and verify cost and A/D removal.',
        reminder: 'Check proceeds and recompute gain or loss.',
      },
      gateCheck: {
        question: 'Which check best confirms a disposal was recorded correctly?',
        success_message: 'Correct. Support the disposal event and removal of cost and A/D.',
        failure_message: 'You need evidence of the disposal and the accounting entry.',
        options: [
          {
            id: 'opt1',
            text: 'Sale or retirement documentation plus cost and A/D removal',
            correct: true,
            feedback: 'Both the event and the accounting entry must be supported.',
          },
          {
            id: 'opt2',
            text: 'Only the new asset purchase invoice',
            correct: false,
            feedback: 'An addition does not prove the disposal entry is correct.',
          },
        ],
      },
    };

    return {
      ...base,
      caseName: 'Fixed Assets Disposals Testing',
      instruction,
      fixedAssetWorkflow: {
        steps: ['instruction', 'disposals', 'results'],
        stepConfig: {
          disposals: {
            submitLabel: 'Submit Disposals Testing',
            visibleSections: {
              scopingSummary: false,
              leadSchedule: false,
              strategy: false,
              policy: true,
              evidence: true,
              additions: false,
              disposals: true,
              analytics: false,
              submit: true,
            },
          },
        },
      },
    };
  },
};

module.exports = { fixedAssetsDisposalsV1 };
