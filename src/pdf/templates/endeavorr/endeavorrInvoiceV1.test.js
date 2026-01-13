import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { endeavorrInvoiceV1 } from './endeavorrInvoiceV1';

describe('endeavorrInvoiceV1', () => {
  test('renders long vendor name with compact brand class', () => {
    const longBrand = 'Northwind Office Furniture Distribution Group';
    const data = {
      brandName: longBrand,
      invoiceNumber: 'INV-9999',
      invoiceDate: 'March 1, 20X3',
      issuedTo: { name: 'Team Up Promotional Products, LLC' },
      shippingInfo: { dateShipped: 'March 2, 20X3', terms: 'Shipping Point' },
      items: [
        { description: 'Service line item', qty: 2, unitPrice: 150 },
        { description: 'Materials', qty: 4, unitPrice: 50 },
      ],
      taxRate: 0.0825,
      shipping: 125,
    };

    const { Component } = endeavorrInvoiceV1;
    const html = renderToStaticMarkup(<Component data={data} />);
    expect(html).toContain('brand tiny');
    expect(html).toContain(longBrand);
  });
});
