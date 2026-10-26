// Compile-time guard: a validation finding carries its obligation class, whether it can be switched off, and where and how to fix it;
// a country's requirements carry the invoice-content registry's requirements.

import type { CountryRequirements, FindingFix, FixWhere, InvoiceContentRequirement, SendRejectionEntry } from '../src/types.js';

declare const _entry: SendRejectionEntry;
const _class: 'format_authority' | 'legal_content' | 'business_policy' | undefined = _entry.obligationClass;
const _suppressible: boolean | undefined = _entry.suppressible;
const _fix: FindingFix | undefined = _entry.fix;
const _where: FixWhere | undefined = _fix?.where;
const _label: string | undefined = _fix?.field?.label;
const _options: Array<{ value: string; label: string }> | undefined = _fix?.field?.options;
// @ts-expect-error 'elsewhere' is not a place a value can be supplied
const _badWhere: FixWhere = 'elsewhere';

declare const _country: CountryRequirements;
const _requirements: InvoiceContentRequirement[] | undefined = _country.invoiceContent?.requirements;
const _total: number | undefined = _country.invoiceContent?.total;
const _enforcement: 'ERROR' | 'WARNING' | 'NONE' | undefined = _requirements?.[0]?.enforcement;
const _paths: string[] | null | undefined = _requirements?.[0]?.requiredPaths;

void [_total, _class, _suppressible, _where, _label, _options, _badWhere, _enforcement, _paths];
