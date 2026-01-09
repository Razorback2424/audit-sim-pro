import { fetchCaseGenerationPlan } from './caseGenerationService';
import { doc, getDoc } from 'firebase/firestore';

jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  getDoc: jest.fn(),
  serverTimestamp: jest.fn(() => 'serverTimestamp'),
}));

jest.mock('./firebase', () => ({
  db: {},
  functions: {},
  FirestorePaths: {
    CASE_GENERATION_PLAN_DOCUMENT: (caseId) => `case_generation_plans/${caseId}`,
  },
}));

describe('caseGenerationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('fetchCaseGenerationPlan returns lastJob even when plan is missing', async () => {
    doc.mockReturnValue({ path: 'case_generation_plans/case-1' });
    getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        lastJob: { status: 'queued', jobId: 'job-1' },
      }),
    });

    const result = await fetchCaseGenerationPlan({ caseId: 'case-1' });
    expect(doc).toHaveBeenCalledWith({}, 'case_generation_plans/case-1');
    expect(result).toEqual({
      referenceDocumentSpecs: [],
      lastJob: { status: 'queued', jobId: 'job-1' },
    });
  });

  test('fetchCaseGenerationPlan returns plan data with lastJob when available', async () => {
    doc.mockReturnValue({ path: 'case_generation_plans/case-2' });
    getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        plan: { referenceDocumentSpecs: [{ id: 'spec-1' }], yearEnd: '20X2-12-31' },
        lastJob: { status: 'completed', jobId: 'job-2' },
      }),
    });

    const result = await fetchCaseGenerationPlan({ caseId: 'case-2' });
    expect(result).toEqual({
      referenceDocumentSpecs: [{ id: 'spec-1' }],
      yearEnd: '20X2-12-31',
      lastJob: { status: 'completed', jobId: 'job-2' },
    });
  });
});
