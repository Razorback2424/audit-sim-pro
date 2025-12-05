import React from 'react';
import { Input } from '../../AppCore';
import StepIntro from './StepIntro';
import RosterMultiSelect from './RosterMultiSelect';

export default function AudienceScheduleStep({ audience }) {
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
    </div>
  );
}
