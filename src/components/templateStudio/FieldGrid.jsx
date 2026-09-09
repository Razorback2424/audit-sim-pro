import React from 'react';
import { getPath } from '../../shared/generation/templateDataBuilder';
import FieldControl from './FieldControl';

export default function FieldGrid({ fields = [], values = {}, onChange }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {fields.map((field) => {
        const id = `template-field-${field.key.replace(/\./g, '-')}`;
        const helpId = `${id}-help`;
        return (
          <div key={field.key} className="space-y-1">
            <label htmlFor={id} className="block text-sm font-medium text-gray-700">
              {field.label}
              {field.required ? <span className="text-rose-600"> *</span> : null}
            </label>
            <FieldControl
              field={field}
              value={getPath(values, field.key)}
              onChange={(value) => onChange(field.key, value)}
              id={id}
            />
            {field.help ? (
              <p id={helpId} className="text-xs text-gray-500">
                {field.help}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
