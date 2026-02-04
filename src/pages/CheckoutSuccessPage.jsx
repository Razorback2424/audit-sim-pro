import React, { useEffect, useMemo, useState } from 'react';
import { useAuth, useRoute, useUser } from '../AppCore';
import { trackAnalyticsEvent } from '../services/analyticsService';
import { confirmCheckoutSession, fetchUserBilling, isBillingPaid } from '../services/billingService';

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
  const sessionId = useMemo(() => (typeof query?.session_id === 'string' ? query.session_id : ''), [query]);

  useEffect(() => {
    trackAnalyticsEvent({
      eventType: 'checkout_completed',
      metadata: { sessionId: query?.session_id || null },
    });
  }, [query]);

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
        setConfirmError(err?.message || 'Unable to confirm checkout yet.');
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
          setConfirmError(err?.message || 'Unable to refresh billing status.');
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
    if (hasPaidAccess) {
      navigate('/trainee?autostart=1');
    }
  }, [hasPaidAccess, navigate]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center px-6">
      <div className="max-w-xl text-center">
        <h1 className="text-3xl font-bold text-white mb-4">You’re in</h1>
        <p className="text-slate-400 mb-6">
          Your payment is complete. You can start the simulations right away.
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
        {pollTimedOut ? (
          <p className="text-sm text-amber-300 mt-2">
            We’re still waiting for Stripe to confirm. Please refresh in a moment if access is still locked.
          </p>
        ) : null}
        <button
          onClick={() => navigate('/trainee?autostart=1')}
          disabled={!hasPaidAccess}
          className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-lg text-sm font-semibold disabled:opacity-60"
        >
          Start next case
        </button>
      </div>
    </div>
  );
}
