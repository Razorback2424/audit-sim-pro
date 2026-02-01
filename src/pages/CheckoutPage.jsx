import React, { useMemo, useState } from 'react';
import { useAuth, useRoute } from '../AppCore';
import { createCheckoutSession } from '../services/billingService';
import { trackAnalyticsEvent } from '../services/analyticsService';

const PLAN_LABELS = {
  individual: 'Individual Auditor Access',
};

const normalizePlan = (value) => {
  if (typeof value !== 'string') return 'individual';
  const trimmed = value.trim().toLowerCase();
  return PLAN_LABELS[trimmed] ? trimmed : 'individual';
};

export default function CheckoutPage() {
  const { currentUser } = useAuth();
  const { navigate, query } = useRoute();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const plan = useMemo(() => normalizePlan(query?.plan), [query]);

  const handleCheckout = async () => {
    setError('');
    setLoading(true);
    try {
      await trackAnalyticsEvent({ eventType: 'checkout_started', metadata: { plan } });
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const { url } = await createCheckoutSession({ plan, baseUrl });
      if (url) {
        window.location.assign(url);
      } else {
        setError('Unable to start checkout. Please try again.');
      }
    } catch (err) {
      console.error('Checkout error:', err);
      setError(err?.message || 'Unable to start checkout. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!currentUser) {
    const nextUrl = `/checkout?plan=${plan}`;
    const encodedNext = encodeURIComponent(nextUrl);
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center px-6">
        <div className="max-w-xl text-center">
          <h1 className="text-3xl font-bold text-white mb-4">Create your account to continue</h1>
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
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center px-6">
      <div className="max-w-xl text-center">
        <h1 className="text-3xl font-bold text-white mb-4">Complete your purchase</h1>
        <p className="text-slate-400 mb-6">
          You’re buying <span className="text-white">{PLAN_LABELS[plan] || 'AuditSimPro'}</span>.
        </p>
        <button
          onClick={handleCheckout}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-lg text-sm font-semibold disabled:opacity-60"
        >
          {loading ? 'Redirecting to secure checkout…' : 'Proceed to secure checkout'}
        </button>
        {error ? <p className="text-red-400 text-sm mt-4">{error}</p> : null}
      </div>
    </div>
  );
}
