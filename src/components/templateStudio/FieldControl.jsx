import React from 'react';
import { Input, Select, Textarea } from '../../AppCore';

const optionEntries = (field) =>
  (field.options || []).map((option) =>
    option && typeof option === 'object' && Object.prototype.hasOwnProperty.call(option, 'value')
      ? option
      : { value: option, label: String(option) }
  );

export default function FieldControl({ field, value, onChange, id, compact = false }) {
  const commonProps = {
    id,
    name: id,
    value: value ?? '',
    onChange: (event) => onChange(event.target.value),
    required: field.required,
  };

  if (field.type === 'textarea') {
    return <Textarea {...commonProps} rows={compact ? 2 : 3} maxLength={field.maxLength} />;
  }

  if (field.type === 'select') {
    return (
      <Select {...commonProps}>
        <option value="">Select…</option>
        {optionEntries(field).map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </Select>
    );
  }

  return (
    <Input
      {...commonProps}
      type={field.type === 'number' || field.type === 'percent' ? 'number' : 'text'}
      step={field.type === 'percent' ? '0.01' : field.type === 'number' ? '0.01' : undefined}
      inputMode={field.type === 'number' || field.type === 'percent' ? 'decimal' : undefined}
      maxLength={field.type === 'text' ? field.maxLength : undefined}
    />
  );
}
