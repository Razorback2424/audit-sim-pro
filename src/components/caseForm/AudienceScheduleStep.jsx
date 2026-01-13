import React from 'react';
import { Input, Select, Textarea } from '../../AppCore';
import StepIntro from './StepIntro';
import RosterMultiSelect from './RosterMultiSelect';

export default function AudienceScheduleStep({ audience, basics }) {
  const {
    publicVisible,
    setPublicVisible,
    selectedUserIds,
    setSelectedUserIds,
    rosterOptions,
    rosterLoading,
    rosterError,
    opensAtStr,
    setOpensAtStr,
    dueAtStr,
    setDueAtStr,
  } = audience;
  const {
    caseName,
    setCaseName,
    layoutType,
    setLayoutType,
    workpaperLayoutOptions,
    layoutConfigRaw,
    setLayoutConfigRaw,
    caseGroupSelection,
    setCaseGroupSelection,
    caseGroupSelectOptions,
    customCaseGroupId,
    setCustomCaseGroupId,
    status,
    setStatus,
    statusOptions,
  } = basics || {};

  return (
    <div className="space-y-6">
      <StepIntro
        title="Focus for this step"
        items={[
          'Decide who should see the case.',
          'Add or remove specific trainees when privacy is needed.',
          'Set optional open and due dates so trainees see a clear timeline.'
        ]}
        helper="Private cases must have at least one trainee selected. You can leave the schedule blank if timing is flexible."
      />

      <div className="rounded-lg border border-gray-200 p-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-800">Audience</h3>
            <p className="mt-1 text-xs text-gray-500">Limit visibility to specific trainees or keep it open to everyone.</p>
          </div>
          <label className="inline-flex items-center space-x-2 text-sm">
            <input
              id="publicVisible"
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              checked={publicVisible}
              onChange={(e) => setPublicVisible(e.target.checked)}
            />
            <span className="text-gray-700">Visible to all signed-in trainees</span>
          </label>
        </div>
        {!publicVisible ? (
          <div className="mt-4">
            <label htmlFor="visibleToUserIds" className="block text-sm font-medium text-gray-700">
              Visible to Specific Users
            </label>
            <RosterMultiSelect
              id="visibleToUserIds"
              options={rosterOptions}
              value={selectedUserIds}
              onChange={setSelectedUserIds}
              disabled={publicVisible || rosterLoading}
              loading={rosterLoading}
              placeholder="Search by name, email, or ID"
            />
            <p className="mt-1 text-xs text-gray-500">Select one or more users who should see this case.</p>
            {rosterError ? (
              <p className="mt-1 text-xs text-red-600">
                {rosterError} You can still type a user ID and press Enter to add it manually.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 text-xs text-gray-500">This case is currently visible to all trainees.</p>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 p-4">
        <h3 className="text-base font-semibold text-gray-800">Schedule</h3>
        <p className="mt-1 text-xs text-gray-500">Times are stored in UTC and shown in the trainee’s local timezone.</p>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="opensAt" className="block text-sm font-medium text-gray-700">
              Opens At (UTC)
            </label>
            <Input
              id="opensAt"
              type="datetime-local"
              value={opensAtStr}
              onChange={(e) => setOpensAtStr(e.target.value)}
              className="mt-2"
            />
            <p className="mt-1 text-xs text-gray-500">Optional. Trainees will see the case after this time.</p>
          </div>
          <div>
            <label htmlFor="dueAt" className="block text-sm font-medium text-gray-700">
              Due At (UTC)
            </label>
            <Input
              id="dueAt"
              type="datetime-local"
              value={dueAtStr}
              onChange={(e) => setDueAtStr(e.target.value)}
              className="mt-2"
            />
            <p className="mt-1 text-xs text-gray-500">Optional deadline for trainees.</p>
          </div>
        </div>
      </div>

      {basics ? (
        <details className="rounded-lg border border-gray-200 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-gray-700">
            Case settings (advanced)
          </summary>
          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="caseName" className="block text-sm font-medium text-gray-700">
                Case Name
              </label>
              <Input
                id="caseName"
                value={caseName || ''}
                onChange={(e) => setCaseName?.(e.target.value)}
                placeholder="e.g., Q1 Unrecorded Liabilities Review"
                className="mt-2"
              />
              <p className="mt-1 text-xs text-gray-500">Override the auto-generated name if needed.</p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label htmlFor="caseStatus" className="block text-sm font-medium text-gray-700">
                  Case Status
                </label>
                <Select
                  id="caseStatus"
                  value={status || 'assigned'}
                  onChange={(e) => setStatus?.(e.target.value)}
                  options={statusOptions || []}
                  className="mt-2"
                />
              </div>
              <div>
                <label htmlFor="layoutType" className="block text-sm font-medium text-gray-700">
                  Workpaper Layout
                </label>
                <Select
                  id="layoutType"
                  value={layoutType || ''}
                  onChange={(e) => setLayoutType?.(e.target.value)}
                  options={workpaperLayoutOptions || []}
                  className="mt-2"
                />
              </div>
              <div>
                <label htmlFor="caseGroupSelection" className="block text-sm font-medium text-gray-700">
                  Case Group
                </label>
                <Select
                  id="caseGroupSelection"
                  value={caseGroupSelection || '__none'}
                  onChange={(e) => setCaseGroupSelection?.(e.target.value)}
                  options={caseGroupSelectOptions || []}
                  className="mt-2"
                />
              </div>
            </div>

            {caseGroupSelection === '__custom' ? (
              <div>
                <label htmlFor="customCaseGroupId" className="block text-sm font-medium text-gray-700">
                  Custom Group Identifier
                </label>
                <Input
                  id="customCaseGroupId"
                  value={customCaseGroupId || ''}
                  onChange={(e) => setCustomCaseGroupId?.(e.target.value)}
                  placeholder="e.g., ap-advanced-spring"
                  className="mt-2"
                />
              </div>
            ) : null}

            <div>
              <label htmlFor="layoutConfig" className="block text-sm font-medium text-gray-700">
                Layout Config (JSON, optional)
              </label>
              <Textarea
                id="layoutConfig"
                value={layoutConfigRaw || ''}
                onChange={(e) => setLayoutConfigRaw?.(e.target.value)}
                rows={layoutConfigRaw && layoutConfigRaw.length > 120 ? 6 : 3}
                placeholder='e.g., { "leftPanel": "pdf", "rightPanel": "grid" }'
                className="mt-2"
              />
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}
