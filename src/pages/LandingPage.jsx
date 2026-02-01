import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  ArrowRight,
  Zap,
  ShieldAlert,
  BarChart3,
  Briefcase,
  Play,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth, useUser } from '../AppCore';

const Navbar = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { role } = useUser();

  const dashboardPath = useMemo(() => {
    if (role === 'admin' || role === 'owner') return '/admin';
    if (role === 'instructor') return '/instructor';
    if (role === 'trainee') return '/trainee';
    return '/home';
  }, [role]);

  const renderPrimaryCta = () => {
    if (currentUser) {
      return (
        <button
          onClick={() => navigate(dashboardPath)}
          className="text-white bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-full text-sm font-medium transition-all border border-slate-700"
        >
          Dashboard
        </button>
      );
    }
    return (
      <button
        onClick={() => navigate('/login')}
        className="text-white bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-full text-sm font-medium transition-all border border-slate-700"
      >
        Log In
      </button>
    );
  };

  return (
    <nav className="fixed top-0 w-full z-50 bg-slate-900/80 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Zap className="text-white w-5 h-5" />
            </div>
            <span className="text-white font-bold text-xl tracking-tight">
              AuditSim<span className="text-blue-500">Pro</span>
            </span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-slate-300 hover:text-white transition-colors text-sm font-medium">
              Features
            </a>
            <a href="#demo" className="text-slate-300 hover:text-white transition-colors text-sm font-medium">
              The Trap
            </a>
            <a href="#pricing" className="text-slate-300 hover:text-white transition-colors text-sm font-medium">
              Pricing
            </a>
            {renderPrimaryCta()}
            <button
              onClick={() => navigate('/register')}
              className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-full text-sm font-medium transition-all shadow-[0_0_15px_rgba(37,99,235,0.5)]"
            >
              Get Started
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
};

