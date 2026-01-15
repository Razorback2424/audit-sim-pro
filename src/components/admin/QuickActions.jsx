import React from 'react';
import { Users, AlertTriangle, ClipboardList, FolderKanban } from 'lucide-react';
import { Button } from '../../AppCore';

const ACTIONS = [
  {
    key: 'manage-cases',
    label: 'Manage cases',
    description: 'Review active cases and delete stale drafts.',
    icon: FolderKanban,
    path: '/admin/cases',
  },
  {
    key: 'manage-users',
    label: 'Manage roster',
    description: 'Adjust admin or trainee access levels.',
    icon: Users,
    path: '/admin/user-management',
  },
  {
    key: 'review-alerts',
    label: 'Resolve alerts',
    description: 'Jump to cases needing setup fixes.',
    icon: AlertTriangle,
    path: '/admin/case-data-audit?tab=alerts',
  },
  {
    key: 'check-submissions',
    label: 'Check submissions',
    description: 'Monitor trainee work across cases.',
    icon: ClipboardList,
    path: '/admin#cases',
  },
];

const QuickActions = ({ onNavigate }) => {
  return (
    <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-800">Quick actions</h2>
        <button
          type="button"
          onClick={() => onNavigate?.('/admin/cases')}
          className="text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          See all
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3">
        {ACTIONS.map(({ key, label, description, icon: Icon, path }) => (
          <div key={key} className="flex items-center justify-between bg-gray-50 rounded-md p-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-gray-700">{label}</p>
              <p className="text-sm text-gray-500">{description}</p>
            </div>
            <Button
              onClick={() => onNavigate?.(path)}
              variant="secondary"
              className="ml-4 flex items-center gap-2"
            >
              <Icon size={16} />
              Go
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
};

export default QuickActions;
