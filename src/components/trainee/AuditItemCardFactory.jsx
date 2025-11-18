import React from 'react';
import TransactionItemCard from './items/TransactionItemCard';

export default function AuditItemCardFactory(props) {
  const { item } = props;
  switch (item?.type) {
    case 'inventory_count':
      return <div className="rounded-md border border-gray-200 p-4 bg-white">Inventory card coming soon.</div>;
    case 'transaction':
    default:
      return <TransactionItemCard {...props} />;
  }
}
