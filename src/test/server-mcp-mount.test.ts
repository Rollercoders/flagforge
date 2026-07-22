import { describe, it, expect } from 'vitest';
import { shouldMountMcp } from '../server.js';

// The /mcp gating is extracted into a pure function to avoid having to start
// a real HTTP listener in the tests (startServer doesn't expose a handle to
// close it, which would make an end-to-end test with fixed ports unstable).
// The behavior of the mounted router is already covered by src/test/mcp-server.test.ts (Task 4).
describe('shouldMountMcp', () => {
  it('token undefined => false', () => {
    expect(shouldMountMcp(undefined)).toBe(false);
  });

  it('empty token => false', () => {
    expect(shouldMountMcp('')).toBe(false);
  });

  it('token with only spaces => false', () => {
    expect(shouldMountMcp('   ')).toBe(false);
  });

  it('token present => true', () => {
    expect(shouldMountMcp('x')).toBe(true);
  });
});
