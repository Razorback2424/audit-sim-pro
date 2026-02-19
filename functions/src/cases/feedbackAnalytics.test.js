const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFeedbackSignalProps } = require('./feedbackAnalytics');

test('buildFeedbackSignalProps returns category and severity rollups', () => {
  const feedback = [
    {
      paymentId: 'P-1',
      notes: [
        'Documentation Deficiency: Missing rationale for exception.',
        'Review Note: Verify supporting evidence tie-out.',
      ],
    },
    {
      paymentId: 'P-2',
      notes: ['Bank Rec Mismatch: Expected improperlyExcluded based on scenario.'],
    },
  ];

  const result = buildFeedbackSignalProps(feedback);

  assert.equal(result.noteCount, 3);
  assert.equal(result.categoriesCount, 3);
  assert.equal(result.categoryCounts['Documentation Deficiency'], 1);
  assert.equal(result.categoryCounts['Review Note'], 1);
  assert.equal(result.categoryCounts['Bank Rec Mismatch'], 1);
  assert.equal(result.severityCounts.high, 2);
  assert.equal(result.severityCounts.medium, 1);
  assert.equal(result.topSeverity, 'high');
});

test('buildFeedbackSignalProps handles empty feedback safely', () => {
  const result = buildFeedbackSignalProps(null);
  assert.equal(result.noteCount, 0);
  assert.equal(result.categoriesCount, 0);
  assert.deepEqual(result.categoryCounts, {});
  assert.deepEqual(result.severityCounts, { high: 0, medium: 0, low: 0 });
});
