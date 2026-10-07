import { describe, it, expect } from 'vitest';
import { resolveHost, displayUrl } from '../server.js';

describe('resolveHost', () => {
  it('host undefined => 127.0.0.1', () => {
    expect(resolveHost(undefined)).toBe('127.0.0.1');
  });

  it('empty or blank host => 127.0.0.1', () => {
    expect(resolveHost('')).toBe('127.0.0.1');
    expect(resolveHost('   ')).toBe('127.0.0.1');
  });

  it('localhost => 127.0.0.1 (avoids binding to ::1 only)', () => {
    expect(resolveHost('localhost')).toBe('127.0.0.1');
    expect(resolveHost(' LocalHost ')).toBe('127.0.0.1');
  });

  it('explicit host is kept (trimmed)', () => {
    expect(resolveHost('0.0.0.0')).toBe('0.0.0.0');
    expect(resolveHost(' 192.168.1.50 ')).toBe('192.168.1.50');
  });
});

describe('displayUrl', () => {
  it('shows localhost for the default loopback', () => {
    expect(displayUrl('127.0.0.1', 6789)).toBe('http://localhost:6789');
  });

  it('shows the explicit host', () => {
    expect(displayUrl('192.168.1.50', 6789)).toBe('http://192.168.1.50:6789');
  });

  it('wraps IPv6 addresses in brackets', () => {
    expect(displayUrl('::1', 6789)).toBe('http://[::1]:6789');
  });
});
