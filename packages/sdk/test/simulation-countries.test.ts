import { describe, it, expect } from 'vitest';
import { SIMULATION_COUNTRY_CODES, SIMULATION_SCENARIOS, SIMULATION_SCENARIO_IDS } from '../src/index';

describe('SIMULATION_COUNTRY_CODES', () => {
  it('is exactly the 24 countries the backend simulator supports', () => {
    expect([...SIMULATION_COUNTRY_CODES]).toEqual([
      'AE', 'AT', 'AU', 'BE', 'CH', 'DE', 'DK', 'EE', 'FI', 'FR', 'HR', 'IE',
      'IS', 'JP', 'LT', 'LU', 'LV', 'NL', 'NO', 'NZ', 'SE', 'SG', 'SI', 'SK',
    ]);
  });
});

describe('SIMULATION_SCENARIOS', () => {
  it('lists the 14 scenarios the backend simulator supports, each with a description', () => {
    expect([...SIMULATION_SCENARIO_IDS]).toEqual([
      'standard', 'credit_note_for_existing', 'warnings_only', 'needs_review_format', 'needs_review_business_rules', 'duplicate',
      'duplicate_exact', 'with_references', 'with_payment_terms', 'with_attachment', 'with_discounts', 'many_lines', 'unicode_text', 'foreign_supplier',
    ]);
    for (const s of SIMULATION_SCENARIOS) expect(s.description.length).toBeGreaterThan(20);
  });
});
