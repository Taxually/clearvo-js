import type { TaxNumberValidateResponse, TaxNumberBatchItem, NameMatch } from '../src/index';

const item: TaxNumberBatchItem = { countryCode: 'RO', taxNumber: 'RO1', companyName: 'Acme SRL' };
declare const r: TaxNumberValidateResponse;
const nm: NameMatch | undefined = r.nameMatch;
const status: 'exact' | 'close' | 'mismatch' | 'authority_name_unavailable' | 'not_provided' | undefined = nm?.status;
const extra: Record<string, unknown> | undefined = r.authority?.extra;
void item; void status; void extra;
