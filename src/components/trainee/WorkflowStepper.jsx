import React from 'react';

const DEFAULT_LABELS = {};
const DEFAULT_DESCRIPTIONS = {};

export default function WorkflowStepper({ workflow, activeStep, stepLabels, stepDescriptions, onStepClick }) {
  const stepIndex = workflow.indexOf(activeStep);

  return (
    <ol className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between bg-white rounded-lg shadow px-4 py-4">
      {workflow.map((stepKey, idx) => {
        const isCompleted = stepIndex > idx;
        const isActive = stepIndex === idx;
        const label =
          stepLabels?.[stepKey] ??
          DEFAULT_LABELS[stepKey] ??
          stepKey.charAt(0).toUpperCase() + stepKey.slice(1);
        const description =
          stepDescriptions?.[stepKey] ?? DEFAULT_DESCRIPTIONS[stepKey] ?? '';
        const clickable = typeof onStepClick === 'function';
        const Wrapper = clickable ? 'button' : 'li';
        return (
          <Wrapper
            key={stepKey}
            className={`flex items-center space-x-3 ${clickable ? 'text-left w-full' : ''}`}
            onClick={clickable ? () => onStepClick(stepKey) : undefined}
            type={clickable ? 'button' : undefined}
          >
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                isActive ? 'bg-blue-600 text-white' : isCompleted ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-600'
              }`}
            >
              {isCompleted ? '✓' : idx + 1}
            </span>
            <div>
              <p className={`text-sm font-semibold ${isActive ? 'text-blue-700' : 'text-gray-800'}`}>{label}</p>
              <p className="text-xs text-gray-500 hidden sm:block">{description}</p>
            </div>
          </Wrapper>
        );
      })}
    </ol>
  );
}
