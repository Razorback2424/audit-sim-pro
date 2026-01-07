import { getLatestAttempt } from '../TraineeSubmissionHistoryPage';

const makeDate = (iso) => new Date(iso);

describe('getLatestAttempt', () => {
  it('prefers updatedAt and createdAt when submittedAt is missing', () => {
    const attempts = [
      { id: 'a', updatedAt: makeDate('2024-01-01T00:00:00Z') },
      { id: 'b', createdAt: makeDate('2024-02-01T00:00:00Z') },
      { id: 'c', updatedAt: makeDate('2024-03-01T00:00:00Z') },
    ];

    expect(getLatestAttempt(attempts)).toBe(attempts[2]);
  });

  it('breaks ties on identical submittedAt values by choosing the last attempt', () => {
    const sharedTimestamp = makeDate('2024-04-01T12:00:00Z');
    const attempts = [
      { id: 'first', submittedAt: sharedTimestamp },
      { id: 'second', submittedAt: sharedTimestamp },
      { id: 'third', submittedAt: sharedTimestamp },
    ];

    expect(getLatestAttempt(attempts)).toBe(attempts[2]);
  });

  it('prefers submitted attempts over in-progress ones and falls back through timestamp fields', () => {
    const attempts = [
      { id: 'in-progress', state: 'in_progress', submittedAt: makeDate('2024-06-01T00:00:00Z') },
      { id: 'submitted', submittedAt: makeDate('2024-05-01T00:00:00Z') },
      { id: 'updated-only', updatedAt: makeDate('2024-07-01T00:00:00Z') },
      { id: 'created-only', createdAt: makeDate('2024-08-01T00:00:00Z') },
    ];

    expect(getLatestAttempt(attempts)).toBe(attempts[1]);
  });
});
