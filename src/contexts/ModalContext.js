import React, { createContext, useCallback, useContext, useState } from 'react';
import { XCircle } from 'lucide-react';
import { Button } from '../components/ui/Button';

const ModalContext = createContext({
  showModal: () => {},
  hideModal: () => {},
});

export const ModalProvider = ({ children }) => {
  const [modalContent, setModalContent] = useState(null);

  const showModal = useCallback((message, title = 'Notification', customActions = null) => {
    setModalContent({ title, message, customActions });
  }, []);

  const hideModal = useCallback(() => {
    setModalContent(null);
  }, []);

  return (
    <ModalContext.Provider value={{ showModal, hideModal }}>
      {children}
      {modalContent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md transform transition-all">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold text-gray-800">{modalContent.title}</h3>
              <button
                onClick={hideModal}
                className="p-1 rounded-md hover:bg-gray-200 transition-colors"
              >
                <XCircle size={24} className="text-gray-600" />
              </button>
            </div>
            <div>
              {React.isValidElement(modalContent.message) ? (
                modalContent.message
              ) : (
                <p className="text-gray-700 whitespace-pre-wrap">{modalContent.message}</p>
              )}
            </div>
            <div className="mt-6 flex justify-end space-x-3">
              {modalContent.customActions ? (
                modalContent.customActions(hideModal)
              ) : (
                <Button onClick={hideModal} variant="primary">
                  Close
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </ModalContext.Provider>
  );
};

export const useModal = () => useContext(ModalContext);
