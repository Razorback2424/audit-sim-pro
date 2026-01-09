import { render, screen } from '@testing-library/react';
import AttachmentsStep from './AttachmentsStep';
import { AUDIT_AREAS } from '../../models/caseConstants';

jest.mock('../../AppCore', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  Input: (props) => <input {...props} />,
}));

describe('AttachmentsStep', () => {
  const baseAttachments = {
    disbursements: [],
    referenceDocuments: [],
    handleReferenceDocChange: jest.fn(),
    addReferenceDocument: jest.fn(),
    removeReferenceDocument: jest.fn(),
    handleReferenceDocFileSelect: jest.fn(),
    cashArtifacts: [],
    handleCashArtifactChange: jest.fn(),
    handleCashArtifactFileSelect: jest.fn(),
    auditArea: AUDIT_AREAS.SURL,
  };

  const baseFiles = {
    FILE_INPUT_ACCEPT: '.pdf',
  };

  test('shows generation progress based on recipe specs even before docs exist', () => {
    render(
      <AttachmentsStep
        attachments={baseAttachments}
        files={baseFiles}
        generation={{
          generationPlan: {
            referenceDocumentSpecs: [{ id: 'spec-1' }, { id: 'spec-2' }],
            lastJob: { status: 'queued' },
          },
          generationPolling: false,
          queueGenerationJob: jest.fn(),
        }}
      />
    );

    expect(screen.getByRole('button', { name: /Generating PDFs/i })).toBeInTheDocument();
    expect(screen.getByText(/0 of 2 PDFs generated/i)).toBeInTheDocument();
    expect(screen.getByText('Generating PDFs', { selector: 'span' })).toBeInTheDocument();
  });
});
