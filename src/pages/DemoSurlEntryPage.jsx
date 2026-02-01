import React, { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import TraineeCaseViewPage from './TraineeCaseViewPage';
import { useRoute } from '../AppCore';
import { trackAnalyticsEvent } from '../services/analyticsService';

const getDemoCaseId = (value) => (typeof value === 'string' ? value.trim() : '');

export default function DemoSurlEntryPage() {
  const navigate = useNavigate();
  const { query } = useRoute();
  const demoCaseId = useMemo(() => {
    const fromQuery = getDemoCaseId(query?.caseId);
    const fromEnv = getDemoCaseId(process.env.REACT_APP_DEMO_SURL_CASE_ID);
    return fromQuery || fromEnv;
  }, [query]);

  useEffect(() => {
    trackAnalyticsEvent({ eventType: 'demo_started', metadata: { caseId: demoCaseId || null } });
  }, [demoCaseId]);

  if (!demoCaseId) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center px-6">
        <div className="max-w-xl text-center">
          <h1 className="text-3xl font-bold text-white mb-4">Demo not configured yet</h1>
          <p className="text-slate-400 mb-6">
            Set <span className="text-white">REACT_APP_DEMO_SURL_CASE_ID</span> to a public SURL case ID, or pass a
            <span className="text-white"> caseId</span> query param to this URL.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => navigate('/')}
              className="bg-slate-800 hover:bg-slate-700 text-white px-5 py-2 rounded-lg text-sm font-medium"
            >
              Back to landing
            </button>
            <button
              onClick={() => navigate('/register')}
              className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg text-sm font-medium"
            >
              Create an account
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <TraineeCaseViewPage params={{ caseId: demoCaseId }} demoMode />;
}
