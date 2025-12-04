import React from 'react';

export default function StepIntro({ title, items = [], helper }) {
  return (
    <div className="space-y-2 rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-sm text-blue-800">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
          i
        </span>
        <h3 className="text-base font-semibold text-blue-900">{title}</h3>
      </div>
      <ul className="list-disc pl-6 text-blue-900">
        {items.map((item, idx) => (
          <li key={idx} className="mb-1">
            {item}
          </li>
        ))}
      </ul>
      {helper ? <p className="text-xs text-blue-700">{helper}</p> : null}
    </div>
  );
}
