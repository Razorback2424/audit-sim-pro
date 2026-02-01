import { fixedAssetsCoreV1 } from './fixedAssetsCoreV1';
import { AUDIT_AREAS } from '../../models/caseConstants';
import { initialInstruction } from '../../constants/caseFormDefaults';

export const fixedAssetsScopingV1 = {
  id: 'case.fixed-assets.scoping.basic.v1',
  version: 1,
  label: 'Fixed Assets Scoping (Generated)',
  description: 'Determine testing scope based on risk and materiality.',
  moduleTitle: 'Fixed Assets',
  pathId: 'foundations',
  pathTitle: 'Foundations',
  tier: 'foundations',
  caseLevel: 'basic',
  auditArea: AUDIT_AREAS.FIXED_ASSETS,
  primarySkill: 'Fixed Asset Scoping',
  layoutType: 'fixed_assets',
  build: ({ overrides } = {}) => {
    const base = fixedAssetsCoreV1.build({ overrides });
    const instruction = {
      ...initialInstruction(),
      title: 'Fixed Assets: Scoping',
      moduleCode: 'FA-SCOPE-101',
      hook: {
        headline: 'Scope is a judgment call, not a checkbox.',
        risk: 'Over-testing wastes hours; under-testing misses misstatements.',
        body: 'Use tolerable misstatement and risk to decide how much testing is required.',
      },
      heuristic: {
        rule_text: 'When additions exceed TM, testing is expected unless you document a rationale.',
        reminder: 'Your scope should be clear enough to defend in 30 seconds.',
      },
      gateCheck: {
        question: 'Total additions exceed TM. What is the default response?',
        success_message: 'Correct. Testing is expected when additions exceed TM.',
        failure_message: 'Default is to test when additions exceed TM unless a justified exception exists.',
        options: [
          {
            id: 'opt1',
            text: 'Plan testing and document the selection approach.',
            correct: true,
            feedback: 'When additions exceed TM, testing is expected.',
          },
          {
            id: 'opt2',
            text: 'Skip testing because the rollforward ties.',
            correct: false,
            feedback: 'A tied rollforward does not remove the need for testing.',
          },
        ],
      },
    };

    return {
      ...base,
      caseName: 'Fixed Assets Scoping',
      instruction,
      fixedAssetWorkflow: {
        steps: ['instruction', 'scoping', 'results'],
        submitLabels: {
          scoping: 'Submit Scoping Decision',
        },
      },
    };
  },
};
