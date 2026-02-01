import React, { useEffect } from 'react';
import { useRoute, useUser } from '../AppCore';
import { trackAnalyticsEvent } from '../services/analyticsService';
import { isBillingPaid } from '../services/billingService';

export default function CheckoutSuccessPage() {
  const { navigate, query } = useRoute();
  const { billing, loadingBilling } = useUser();
  const hasPaidAccess = isBillingPaid(billing);

  useEffect(() => {
    trackAnalyticsEvent({
      eventType: 'checkout_completed',
      metadata: { sessionId: query?.session_id || null },
    });
  }, [query]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center px-6">
      <div className="max-w-xl text-center">
        <h1 className="text-3xl font-bold text-white mb-4">You’re in</h1>
        <p className="text-slate-400 mb-6">
          Your payment is complete. You can start the simulations right away.
        </p>
        {loadingBilling ? (
          <p className="text-sm text-slate-400">Confirming your payment…</p>
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
