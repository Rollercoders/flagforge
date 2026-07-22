import { describe, it, expect } from 'vitest';
import { normalizeFlagType, resolveActiveValue, resolveDefaultValue, validateTypedValues } from '../flagValue';

describe('flagValue helpers', () => {
  it('normalizeFlagType defaults to boolean', () => {
    expect(normalizeFlagType(undefined)).toBe('boolean');
    expect(normalizeFlagType('nonsense')).toBe('boolean');
    expect(normalizeFlagType('number')).toBe('number');
    expect(normalizeFlagType('string')).toBe('string');
  });

  it('resolveActiveValue returns true for boolean, value otherwise', () => {
    expect(resolveActiveValue({ type: 'boolean' })).toBe(true);
    expect(resolveActiveValue({ type: undefined })).toBe(true);
    expect(resolveActiveValue({ type: 'number', value: 42 })).toBe(42);
    expect(resolveActiveValue({ type: 'string', value: 'hi' })).toBe('hi');
  });

  it('resolveDefaultValue returns false for boolean, defaultValue otherwise', () => {
    expect(resolveDefaultValue({ type: 'boolean' })).toBe(false);
    expect(resolveDefaultValue({ type: 'number', defaultValue: 0 })).toBe(0);
    expect(resolveDefaultValue({ type: 'string', defaultValue: 'off' })).toBe('off');
  });

  it('validateTypedValues requires matching types for number/string', () => {
    expect(validateTypedValues('boolean', undefined, undefined).ok).toBe(true);
    expect(validateTypedValues('number', 1, 0).ok).toBe(true);
    expect(validateTypedValues('number', 1, undefined).ok).toBe(false);
    expect(validateTypedValues('number', 'x', 0).ok).toBe(false);
    expect(validateTypedValues('string', 'a', 'b').ok).toBe(true);
    expect(validateTypedValues('string', 'a', 5).ok).toBe(false);
  });
});
