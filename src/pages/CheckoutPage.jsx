import React, { useEffect, useMemo, useState } from 'react';
import { useAuth, useModal, useRoute } from '../AppCore';
import ReportProblemModal from '../components/ReportProblemModal';
import { createCheckoutSession, fetchPaymentsCapability } from '../services/billingService';
import { scoreCaseAttempt } from '../services/submissionService';
import { trackAnalyticsEvent } from '../services/analyticsService';

const PLAN_LABELS = {
  individual: 'Individual Auditor Access (Monthly)',
  individual_annual: 'Individual Auditor Access (Annual)',
};

const PLAN_DETAILS = {
  individual: {
    price: '$39/month',
    terms: 'Cancel anytime.',
    includes: ['All simulator modules', 'Virtual Senior feedback', 'Progress tracking'],
  },
  individual_annual: {
    price: '$299/year',
    terms: 'Billed annually.',
    includes: ['All simulator modules', 'Virtual Senior feedback', 'Progress tracking'],
  },
};

const normalizePlan = (value) => {
  if (typeof value !== 'string') return 'individual';
  const trimmed = value.trim().toLowerCase();
  return PLAN_LABELS[trimmed] ? trimmed : 'individual';
};

export default function CheckoutPage() {
  const { currentUser } = useAuth();
  const { showModal } = useModal();
  const { navigate, query } = useRoute();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [paymentsEnabled, setPaymentsEnabled] = useState(true);
  const [paymentsReason, setPaymentsReason] = useState('');
  const [capabilityLoading, setCapabilityLoading] = useState(false);
  const [savingReport, setSavingReport] = useState(false);
  const [saveReportError, setSaveReportError] = useState('');

  const plan = useMemo(() => normalizePlan(query?.plan), [query]);
  const intent = typeof query?.intent === 'string' ? query.intent.trim().toLowerCase() : '';
  const caseId = typeof query?.caseId === 'string' ? query.caseId.trim() : '';
  const planDetails = PLAN_DETAILS[plan] || PLAN_DETAILS.individual;

  const markPaymentsUnavailable = (reason) => {
    setPaymentsEnabled(false);
    setPaymentsReason(reason || 'Payments are unavailable right now.');
  };

  const handleCheckoutFailure = (err) => {
    const message = err?.message || '';
    const code = err?.code || '';
    if (
      code === 'failed-precondition' ||
      code === 'invalid-argument' ||
      /stripe is not configured/i.test(message) ||
      /unsupported plan/i.test(message)
    ) {
      console.warn('[checkout] Payments unavailable', { code, message });
      markPaymentsUnavailable('Payments are unavailable right now. We’re in pre-launch mode.');
      return true;
    }
    return false;
  };

  const handleSaveReportFallback = async () => {
    if (!caseId) return;
    setSaveReportError('');
    setSavingReport(true);
    try {
      const raw = window?.localStorage?.getItem(`pending_report_${caseId}`);
      if (!raw) {
        setSaveReportError('We could not find a pending report to save.');
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed?.submission || parsed?.caseId !== caseId) {
        setSaveReportError('We could not find a pending report to save.');
        return;
      }
      await scoreCaseAttempt({ caseId, submission: parsed.submission });
      window.localStorage.removeItem(`pending_report_${caseId}`);
      navigate('/trainee/submission-history');
    } catch (err) {
      console.error('Save report fallback failed:', err);
      setSaveReportError('Unable to save the report right now. Please try again.');
    } finally {
      setSavingReport(false);
    }
  };

  useEffect(() => {
    if (!currentUser) return;
    let active = true;
    setCapabilityLoading(true);
    fetchPaymentsCapability()
      .then((data) => {
        if (!active) return;
        const enabled = data?.enabled !== false;
        setPaymentsEnabled(enabled);
        setPaymentsReason(
          enabled ? '' : data?.reason || 'Payments are unavailable right now. We’re in pre-launch mode.'
        );
      })
      .catch((err) => {
        if (!active) return;
        console.error('Payments capability check failed:', err);
        setPaymentsEnabled(false);
        setPaymentsReason('Payments are unavailable right now. We’re in pre-launch mode.');
      })
      .finally(() => {
        if (active) setCapabilityLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentUser]);

  const handleCheckout = async () => {
    setError('');
    if (!paymentsEnabled) {
      setError(paymentsReason || 'Payments are not enabled yet.');
      return;
    }
    setLoading(true);
    try {
      await trackAnalyticsEvent({ eventType: 'checkout_started', metadata: { plan } });
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const { url } = await createCheckoutSession({ plan, baseUrl, intent, caseId });
      if (url) {
        window.location.assign(url);
      } else {
        console.warn('[checkout] Missing session URL; disabling payments.');
        markPaymentsUnavailable('Payments are unavailable right now. We’re in pre-launch mode.');
      }
    } catch (err) {
      console.error('Checkout error:', err);
      if (!handleCheckoutFailure(err)) {
        setError('Unable to start checkout. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (!currentUser) {
    const nextParams = new URLSearchParams({ plan });
    if (intent) nextParams.set('intent', intent);
    if (caseId) nextParams.set('caseId', caseId);
    const nextUrl = `/checkout?${nextParams.toString()}`;
    const encodedNext = encodeURIComponent(nextUrl);
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center px-6">
        <div className="max-w-xl text-center">
          <h1 className="text-3xl font-bold text-white mb-4">
            {intent === 'save-report' ? 'Create your account to save your report' : 'Create your account to continue'}
          </h1>
          <p className="text-slate-400 mb-6">
            You’ll get instant access to the {PLAN_LABELS[plan] || 'AuditSimPro'} after checkout.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => navigate(`/register?next=${encodedNext}&plan=${plan}`)}
              className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg text-sm font-medium"
            >
              Create account
            </button>
            <button
              onClick={() => navigate(`/login?next=${encodedNext}`)}
              className="bg-slate-800 hover:bg-slate-700 text-white px-5 py-2 rounded-lg text-sm font-medium"
            >
              Sign in
            </button>
          </div>
          {intent === 'save-report' && caseId ? (
            <div className="mt-4">
              <button
                onClick={() => navigate(`/demo/surl?caseId=${encodeURIComponent(caseId)}`)}
                className="text-sm text-blue-400 hover:text-blue-300 underline"
              >
                Back to report
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const headerCopy = (() => {
    if (intent === 'save-report') {
      return {
        title: 'Save your report',
        subtitle: 'Confirm your plan to save your report and unlock full access.',
      };
    }
    if (intent === 'unlock-case' && caseId) {
      return {
        title: 'Unlock this case',
        subtitle: 'Confirm your plan to continue where you left off.',
      };
    }
    return {
      title: 'Confirm your plan',
      subtitle: 'Review pricing, key terms, and what happens next.',
    };
  })();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center px-6">
      <div className="max-w-xl text-center">
        <h1 className="text-3xl font-bold text-white mb-3">{headerCopy.title}</h1>
        <p className="text-slate-400 mb-6">{headerCopy.subtitle}</p>
        {!paymentsEnabled ? (
          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <div className="text-xs uppercase tracking-[0.2em] text-amber-300 mb-2">Payments unavailable</div>
            {paymentsReason || 'Payments are unavailable right now.'}
          </div>
        ) : null}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-left mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm uppercase tracking-[0.2em] text-slate-500">Selected plan</div>
              <div className="text-lg font-semibold text-white">{PLAN_LABELS[plan] || 'AuditSimPro'}</div>
              <div className="text-slate-400 text-sm">{planDetails.price} · {planDetails.terms}</div>
            </div>
            <div className="text-sm text-slate-300">
              {Object.keys(PLAN_DETAILS).length > 1 ? (
                <button
                  onClick={() =>
                    navigate(`/checkout?plan=${plan === 'individual' ? 'individual_annual' : 'individual'}${intent ? `&intent=${encodeURIComponent(intent)}` : ''}${caseId ? `&caseId=${encodeURIComponent(caseId)}` : ''}`)
                  }
                  className="underline text-blue-400 hover:text-blue-300"
                >
                  Change plan
                </button>
              ) : null}
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            <div className="text-sm text-slate-300">What’s included:</div>
            <ul className="text-sm text-slate-400 list-disc list-inside">
              {planDetails.includes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div className="text-sm text-slate-300">What happens next:</div>
            <ul className="text-sm text-slate-400 list-disc list-inside">
              <li>Secure Stripe checkout</li>
              <li>Immediate access after payment</li>
              <li>Return here to continue to the next case</li>
            </ul>
          </div>
        </div>
        <button
          onClick={handleCheckout}
          disabled={loading || capabilityLoading || !paymentsEnabled}
          className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-lg text-sm font-semibold disabled:opacity-60"
        >
          {capabilityLoading
            ? 'Checking payment setup…'
            : loading
            ? 'Redirecting to secure checkout…'
            : `Confirm and pay ${planDetails.price}`}
        </button>
        <div className="mt-3 text-xs text-slate-500">Secure checkout powered by Stripe.</div>
        {!paymentsEnabled ? (
          <div className="mt-4 flex flex-col sm:flex-row gap-3 justify-center">
            {intent === 'save-report' && caseId ? (
              <button
                onClick={handleSaveReportFallback}
                disabled={savingReport}
                className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
              >
                {savingReport ? 'Saving report…' : 'Save report now'}
              </button>
            ) : null}
            {intent === 'save-report' && caseId ? (
              <button
                onClick={() => navigate(`/demo/surl?caseId=${encodeURIComponent(caseId)}`)}
                className="bg-slate-800 hover:bg-slate-700 text-white px-5 py-2 rounded-lg text-sm font-medium"
              >
                Back to report
              </button>
            ) : (
              <button
                onClick={() => navigate('/demo/surl')}
                className="bg-slate-800 hover:bg-slate-700 text-white px-5 py-2 rounded-lg text-sm font-medium"
              >
                Try the demo
              </button>
            )}
            <button
              onClick={() => showModal(<ReportProblemModal />, 'Notify me')}
              className="bg-slate-900 hover:bg-slate-800 text-white px-5 py-2 rounded-lg text-sm font-medium border border-slate-700"
            >
              Notify me
            </button>
          </div>
        ) : null}
        {saveReportError ? <p className="text-red-400 text-sm mt-4">{saveReportError}</p> : null}
        {error ? <p className="text-red-400 text-sm mt-4">{error}</p> : null}
      </div>
    </div>
  );
}
