import React from 'react';
import { useRoute } from '../AppCore';

export default function CheckoutCancelPage() {
  const { navigate } = useRoute();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center px-6">
      <div className="max-w-xl text-center">
        <h1 className="text-3xl font-bold text-white mb-4">Checkout canceled</h1>
        <p className="text-slate-400 mb-6">No worries. You can try again any time.</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => navigate('/checkout?plan=individual')}
            className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-lg text-sm font-semibold"
          >
            Try again
          </button>
          <button
            onClick={() => navigate('/')}
            className="bg-slate-800 hover:bg-slate-700 text-white px-6 py-3 rounded-lg text-sm font-semibold"
          >
            Back to landing
          </button>
        </div>
      </div>
    </div>
  );
}
