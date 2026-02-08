import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../AppCore';
import { ListFilter, Loader2, MoreHorizontal, Search, Users2, Wrench } from 'lucide-react';

const noop = () => {};

const AdvancedToolsMenu = ({
  canAccess,
  loadingAccess = false,
  onNavigateUserManagement = noop,
  onNavigateDataAudit = noop,
  onNavigateEntitlementDebug = noop,
  onRepairCases = noop,
  isRepairingCases = false,
  onAuditOrphanedInvoices = noop,
  isAuditingOrphanedInvoices = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const itemsRefs = useRef([]);

  const menuItems = useMemo(
    () => [
      {
        id: 'user-management',
        label: 'User Management',
        icon: Users2,
        onSelect: onNavigateUserManagement,
        disabled: false,
      },
      {
        id: 'data-audit',
        label: 'Data Audit',
        icon: ListFilter,
        onSelect: onNavigateDataAudit,
        disabled: false,
      },
      {
        id: 'entitlement-debug',
        label: 'Entitlement Debug',
        icon: Users2,
        onSelect: onNavigateEntitlementDebug,
        disabled: false,
      },
      {
        id: 'repair-cases',
        label: isRepairingCases ? 'Repairing cases…' : 'Repair Cases',
        icon: Wrench,
        onSelect: onRepairCases,
        disabled: isRepairingCases,
        inProgress: isRepairingCases,
      },
      {
        id: 'audit-orphaned-invoices',
        label: isAuditingOrphanedInvoices ? 'Checking invoices…' : 'Check orphaned invoices',
        icon: Search,
        onSelect: onAuditOrphanedInvoices,
        disabled: isAuditingOrphanedInvoices,
        inProgress: isAuditingOrphanedInvoices,
      },
    ],
    [
      onNavigateUserManagement,
      onNavigateDataAudit,
      onNavigateEntitlementDebug,
      onRepairCases,
      isRepairingCases,
      onAuditOrphanedInvoices,
      isAuditingOrphanedInvoices,
    ]
  );

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  const getNextEnabledIndex = useCallback(
    (startIndex, direction) => {
      if (!menuItems.length) return -1;
      let attempts = 0;
      let index = startIndex;
      const itemsCount = menuItems.length;
      do {
        index = (index + direction + itemsCount) % itemsCount;
        const item = menuItems[index];
        if (!item.disabled) {
          return index;
        }
        attempts += 1;
      } while (attempts < itemsCount);
      return -1;
    },
    [menuItems]
  );

  useEffect(() => {
    if (!isOpen) return;
    const firstEnabledIndex = getNextEnabledIndex(-1, 1);
    setActiveIndex(firstEnabledIndex);
  }, [getNextEnabledIndex, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (activeIndex === -1) return;
    const node = itemsRefs.current[activeIndex];
    if (node) {
      node.focus();
    }
  }, [activeIndex, isOpen]);

  const closeMenu = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const handleMenuKeyDown = (event) => {
    if (!isOpen) return;

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        const nextIndex = getNextEnabledIndex(activeIndex, 1);
        if (nextIndex !== -1) {
          setActiveIndex(nextIndex);
        }
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const nextIndex = getNextEnabledIndex(activeIndex, -1);
        if (nextIndex !== -1) {
          setActiveIndex(nextIndex);
        }
        break;
      }
      case 'Home': {
        event.preventDefault();
        const nextIndex = getNextEnabledIndex(-1, 1);
        if (nextIndex !== -1) {
          setActiveIndex(nextIndex);
        }
        break;
      }
      case 'End': {
        event.preventDefault();
        const nextIndex = getNextEnabledIndex(0, -1);
        if (nextIndex !== -1) {
          setActiveIndex(nextIndex);
        }
        break;
      }
      case 'Enter':
      case ' ': {
        event.preventDefault();
        if (activeIndex !== -1) {
          const item = menuItems[activeIndex];
          if (!item.disabled) {
            item.onSelect?.();
            setIsOpen(false);
            triggerRef.current?.focus();
          }
        }
        break;
      }
      case 'Tab': {
        event.preventDefault();
        const direction = event.shiftKey ? -1 : 1;
        const nextIndex = getNextEnabledIndex(activeIndex, direction);
        if (nextIndex !== -1) {
          setActiveIndex(nextIndex);
        }
        break;
      }
      case 'Escape': {
        event.preventDefault();
        closeMenu();
        break;
      }
      default:
        break;
    }
  };

  const handleTriggerKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setIsOpen(true);
    }
  };

  const handleItemClick = (item) => {
    if (item.disabled) return;
    item.onSelect?.();
    closeMenu();
  };

  useEffect(() => {
    if (!isOpen) {
      setActiveIndex(-1);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  if (loadingAccess) {
    return (
      <div className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-md bg-white shadow-sm">
        Checking access…
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="px-4 py-2 text-sm text-gray-500 border border-dashed border-gray-300 rounded-md bg-white shadow-sm" role="status">
        Advanced tools are only available to admin users.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative inline-flex text-left">
      <Button
        ref={triggerRef}
        variant="secondary"
        className="bg-white border border-gray-200 text-gray-700 shadow-sm hover:bg-gray-50"
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="advanced-tools-menu"
      >
        <MoreHorizontal size={18} className="mr-2" />
        Advanced tools
      </Button>
      {isOpen && (
        <div
          id="advanced-tools-menu"
          role="menu"
          aria-orientation="vertical"
          className="absolute right-0 mt-2 w-64 origin-top-right rounded-md border border-gray-200 bg-white shadow-xl focus:outline-none z-30"
          onKeyDown={handleMenuKeyDown}
        >
          <div className="py-1">
            {menuItems.map((item, index) => {
              const Icon = item.icon;
              const isActive = index === activeIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  ref={(el) => {
                    itemsRefs.current[index] = el;
                  }}
                  tabIndex={isActive ? 0 : -1}
                  className={`flex w-full items-center px-4 py-2 text-left text-sm transition-colors focus:outline-none ${
                    item.disabled
                      ? 'cursor-not-allowed text-gray-400'
                      : 'text-gray-700 hover:bg-blue-50 focus:bg-blue-50'
                  } ${isActive && !item.disabled ? 'bg-blue-50' : ''}`}
                  onClick={() => handleItemClick(item)}
                  onMouseEnter={() => setActiveIndex(index)}
                  onFocus={() => setActiveIndex(index)}
                  disabled={item.disabled}
                  aria-disabled={item.disabled}
                >
                  <Icon size={18} className="mr-3" />
                  <span className="flex-1">{item.label}</span>
                  {item.inProgress && <Loader2 size={16} className="animate-spin text-blue-600" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdvancedToolsMenu;
