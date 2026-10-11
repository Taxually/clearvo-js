// Compile-time guard for the Filings surface: one request shape per setup action, the declaration is required to process a
// month, and the statuses stay closed.

import type {
  ClearvoClient,
  FilingStatus,
  FilingUploadFile,
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
const _noDeclaration: ProcessFilingUploadMonthInput = { acknowledgeRejectedRows: true };
const _process: ProcessFilingUploadMonthInput = { declarationAccepted: true, declarationVersion: '2026-10-11.1' };

// @ts-expect-error not a filing status
const _status: FilingStatus = 'RETRO';
const _file: FilingUploadFile['status'] = 'had_errors';

async function _use() {
  const f = await client.getFiling('fil_1');
  const _label: string = f.filing.statusLabel;
  const _v: number = f.filing.snapshotVersion;
  await client.approveFiling('fil_1', f.filing.snapshotVersion);
  const csv: string = await client.getFilingUploadTemplate('csv');
  const json = await client.getFilingUploadTemplate();
  const _cols: string = json.columns[0].column;
  const xlsx: ArrayBuffer = await client.getFilingUploadTemplate('xlsx');
  const month = await client.getFilingUploadMonth('2026-09');
  await client.processFilingUploadMonth('2026-09', { declarationAccepted: true, declarationVersion: month.month.declaration.version });
  void [_label, _v, csv, xlsx];
}
void [_request, _defer, _stop, _notAttested, _badStart, _noDeclaration, _process, _status, _file, _use];
