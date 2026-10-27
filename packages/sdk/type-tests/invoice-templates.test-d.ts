// Compile-time guard: invoiceTemplate on the send input and on send / invoice results; the template definition is closed.

import type {
  SubmitInvoiceInput,
  SendResult,
  InvoiceRecordTimestamps,
  InvoiceTemplateDefinition,
  InvoiceTemplateEcho,
} from '../src/types.js';

type Assert<T extends true> = T;
type IsEqual<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

type _InputField = Assert<IsEqual<SubmitInvoiceInput['invoiceTemplate'], string | undefined>>;
type _SendEcho = Assert<IsEqual<SendResult['invoiceTemplate'], InvoiceTemplateEcho | null | undefined>>;
type _RecordEcho = Assert<IsEqual<InvoiceRecordTimestamps['invoiceTemplate'], InvoiceTemplateEcho | null | undefined>>;

const _ok: InvoiceTemplateDefinition = {
  schemaVersion: 1,
  background: { asset: 'letterhead', pages: 'all', fit: 'width' },
  body: [{ kind: 'columns', left: [{ kind: 'section', section: 'parties' }], right: [{ kind: 'item', key: 'invoice_number' }] }],
};

// @ts-expect-error — schemaVersion is the literal 1.
const _badVersion: InvoiceTemplateDefinition = { schemaVersion: 2, body: [] };
// @ts-expect-error — a background pages value is 'first' or 'all'.
const _badPages: InvoiceTemplateDefinition = { schemaVersion: 1, body: [], background: { asset: 'x', pages: 'some' } };
