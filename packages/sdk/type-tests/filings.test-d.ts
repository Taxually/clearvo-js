// Compile-time guard for the Filings surface: one request shape per setup action, the declaration is required to process a
// month, and the statuses stay closed.

import type {
  ClearvoClient,
  ClearvoError,
  FilingSetup,
  FilingStatus,
  FilingUploadFile,
  FilingUploadMonth,
  ProcessFilingUploadMonthInput,
  UpdateRegistrationFilingSetupInput,
} from '../src/index.js';

declare const client: ClearvoClient;

const _request: UpdateRegistrationFilingSetupInput = { frequencyCode: 'Monthly', frequencyAttested: true, startChoice: 'asap' };
const _defer: UpdateRegistrationFilingSetupInput = { deferFirstPeriodTo: '2026-12-01' };
const _stop: UpdateRegistrationFilingSetupInput = { stop: true };
// @ts-expect-error frequencyAttested must be literally true
const _notAttested: UpdateRegistrationFilingSetupInput = { frequencyCode: 'Monthly', frequencyAttested: false, startChoice: 'asap' };
// @ts-expect-error startChoice is asap or later
const _badStart: UpdateRegistrationFilingSetupInput = { frequencyCode: 'Monthly', frequencyAttested: true, startChoice: 'whenever' };

// @ts-expect-error the declaration is required to process a month
const _noDeclaration: ProcessFilingUploadMonthInput = {};
// @ts-expect-error acknowledgeRejectedRows was removed: a file with errors blocks the month until fixed or removed
const _noAck: ProcessFilingUploadMonthInput = { declarationAccepted: true, declarationVersion: '2026-10-13.1', acknowledgeRejectedRows: true };
const _process: ProcessFilingUploadMonthInput = { declarationAccepted: true, declarationVersion: '2026-10-13.1' };
// @ts-expect-error there is no close action on a month
const _close: FilingUploadMonth['allowedActions']['close'] = true;

// @ts-expect-error not a filing status
const _status: FilingStatus = 'RETRO';
const _file: FilingUploadFile['status'] = 'had_errors';

async function _use() {
  const f = await client.getFiling('fil_1');
  const _label: string = f.filing.statusLabel;
  const _v: number | undefined = f.filing.snapshotVersion;
  await client.approveFiling('fil_1', f.filing.snapshotVersion);
  await client.approveFiling('ret_1');
  const _live: FilingStatus = 'READY_FOR_APPROVAL';
  const doc = await client.downloadFilingDocument('ret_1', '11111111-2222-4333-8444-555555555555');
  void [_live, doc.contentType];
  const csv: string = await client.getFilingUploadTemplate('csv');
  const json = await client.getFilingUploadTemplate();
  const _cols: string = json.columns[0].column;
  const xlsx: ArrayBuffer = await client.getFilingUploadTemplate('xlsx');
  const month = await client.getFilingUploadMonth('2026-09');
  await client.processFilingUploadMonth('2026-09', { declarationAccepted: true, declarationVersion: month.month.declaration.version });
  void [_label, _v, csv, xlsx];
}
void [_request, _defer, _stop, _notAttested, _badStart, _noDeclaration, _noAck, _process, _close, _status, _file, _use];

// frequencyOptionsSource is closed (live | fallback); the error body's extra fields are typed.
// @ts-expect-error not an allowed source
const _badSource: FilingSetup['frequencyOptionsSource'] = 'cached';
declare const _err: ClearvoError;
const _existing: string | undefined = _err.body?.existingId;
const _filesWithErrors: number | undefined = _err.body?.filesWithErrors;
const _contactUrl: string | undefined = _err.body?.contactUrl;
const _declaration: { version: string; text: string } | undefined = _err.body?.declaration;
