import { fixedAssetsCoreV1 } from './fixedAssetsCoreV1';
import { AUDIT_AREAS } from '../../models/caseConstants';
import { initialInstruction } from '../../constants/caseFormDefaults';

export const fixedAssetsAnalyticsV1 = {
  id: 'case.fixed-assets.analytics.basic.v1',
  version: 1,
  label: 'Fixed Assets Depreciation Analytics (Generated)',
  description: 'Perform reasonableness analytics on depreciation.',
  moduleTitle: 'Fixed Assets',
  pathId: 'foundations',
  pathTitle: 'Foundations',
  tier: 'foundations',
  caseLevel: 'basic',
  auditArea: AUDIT_AREAS.FIXED_ASSETS,
  primarySkill: 'Depreciation Analytics',
  layoutType: 'fixed_assets',
  build: ({ overrides } = {}) => {
    const base = fixedAssetsCoreV1.build({ overrides });
    const instruction = {
      ...initialInstruction(),
      title: 'Fixed Assets: Depreciation Analytics',
      moduleCode: 'FA-ANL-101',
      hook: {
        headline: 'Depreciation should behave logically year over year.',
        risk: 'Misstated useful lives or missing assets distort expense and A/D.',
        body: 'Run reasonableness analytics and reconcile the A/D rollforward.',
      },
      heuristic: {
        rule_text: 'Use simple ratios and rollforward logic to test reasonableness.',
        reminder: 'Beg A/D + depreciation - disposals should equal ending A/D.',
      },
      gateCheck: {
        question: 'What is a baseline reasonableness check for depreciation expense?',
        success_message: 'Correct. Compare depreciation to average gross PP&E or expected rates.',
        failure_message: 'You need an expectation based on gross PP&E and useful lives.',
        options: [
          {
            id: 'opt1',
            text: 'Depreciation expense divided by average gross PP&E',
            correct: true,
            feedback: 'This is a common analytic to assess reasonableness.',
          },
          {
            id: 'opt2',
            text: 'Compare cash receipts to depreciation expense',
            correct: false,
            feedback: 'Cash receipts are unrelated to depreciation expense.',
          },
        ],
      },
    };

    return {
      ...base,
      caseName: 'Fixed Assets Depreciation Analytics',
      instruction,
      fixedAssetWorkflow: {
        steps: ['instruction', 'analytics', 'results'],
        stepConfig: {
          analytics: {
            submitLabel: 'Submit Analytics',
            visibleSections: {
              scopingSummary: false,
              leadSchedule: false,
              strategy: false,
              policy: false,
              evidence: false,
              additions: false,
              disposals: false,
              analytics: true,
              submit: true,
            },
          },
        },
      },
    };
  },
};
