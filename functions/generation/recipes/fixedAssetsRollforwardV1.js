const { fixedAssetsCoreV1 } = require('./fixedAssetsCoreV1');
const { AUDIT_AREAS } = require('../caseConstants');
const { initialInstruction } = require('../caseFormDefaults');

const fixedAssetsRollforwardV1 = {
  id: 'case.fixed-assets.rollforward.basic.v1',
  version: 1,
  label: 'Fixed Assets Rollforward (Generated)',
  description: 'Build and reconcile the PP&E rollforward before testing.',
  moduleTitle: 'Fixed Assets',
  pathId: 'foundations',
  pathTitle: 'Foundations',
  tier: 'foundations',
  caseLevel: 'basic',
  auditArea: AUDIT_AREAS.FIXED_ASSETS,
  primarySkill: 'PP&E Rollforward',
  layoutType: 'fixed_assets',
  build: ({ overrides } = {}) => {
    const base = fixedAssetsCoreV1.build({ overrides });
    const instruction = {
      ...initialInstruction(),
      title: 'Fixed Assets: Rollforward',
      moduleCode: 'FA-ROLL-101',
      hook: {
        headline: 'You cannot sample from a population that does not tie.',
        risk: 'Rollforward plug risk hides misstatements in additions and disposals.',
        body: 'Foot the rollforward and trace the totals before moving to testing.',
      },
      heuristic: {
        rule_text: 'If TB to rollforward does not reconcile, stop and resolve the difference.',
        reminder: 'A clean rollforward is the gate to every downstream test.',
      },
      gateCheck: {
        question: 'The PP&E rollforward ending balance does not agree to the TB. What do you do?',
        success_message: 'Correct. Resolve the rollforward tie-out before testing.',
        failure_message: 'Do not proceed until the rollforward agrees to the TB and GL.',
        options: [
          {
            id: 'opt1',
            text: 'Pause testing and reconcile the rollforward to the TB/GL.',
            correct: true,
            feedback: 'The population must be complete and accurate before sampling.',
          },
          {
            id: 'opt2',
            text: 'Proceed with testing and note the difference later.',
            correct: false,
            feedback: 'Testing is unreliable if the rollforward does not reconcile.',
          },
        ],
      },
    };

    return {
      ...base,
      caseName: 'Fixed Assets Rollforward',
      instruction,
      fixedAssetWorkflow: {
        steps: ['instruction', 'rollforward', 'results'],
        stepConfig: {
          rollforward: {
            showScoping: false,
            showSubmit: true,
            submitLabel: 'Submit Rollforward',
          },
        },
      },
    };
  },
};

module.exports = { fixedAssetsRollforwardV1 };
