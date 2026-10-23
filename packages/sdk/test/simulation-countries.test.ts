import { describe, it, expect } from 'vitest';
import { SIMULATION_COUNTRY_CODES } from '../src/index';

describe('SIMULATION_COUNTRY_CODES', () => {
  it('is exactly the 24 countries the backend simulator supports', () => {
    expect([...SIMULATION_COUNTRY_CODES]).toEqual([
      'AE', 'AT', 'AU', 'BE', 'CH', 'DE', 'DK', 'EE', 'FI', 'FR', 'HR', 'IE',
      'IS', 'JP', 'LT', 'LU', 'LV', 'NL', 'NO', 'NZ', 'SE', 'SG', 'SI', 'SK',
    ]);
  });
});