const Hero = () => {
  const navigate = useNavigate();
  return (
    <div className="relative pt-32 pb-20 sm:pt-40 sm:pb-24 overflow-hidden bg-slate-950">
      {/* Background Gradients */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full max-w-7xl pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-blue-500/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-indigo-500/10 rounded-full blur-[100px]" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-900/30 border border-blue-800 text-blue-300 text-xs font-medium mb-8">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
          Live demo available now
        </div>

        <h1 className="text-5xl sm:text-7xl font-extrabold text-white tracking-tight leading-tight mb-6">
          Don't Teach Definitions.
          <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">Simulate the Audit.</span>
        </h1>

        <p className="mt-4 text-xl text-slate-400 max-w-2xl mx-auto mb-10">
          Give your new hires 2 years of experience in 20 minutes. The only training platform that uses
          <span className="text-white font-medium"> simulated data defects</span> to teach professional skepticism.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <button
            onClick={() => navigate('/demo/surl')}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-xl text-lg font-bold transition-all shadow-[0_0_20px_rgba(37,99,235,0.4)] hover:shadow-[0_0_30px_rgba(37,99,235,0.6)]"
          >
            Start Free Simulation <ArrowRight size={20} />
          </button>
          <button
            onClick={() => navigate('/demo/surl')}
            className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white border border-slate-700 px-8 py-4 rounded-xl text-lg font-bold transition-all"
          >
            <Play size={20} className="text-slate-400" /> Watch Demo
          </button>
        </div>

        <div className="mt-16 pt-8 border-t border-slate-800/50">
          <p className="text-sm text-slate-500 mb-4 font-medium uppercase tracking-wider">Trusted by Audit Managers At</p>
          <div className="flex justify-center gap-8 grayscale opacity-50">
            <span className="text-xl font-bold text-slate-400">Regional Firms</span>
            <span className="text-xl font-bold text-slate-400">Universities</span>
            <span className="text-xl font-bold text-slate-400">CPA Prep</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const TheTrapDemo = () => {
  const [revealed, setRevealed] = useState(false);

  return (
    <section id="demo" className="py-24 bg-slate-900 border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">
              Can you spot the <span className="text-red-400">Silent Killer?</span>
            </h2>
            <p className="text-lg text-slate-400 mb-6">
              90% of first-year associates mark this invoice as "Correct" because the invoice date is in January. They miss
              the Cutoff error buried in the description.
            </p>
            <p className="text-lg text-slate-400 mb-8">
              Audit Sim Pro doesn't just lecture about "Unrecorded Liabilities." We force students to find them in messy
              ledgers.
            </p>

            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-red-500/10 rounded-lg">
                  <XCircle className="text-red-500 w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-white font-bold">Traditional Training</h4>
                  <p className="text-slate-500 text-sm">Passive videos about "Completeness." Students zone out.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="p-2 bg-green-500/10 rounded-lg">
                  <CheckCircle2 className="text-green-500 w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-white font-bold">Audit Sim Pro</h4>
                  <p className="text-slate-500 text-sm">Active hunting for errors. Immediate dopamine feedback.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
            <div className="relative bg-slate-950 border border-slate-800 rounded-2xl p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800">
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500/20"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-500/20"></div>
                  <div className="w-3 h-3 rounded-full bg-green-500/20"></div>
                </div>
                <div className="text-xs text-slate-500 font-mono">INV-2025-001.pdf</div>
              </div>

              <div className="bg-white rounded-lg p-6 text-slate-900 font-mono text-sm relative overflow-hidden">
                <div className="flex justify-between mb-8">
                  <div className="font-bold text-lg">Parker Security Co.</div>
                  <div className="text-right">
                    <div>INVOICE #9942</div>
                    <div className="font-bold">Date: Jan 03, 2025</div>
                  </div>
                </div>

                <table className="w-full mb-8">
                  <thead className="border-b-2 border-slate-200">
                    <tr>
                      <th className="text-left py-2">Description</th>
                      <th className="text-right py-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="py-4 relative">
                        Security Services - Dec 2024
                        {revealed && (
                          <div className="absolute -inset-2 border-2 border-red-500 rounded flex items-center justify-center bg-red-500/10 pointer-events-none animate-pulse">
                            <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded shadow-sm">SERVICE DATE TRAP</span>
                          </div>
                        )}
                      </td>
                      <td className="text-right py-4">$15,000.00</td>
                    </tr>
                  </tbody>
                </table>

                {!revealed ? (
                  <div className="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center text-center p-6 backdrop-blur-[2px]">
                    <p className="text-white font-bold text-lg mb-2">Audit Decision Required</p>
                    <p className="text-slate-300 text-sm mb-6">
                      Year End: Dec 31, 2024. <br />
                      Is this an unrecorded liability?
                    </p>
                    <button
                      onClick={() => setRevealed(true)}
                      className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-bold shadow-lg transition-transform active:scale-95"
                    >
                      Audit This Item
                    </button>
                  </div>
                ) : (
                  <div className="absolute bottom-4 right-4 left-4 bg-slate-800 text-white p-4 rounded-lg shadow-xl border border-slate-700 animate-in slide-in-from-bottom-2">
                    <div className="flex items-start gap-3">
                      <ShieldAlert className="text-red-400 shrink-0" />
                      <div>
                        <p className="font-bold text-red-400">Unrecorded Liability Detected</p>
                        <p className="text-xs text-slate-300 mt-1">
                          Correct. Services performed in Dec 2024 must be accrued, regardless of the Jan 03 invoice date.
                        </p>
                        <button
                          onClick={() => setRevealed(false)}
                          className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline"
                        >
                          Reset Simulation
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const FeatureCard = ({ icon: Icon, title, desc }) => (
  <div className="p-6 bg-slate-800/50 border border-slate-700 rounded-2xl hover:bg-slate-800 transition-colors">
    <div className="w-12 h-12 bg-blue-900/50 rounded-xl flex items-center justify-center mb-4">
      <Icon className="text-blue-400 w-6 h-6" />
    </div>
    <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
    <p className="text-slate-400 leading-relaxed">{desc}</p>
  </div>
);

const Features = () => (
  <section id="features" className="py-24 bg-slate-950">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="text-center mb-16">
        <h2 className="text-3xl sm:text-5xl font-bold text-white mb-6">The Universal Audit Engine</h2>
        <p className="text-xl text-slate-400 max-w-2xl mx-auto">We replaced the "Learning Management System" with a "Workpaper Simulator."</p>
      </div>

      <div className="grid md:grid-cols-3 gap-8">
        <FeatureCard
          icon={BarChart3}
          title="Messy Ledgers"
          desc="Students don't get perfect Excel files. They get messy client data, unsorted PDFs, and conflicting evidence. Just like real life."
        />
        <FeatureCard
          icon={ShieldAlert}
          title="The Virtual Senior"
          desc="Our grading engine provides immediate, context-aware feedback. It explains exactly WHY an assertion failed the moment it happens."
        />
        <FeatureCard
          icon={Briefcase}
          title="Full Cycle Simulation"
          desc="From 'Search for Unrecorded Liabilities' to 'Cash Reconciliation' and 'Fixed Assets.' We cover the critical Year 1 risks."
        />
      </div>
    </div>
  </section>
);

const Pricing = () => {
  const navigate = useNavigate();
  return (
    <section id="pricing" className="py-24 bg-slate-900 border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-5xl font-bold text-white mb-6">Simple, Transparent Pricing</h2>
          <p className="text-xl text-slate-400">Stop paying thousands for generic CPE. Pay for results.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-8 relative overflow-hidden group hover:border-blue-500/50 transition-colors">
            <div className="absolute top-0 right-0 bg-blue-600/20 text-blue-400 px-3 py-1 rounded-bl-xl text-xs font-bold uppercase">
              Most Popular
            </div>
            <h3 className="text-2xl font-bold text-white mb-2">Student Access</h3>
            <div className="flex items-baseline gap-1 mb-6">
              <span className="text-4xl font-bold text-white">$29</span>
              <span className="text-slate-500">/ lifetime</span>
            </div>
            <p className="text-slate-400 mb-8">Perfect for students and new hires wanting to crush their first busy season.</p>
            <ul className="space-y-4 mb-8">
              {['SURL Module (Liabilities)', 'Cash Reconciliation Module', 'Fixed Asset Module', 'Immediate "Virtual Senior" Feedback'].map((item) => (
                <li key={item} className="flex items-center gap-3 text-slate-300">
                  <CheckCircle2 className="text-blue-500 w-5 h-5 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
            <button
              onClick={() => navigate('/checkout?plan=individual')}
              className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 rounded-xl transition-colors border border-slate-700"
            >
              Get Instant Access
            </button>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8">
            <h3 className="text-2xl font-bold text-white mb-2">Firm License</h3>
            <div className="flex items-baseline gap-1 mb-6">
              <span className="text-4xl font-bold text-white">$2,500</span>
              <span className="text-slate-500">/ year</span>
            </div>
            <p className="text-slate-400 mb-8">For regional firms who want to standardize onboarding and reduce review notes.</p>
            <ul className="space-y-4 mb-8">
              {['Up to 50 Trainee Accounts', 'Admin Dashboard & Reporting', 'Custom Case Logic', 'White-glove Onboarding'].map((item) => (
                <li key={item} className="flex items-center gap-3 text-slate-300">
                  <CheckCircle2 className="text-emerald-500 w-5 h-5 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
            <button className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-colors shadow-lg">
              Contact Sales
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

const Footer = () => (
  <footer className="bg-slate-950 border-t border-slate-800 py-12">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-6">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 bg-slate-800 rounded flex items-center justify-center">
          <Zap className="text-blue-500 w-4 h-4" />
        </div>
        <span className="text-slate-300 font-bold">AuditSimPro</span>
      </div>
      <div className="text-slate-500 text-sm">© 2025 Audit Sim Pro. Built in Colorado.</div>
    </div>
  </footer>
);

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-blue-500/30">
      <Navbar />
      <Hero />
      <TheTrapDemo />
      <Features />
      <Pricing />
      <Footer />
    </div>
  );
}
