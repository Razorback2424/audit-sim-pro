import React from 'react';
import { Input, Select } from '../../AppCore';
import StepIntro from './StepIntro';

export default function CaseBasicsStep({ basics }) {
  const {
    auditArea,
    setAuditArea,
    auditAreaSelectOptions,
    yearEndInput,
    setYearEndInput,
    yearEndValue,
    yearEndError,
    caseLevel,
    setCaseLevel,
    caseLevelOptions,
    moduleId,
    setModuleId,
    recipeVersion,
    setRecipeVersion,
    overrideDefaults,
    setOverrideDefaults,
    overrideDisbursementCount,
    setOverrideDisbursementCount,
    overrideVendorCount,
    setOverrideVendorCount,
    overrideInvoicesPerVendor,
    setOverrideInvoicesPerVendor,
  } = basics;

  const handleRecipeVersionChange = (value) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setRecipeVersion(1);
      return;
    }
    setRecipeVersion(parsed);
  };

  return (
    <div className="space-y-6">
      <StepIntro
        title="In this step"
        items={[
          'Select the case type to drive the generator.',
          'Set the year-end date and format used in the evidence.',
          'Choose the level to control future trap difficulty.'
        ]}
        helper="These choices shape the generation engine and the data the trainee will see."
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div>
          <label htmlFor="auditArea" className="block text-sm font-medium text-gray-700">
            Case Type
          </label>
          <Select
            id="auditArea"
            value={auditArea}
            onChange={(e) => setAuditArea(e.target.value)}
            options={auditAreaSelectOptions}
            className="mt-2"
          />
          <p className="mt-1 text-xs text-gray-500">This decides which scenario engine is used.</p>
        </div>
        <div>
          <label htmlFor="yearEnd" className="block text-sm font-medium text-gray-700">
            Year-End Date
          </label>
          <Input
            id="yearEnd"
            value={yearEndInput}
            onChange={(e) => setYearEndInput(e.target.value)}
            placeholder="MM/DD/20X3 or MM/DD/2025"
            className="mt-2"
          />
          {yearEndError ? (
            <p className="mt-1 text-xs text-red-600">{yearEndError}</p>
          ) : (
            <p className="mt-1 text-xs text-gray-500">
              Stored as {yearEndValue || '—'}. Examples: 12/31/20X3, 12/31/2025, 6/30/20X1.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="caseLevel" className="block text-sm font-medium text-gray-700">
            Course Level
          </label>
          <Select
            id="caseLevel"
            value={caseLevel}
            onChange={(e) => setCaseLevel(e.target.value)}
            options={caseLevelOptions}
            className="mt-2"
          />
          <p className="mt-1 text-xs text-gray-500">Higher levels increase trap sophistication.</p>
        </div>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-base font-semibold text-gray-800">Recipe identity</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="moduleId" className="block text-sm font-medium text-gray-700">
              Recipe ID (moduleId)
            </label>
            <Input
              id="moduleId"
              value={moduleId}
              onChange={(e) => setModuleId(e.target.value)}
              placeholder="e.g. case.surl.seed.alpha.v1"
              className="mt-2"
            />
            <p className="mt-1 text-xs text-gray-500">Stable ID used to group attempts across versions.</p>
          </div>
          <div>
            <label htmlFor="recipeVersion" className="block text-sm font-medium text-gray-700">
              Gate version
            </label>
            <Input
              id="recipeVersion"
              type="number"
              min="1"
              step="1"
              value={recipeVersion}
              onChange={(e) => handleRecipeVersionChange(e.target.value)}
              className="mt-2"
            />
            <p className="mt-1 text-xs text-gray-500">
              Bump this when you change the briefing or gate question.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <label className="flex items-center gap-3 text-sm font-medium text-gray-800">
          <input
            type="checkbox"
            checked={overrideDefaults}
            onChange={(e) => setOverrideDefaults(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600"
          />
          Override defaults
        </label>
        <p className="mt-2 text-xs text-gray-500">
          Use custom generation sizes instead of the standard recipe defaults.
        </p>
        {overrideDefaults ? (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-gray-700">Number of disbursements</label>
              <Input
                type="number"
                min="1"
                step="1"
                value={overrideDisbursementCount}
                onChange={(e) => setOverrideDisbursementCount(e.target.value)}
                placeholder="e.g. 12"
                className="mt-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Number of vendors</label>
              <Input
                type="number"
                min="1"
                step="1"
                value={overrideVendorCount}
                onChange={(e) => setOverrideVendorCount(e.target.value)}
                placeholder="e.g. 6"
                className="mt-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Invoices per vendor</label>
              <Input
                type="number"
                min="1"
                step="1"
                value={overrideInvoicesPerVendor}
                onChange={(e) => setOverrideInvoicesPerVendor(e.target.value)}
                placeholder="e.g. 2"
                className="mt-2"
              />
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
