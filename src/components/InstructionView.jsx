import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Play } from 'lucide-react';
import { Button } from '../AppCore';

const buildNormalizedOption = (option, index) => ({
  ...option,
  id: option?.id ?? option?.value ?? `option-${index + 1}`,
  text: option?.text ?? option?.label ?? '',
  correct: Boolean(option?.correct || option?.isCorrect || option?.is_correct),
});

const getVisualAsset = (instructionData) =>
  instructionData?.visualAsset || instructionData?.visual_asset || null;

const getGateCheck = (instructionData) =>
  instructionData?.gateCheck || instructionData?.gate_check || {};

const InstructionView = ({
  instructionData,
  onStartSimulation,
  ctaLabel = 'Begin Simulation',
  className = '',
}) => {
  const [selectedOptionId, setSelectedOptionId] = useState('');
  const [feedback, setFeedback] = useState(null);

  const visualAsset = useMemo(() => getVisualAsset(instructionData), [instructionData]);
  const gateCheck = useMemo(() => getGateCheck(instructionData), [instructionData]);
  const gateOptions = useMemo(() => {
    const options = Array.isArray(gateCheck.options) ? gateCheck.options : [];
    return options.map(buildNormalizedOption);
  }, [gateCheck.options]);

  const correctOptionId = useMemo(() => {
    const correctOption = gateOptions.find((option) => option.correct);
    return correctOption?.id || '';
  }, [gateOptions]);

  const handleGateCheck = () => {
    if (!gateOptions.length) {
      setFeedback({
        type: 'warning',
        message: 'Gate question is missing options. Add them to launch the sim.',
      });
      return;
    }
    if (!selectedOptionId) {
      setFeedback({ type: 'warning', message: 'Pick an option before launching.' });
      return;
    }
    if (!correctOptionId) {
      setFeedback({
        type: 'warning',
        message: 'No correct option is marked. Set one to enable the gate.',
      });
      return;
    }

    const selectedOption = gateOptions.find((option) => option.id === selectedOptionId);
    const failureMessage =
      selectedOption?.feedback ||
      selectedOption?.remediation ||
      selectedOption?.explanation ||
      gateCheck.failureMessage ||
      gateCheck.failure_message ||
      'Incorrect. Revisit the golden rule, then try again.';

    if (selectedOptionId === correctOptionId) {
      setFeedback({
        type: 'success',
        message:
          gateCheck.successMessage ||
          gateCheck.success_message ||
          'Clear for takeoff. Enter the cockpit.',
      });
      onStartSimulation?.();
    } else {
      setFeedback({ type: 'error', message: failureMessage });
    }
  };

  const renderVisualAsset = () => {
    if (!visualAsset) {
      return (
        <div className="w-full h-full rounded-xl border border-dashed border-gray-200 bg-gray-50 flex items-center justify-center text-gray-500 text-sm">
          No visual asset provided yet.
        </div>
      );
    }

    if (visualAsset.type === 'VIDEO' && visualAsset.source_id) {
      return (
        <iframe
          title={instructionData?.title || 'Instruction video'}
          src={`https://www.youtube.com/embed/${visualAsset.source_id}?rel=0`}
          className="w-full h-full rounded-xl"
          allowFullScreen
        />
      );
    }

    if (visualAsset.url) {
      return (
        <img
          src={visualAsset.url}
          alt={visualAsset.alt || 'Instruction asset'}
          className="w-full h-full object-cover rounded-xl"
        />
      );
    }

    return (
      <div className="w-full h-full rounded-xl border border-dashed border-gray-200 bg-gray-50 flex items-center justify-center text-gray-500 text-sm">
        Visual asset configured, but missing URL.
      </div>
    );
  };

  const feedbackTone = {
    success: {
      toneClass: 'bg-emerald-50 border-emerald-200 text-emerald-800',
      Icon: CheckCircle2,
    },
    error: {
      toneClass: 'bg-red-50 border-red-200 text-red-700',
      Icon: AlertTriangle,
    },
    warning: {
      toneClass: 'bg-amber-50 border-amber-200 text-amber-800',
      Icon: AlertTriangle,
    },
  };

  const feedbackConfig = feedback ? feedbackTone[feedback.type] || feedbackTone.warning : null;

  return (
    <div
      className={`bg-white rounded-2xl shadow-lg border border-gray-100 p-8 max-w-5xl mx-auto ${className}`}
    >
      <header className="space-y-2 mb-6">
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold uppercase tracking-wide">
            Briefing Room
          </span>
          {instructionData?.moduleCode ? (
            <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
              {instructionData.moduleCode}
            </span>
          ) : null}
        </div>
        <h1 className="text-3xl font-bold text-gray-900">{instructionData?.title || 'Mission Briefing'}</h1>
        {instructionData?.hook?.body ? (
          <p className="text-gray-600 text-lg leading-relaxed">{instructionData.hook.body}</p>
        ) : null}
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <section className="xl:col-span-3 space-y-4">
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-5 py-4">
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1">Hook</p>
            <p className="text-blue-900 text-base leading-relaxed">
              {instructionData?.hook?.headline || instructionData?.hook?.title || 'Why this matters'}
            </p>
            {instructionData?.hook?.risk ? (
              <p className="text-sm text-blue-800 mt-2">
                Risk: <span className="font-semibold">{instructionData.hook.risk}</span>
              </p>
            ) : null}
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 min-h-[280px]">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Visual Model</p>
            <div className="aspect-video">{renderVisualAsset()}</div>
          </div>
        </section>

        <aside className="xl:col-span-2 space-y-4">
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-5 py-4">
            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">Heuristic</p>
            <p className="text-lg font-semibold text-amber-900">
              {instructionData?.heuristic?.rule_text || instructionData?.heuristic?.ruleText || 'Insert the golden rule for this trap.'}
            </p>
            {instructionData?.heuristic?.reminder ? (
              <p className="mt-2 text-sm text-amber-800">{instructionData.heuristic.reminder}</p>
            ) : null}
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Gate Check</p>
                <p className="text-base font-semibold text-gray-900">
                  {gateCheck.question || 'Confirm the golden rule before entering the cockpit.'}
                </p>
              </div>
              <Play size={24} className="text-blue-600" />
            </div>

            <div className="space-y-2">
              {gateOptions.map((option) => (
                <label
                  key={option.id}
                  className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition hover:border-blue-300 hover:bg-blue-50 ${
                    selectedOptionId === option.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'
                  }`}
                >
                  <input
                    type="radio"
                    name="gate-check"
                    value={option.id}
                    className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500"
                    checked={selectedOptionId === option.id}
                    onChange={() => setSelectedOptionId(option.id)}
                  />
                  <span className="text-sm text-gray-800 leading-relaxed">{option.text}</span>
                </label>
              ))}
            </div>

            {feedback && feedbackConfig ? (
              <div className={`flex items-start gap-3 rounded-lg border px-3 py-2 text-sm ${feedbackConfig.toneClass}`}>
                <feedbackConfig.Icon size={18} className="mt-0.5" />
                <span>{feedback.message}</span>
              </div>
            ) : null}

            <Button onClick={handleGateCheck} className="w-full flex items-center justify-center gap-2">
              <Play size={18} /> {ctaLabel}
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default InstructionView;
