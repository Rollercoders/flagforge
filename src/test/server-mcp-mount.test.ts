import { describe, it, expect } from 'vitest';
import { shouldMountMcp } from '../server.js';

// Il gating di /mcp è estratto in una funzione pura per evitare di dover avviare
// un listener HTTP reale nei test (startServer non espone un handle per chiuderlo,
// il che renderebbe instabile un test end-to-end con porte fisse).
// Il comportamento del router montato è già coperto da src/test/mcp-server.test.ts (Task 4).
describe('shouldMountMcp', () => {
  it('token undefined => false', () => {
    expect(shouldMountMcp(undefined)).toBe(false);
  });

  it('token vuoto => false', () => {
    expect(shouldMountMcp('')).toBe(false);
  });

  it('token con soli spazi => false', () => {
    expect(shouldMountMcp('   ')).toBe(false);
  });

  it('token presente => true', () => {
    expect(shouldMountMcp('x')).toBe(true);
  });
});
