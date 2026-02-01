import React from 'react';
import { useRoute } from '../AppCore';

export default function CheckoutSuccessPage() {
  const { navigate } = useRoute();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center px-6">
      <div className="max-w-xl text-center">
        <h1 className="text-3xl font-bold text-white mb-4">You’re in</h1>
        <p className="text-slate-400 mb-6">
          Your payment is complete. You can start the simulations right away.
        </p>
        <button
          onClick={() => navigate('/trainee')}
          className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-lg text-sm font-semibold"
        >
          Go to dashboard
        </button>
      </div>
    </div>
  );
}
