import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TraineeCaseViewPage from './TraineeCaseViewPage';
import { useRoute } from '../AppCore';
import { fetchDemoConfig } from '../services/demoService';

const getDemoCaseId = (value) => (typeof value === 'string' ? value.trim() : '');

export default function DemoSurlEntryPage() {
  const navigate = useNavigate();
  const { query } = useRoute();
  const [resolvedCaseId, setResolvedCaseId] = useState('');
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loadError, setLoadError] = useState('');

  const queryCaseId = useMemo(() => getDemoCaseId(query?.caseId), [query]);
  const envCaseId = useMemo(() => getDemoCaseId(process.env.REACT_APP_DEMO_SURL_CASE_ID), []);

  useEffect(() => {
    let active = true;
    setLoadError('');
    if (queryCaseId) {
      setResolvedCaseId(queryCaseId);
      return () => {
        active = false;
      };
    }
    if (envCaseId) {
      setResolvedCaseId(envCaseId);
      return () => {
        active = false;
      };
    }
    setLoadingConfig(true);
    fetchDemoConfig()
      .then((config) => {
        if (!active) return;
        const configuredId = getDemoCaseId(config?.caseId);
        setResolvedCaseId(configuredId);
        setLoadingConfig(false);
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(err?.message || 'Unable to load demo configuration.');
        setLoadingConfig(false);
      });
    return () => {
      active = false;
    };
  }, [queryCaseId, envCaseId]);

  if (!resolvedCaseId) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center px-6">
        <div className="max-w-xl text-center">
          <h1 className="text-3xl font-bold text-white mb-4">Demo not configured yet</h1>
          <p className="text-slate-400 mb-4">
            Set <span className="text-white">REACT_APP_DEMO_SURL_CASE_ID</span> to a public SURL case ID, or pass a
            <span className="text-white"> caseId</span> query param to this URL.
          </p>
          {loadingConfig ? (
            <p className="text-sm text-slate-500 mb-4">Checking demo configuration…</p>
          ) : null}
          {loadError ? (
            <p className="text-sm text-rose-300 mb-4">{loadError}</p>
          ) : null}
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

  return <TraineeCaseViewPage params={{ caseId: resolvedCaseId }} demoMode />;
}
