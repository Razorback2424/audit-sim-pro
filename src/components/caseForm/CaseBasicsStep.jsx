import React from 'react';
import { Input, Select, Textarea } from '../../AppCore';
import StepIntro from './StepIntro';

export default function CaseBasicsStep({ basics }) {
  const {
    caseName,
    setCaseName,
    auditArea,
    setAuditArea,
    layoutType,
    setLayoutType,
    workpaperLayoutOptions,
    layoutConfigRaw,
    setLayoutConfigRaw,
    auditAreaSelectOptions,
    caseGroupSelection,
    setCaseGroupSelection,
    caseGroupSelectOptions,
    customCaseGroupId,
    setCustomCaseGroupId,
    status,
    setStatus,
    statusOptions,
  } = basics;

  return (
    <div className="space-y-6">
      <StepIntro
        title="In this step"
        items={[
          'Give the case a clear name trainees will recognize.',
          'Choose the audit area and active status.',
          'Optionally group the case for cohorts or curriculum.'
        ]}
        helper="You can revisit these details later. Keeping the status accurate helps trainees understand whether the case is ready."
      />

      <div>
        <label htmlFor="caseName" className="block text-sm font-medium text-gray-700">
          Case Name
        </label>
        <Input
          id="caseName"
          value={caseName}
          onChange={(e) => setCaseName(e.target.value)}
          placeholder="e.g., Q1 Unrecorded Liabilities Review"
          required
          className="mt-2"
        />
        <p className="mt-1 text-xs text-gray-500">Trainees see this title on their dashboard.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div>
          <label htmlFor="auditArea" className="block text-sm font-medium text-gray-700">
            Audit Area
          </label>
          <Select
            id="auditArea"
            value={auditArea}
            onChange={(e) => setAuditArea(e.target.value)}
            options={auditAreaSelectOptions}
            className="mt-2"
          />
          <p className="mt-1 text-xs text-gray-500">Used for filtering and reporting.</p>
        </div>
        <div>
          <label htmlFor="layoutType" className="block text-sm font-medium text-gray-700">
            Workpaper Layout
          </label>
          <Select
            id="layoutType"
            value={layoutType}
            onChange={(e) => setLayoutType(e.target.value)}
            options={workpaperLayoutOptions}
            className="mt-2"
          />
          <p className="mt-1 text-xs text-gray-500">Choose the cockpit pattern (two-pane, cash recon, fixed assets).</p>
        </div>
        <div>
          <label htmlFor="layoutConfig" className="block text-sm font-medium text-gray-700">
            Layout Config (JSON, optional)
          </label>
          <Textarea
            id="layoutConfig"
            value={layoutConfigRaw}
            onChange={(e) => setLayoutConfigRaw(e.target.value)}
            rows={layoutConfigRaw && layoutConfigRaw.length > 120 ? 6 : 3}
            placeholder='e.g., { "leftPanel": "pdf", "rightPanel": "grid" }'
            className="mt-2"
          />
          <p className="mt-1 text-xs text-gray-500">
            Use to define panel behavior (e.g., evidence on left, work grid on right). Leave blank for defaults.
          </p>
        </div>
        <div>
          <label htmlFor="caseStatus" className="block text-sm font-medium text-gray-700">
            Case Status
          </label>
          <Select
            id="caseStatus"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={statusOptions}
            className="mt-2"
          />
        </div>
      </div>

      <div>
        <label htmlFor="caseGroupSelection" className="block text-sm font-medium text-gray-700">
          Case Group (optional)
        </label>
        <Select
          id="caseGroupSelection"
          value={caseGroupSelection}
          onChange={(e) => setCaseGroupSelection(e.target.value)}
          options={caseGroupSelectOptions}
          className="mt-2"
        />
        <p className="mt-1 text-xs text-gray-500">Organize scenarios by cohort or curriculum. Leave as “No group” if not needed.</p>
      </div>

      {caseGroupSelection === '__custom' ? (
        <div>
          <label htmlFor="customCaseGroupId" className="block text-sm font-medium text-gray-700">
            Custom Group Identifier
          </label>
          <Input
            id="customCaseGroupId"
            value={customCaseGroupId}
            onChange={(e) => setCustomCaseGroupId(e.target.value)}
            placeholder="e.g., ap-advanced-spring"
            className="mt-2"
          />
          <p className="mt-1 text-xs text-gray-500">Use a lowercase slug that matches your reporting conventions.</p>
        </div>
      ) : null}
    </div>
  );
}
