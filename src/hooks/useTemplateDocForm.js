import { useCallback, useEffect, useMemo, useState } from 'react';
import getUUID from '../utils/getUUID';
import { getFieldSpec } from '../shared/generation/templateFieldSpecs';
import {
  computeDerived,
  emptyFormState,
  emptyRowFromSpec,
  formStateFromData,
  getPath,
  setPath,
} from '../shared/generation/templateDataBuilder';

const withRowIds = (rows = []) =>
  rows.map((row) => ({ _tempId: getUUID(), ...row }));

export default function useTemplateDocForm({ templateId }) {
  const spec = useMemo(() => getFieldSpec(templateId), [templateId]);
  const sampleState = useMemo(() => formStateFromData(spec, spec.sample), [spec]);
  const [values, setValues] = useState(sampleState.values);
  const [rows, setRows] = useState(() => withRowIds(sampleState.rows));

  useEffect(() => {
    setValues(sampleState.values);
    setRows(withRowIds(sampleState.rows));
  }, [sampleState]);

  const handleFieldChange = useCallback((key, value) => {
    setValues((previous) => {
      const next = { ...previous };
      setPath(next, key, value);
      return next;
    });
  }, []);

  const handleRowChange = useCallback((index, updates) => {
    setRows((previous) =>
      previous.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        const next = { ...row };
        Object.entries(updates || {}).forEach(([key, value]) => setPath(next, key, value));
        return next;
      })
    );
  }, []);

  const addRow = useCallback(() => {
    setRows((previous) => {
      if (!spec.rows || previous.length >= spec.rows.maxRows) return previous;
      return [...previous, { _tempId: getUUID(), ...emptyRowFromSpec(spec) }];
    });
  }, [spec]);

  const removeRow = useCallback((index) => {
    setRows((previous) => previous.filter((_, rowIndex) => rowIndex !== index));
  }, []);

  const applyBucket = useCallback((index, bucketKey) => {
    if (spec.computeKind !== 'apAging') return;
    setRows((previous) =>
      previous.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        const amount = Number(getPath(row, 'amount') || 0);
        const buckets = {};
        ['current', 'days30', 'days60', 'days90Plus'].forEach((key) => {
          buckets[key] = key === bucketKey ? amount : 0;
        });
        return { ...row, buckets };
      })
    );
  }, [spec.computeKind]);

  const loadSample = useCallback(() => {
    const next = formStateFromData(spec, spec.sample);
    setValues(next.values);
    setRows(withRowIds(next.rows));
  }, [spec]);

  const derived = useMemo(() => computeDerived(spec, { values, rows }), [spec, values, rows]);

  return {
    templateId,
    spec,
    values,
    rows,
    handleFieldChange,
    handleRowChange,
    addRow,
    removeRow,
    applyBucket,
    loadSample,
    derived,
  };
}

export { emptyFormState };
