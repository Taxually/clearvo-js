/**
 * Countries the sandbox simulator for received invoices (`simulateReceivedInvoices`) can create documents for.
 * The MCP server and the CLI repeat this list; `npm run test:simulation-countries` fails when any copy drifts.
 */
export const SIMULATION_COUNTRY_CODES = [
  'AE', 'AT', 'AU', 'BE', 'CH', 'DE', 'DK', 'EE', 'FI', 'FR', 'HR', 'IE',
  'IS', 'JP', 'LT', 'LU', 'LV', 'NL', 'NO', 'NZ', 'SE', 'SG', 'SI', 'SK',
] as const;

export type SimulationCountryCode = (typeof SIMULATION_COUNTRY_CODES)[number];
