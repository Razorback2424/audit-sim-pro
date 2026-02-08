import React, { useEffect, useMemo, useState } from 'react';
import { useAuth, useRoute, useUser } from '../AppCore';
import { confirmCheckoutSession, fetchUserBilling, isBillingPaid, reconcileBillingAccess } from '../services/billingService';
import { scoreCaseAttempt } from '../services/submissionService';

export default function CheckoutSuccessPage() {
  const { navigate, query } = useRoute();
  const { userId } = useAuth();
  const { billing, loadingBilling } = useUser();
  const hasPaidAccess = isBillingPaid(billing);
  const [confirmError, setConfirmError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [polling, setPolling] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [savingReport, setSavingReport] = useState(false);
  const [reportSaved, setReportSaved] = useState(false);
  const [reportSaveError, setReportSaveError] = useState('');
  const sessionId = useMemo(() => (typeof query?.session_id === 'string' ? query.session_id : ''), [query]);
  const intent = useMemo(
    () => (typeof query?.intent === 'string' ? query.intent.trim().toLowerCase() : ''),
    [query]
  );
  const caseId = useMemo(() => (typeof query?.caseId === 'string' ? query.caseId.trim() : ''), [query]);

  useEffect(() => {
    if (!sessionId || !userId) return;
    let cancelled = false;

    const runConfirm = async () => {
      try {
        setConfirming(true);
        setConfirmError('');
        await confirmCheckoutSession({ sessionId });
      } catch (err) {
        if (cancelled) return;
        setConfirmError('Payment is still processing. We will keep checking for access.');
      } finally {
        if (!cancelled) {
          setConfirming(false);
          setPolling(true);
        }
      }
    };

    runConfirm();
    return () => {
      cancelled = true;
    };
  }, [sessionId, userId]);

  useEffect(() => {
    if (!polling || !userId) return;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 15;
    const intervalMs = 2000;

    const tick = async () => {
      attempts += 1;
      setPollAttempt(attempts);
      try {
        const latest = await fetchUserBilling({ uid: userId });
        if (cancelled) return;
        if (isBillingPaid(latest)) {
          setPolling(false);
          navigate('/trainee?autostart=1');
          return;
        }
      } catch (err) {
        if (!cancelled) {
          setConfirmError('Payment is still processing. We will keep checking for access.');
        }
      }

      if (attempts >= maxAttempts && !cancelled) {
        setPolling(false);
        setPollTimedOut(true);
      }
    };

    const interval = setInterval(tick, intervalMs);
    tick();

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [polling, userId, navigate]);

  useEffect(() => {
    if (hasPaidAccess && intent !== 'save-report') {
      navigate('/trainee?autostart=1');
    }
  }, [hasPaidAccess, intent, navigate]);

  useEffect(() => {
    if (!hasPaidAccess || intent !== 'save-report' || !caseId || reportSaved || savingReport) return;
    let active = true;
    const key = `pending_report_${caseId}`;
    const runSave = async () => {
      try {
        setSavingReport(true);
        setReportSaveError('');
        const raw = window?.localStorage?.getItem(key);
        if (!raw) {
          setReportSaveError('We could not find a pending report to save.');
          return;
        }
        const parsed = JSON.parse(raw);
        if (!parsed?.submission || parsed?.caseId !== caseId) {
          setReportSaveError('We could not find a pending report to save.');
          return;
        }
        await scoreCaseAttempt({ caseId, submission: parsed.submission });
        if (!active) return;
        setReportSaved(true);
        window.localStorage.removeItem(key);
      } catch (err) {
        if (!active) return;
        setReportSaveError('We could not save your report yet. You can try again.');
      } finally {
        if (active) setSavingReport(false);
      }
    };
    runSave();
    return () => {
      active = false;
    };
  }, [hasPaidAccess, intent, caseId, reportSaved, savingReport]);

  const handleRestoreAccess = async () => {
    if (!sessionId || !userId) return;
    setConfirmError('');
    setPollTimedOut(false);
    setPolling(false);
    setConfirming(true);
    try {
      await confirmCheckoutSession({ sessionId });
      await reconcileBillingAccess({});
      const latest = await fetchUserBilling({ uid: userId });
      if (isBillingPaid(latest)) {
        navigate('/trainee?autostart=1');
        return;
      }
      setPolling(true);
    } catch (err) {
      setConfirmError('Payment is still processing. We will keep checking for access.');
      setPolling(true);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center px-6">
      <div className="max-w-xl text-center">
        <h1 className="text-3xl font-bold text-white mb-4">
          {intent === 'save-report' ? (reportSaved ? 'Report saved' : 'Saving your report') : 'You’re in'}
        </h1>
        <p className="text-slate-400 mb-6">
          {intent === 'save-report'
            ? reportSaved
              ? 'Your report is saved and ready to view.'
              : 'Finalizing your report and unlocking access now.'
            : 'Your payment is complete. You can start the simulations right away.'}
        </p>
        {!sessionId ? (
          <p className="text-sm text-amber-300">Missing checkout session. Please refresh or contact support.</p>
        ) : null}
        {confirming || loadingBilling || polling ? (
          <p className="text-sm text-slate-400">
            {confirming ? 'Confirming your payment…' : 'Unlocking your access…'}
            {polling ? ` (check ${pollAttempt + 1})` : ''}
          </p>
        ) : null}
        {confirmError ? <p className="text-sm text-amber-300 mt-2">{confirmError}</p> : null}
        {reportSaveError ? <p className="text-sm text-amber-300 mt-2">{reportSaveError}</p> : null}
        {pollTimedOut ? (
          <p className="text-sm text-amber-300 mt-2">
            We’re still waiting for Stripe to confirm. Please refresh in a moment if access is still locked.
          </p>
        ) : null}
        {!hasPaidAccess && (pollTimedOut || confirmError) ? (
          <button
            onClick={handleRestoreAccess}
            className="mt-4 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
            disabled={confirming || polling}
          >
            Restore access
          </button>
        ) : null}
        <div className="mt-4 flex flex-col sm:flex-row gap-3 justify-center">
          {intent === 'save-report' ? (
            <button
              onClick={() => navigate('/trainee/submission-history')}
              disabled={!hasPaidAccess || savingReport || !reportSaved}
              className="bg-slate-800 hover:bg-slate-700 text-white px-6 py-3 rounded-lg text-sm font-semibold disabled:opacity-60"
            >
              View report
            </button>
          ) : null}
          <button
            onClick={() => navigate('/trainee?autostart=1')}
            disabled={!hasPaidAccess}
            className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-lg text-sm font-semibold disabled:opacity-60"
          >
            Continue to next case
          </button>
        </div>
      </div>
    </div>
  );
}
