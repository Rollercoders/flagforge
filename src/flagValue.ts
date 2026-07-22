import { Flag, FlagType, FlagValue } from './types.js';

export function normalizeFlagType(type: unknown): FlagType {
  return type === 'number' || type === 'string' ? type : 'boolean';
}

export function resolveActiveValue(flag: Pick<Flag, 'type' | 'value'>): FlagValue {
  if (normalizeFlagType(flag.type) === 'boolean') return true;
  return flag.value as FlagValue;
}

export function resolveDefaultValue(flag: Pick<Flag, 'type' | 'defaultValue'>): FlagValue {
  if (normalizeFlagType(flag.type) === 'boolean') return false;
  return flag.defaultValue as FlagValue;
}

export function validateTypedValues(
  type: FlagType,
  value: unknown,
  defaultValue: unknown,
): { ok: true } | { ok: false; error: string } {
  if (type === 'boolean') return { ok: true };
  const jsType = type === 'number' ? 'number' : 'string';
  if (typeof value !== jsType) {
    return { ok: false, error: `value must be a ${jsType} for a ${type} flag` };
  }
  if (typeof defaultValue !== jsType) {
    return { ok: false, error: `defaultValue must be a ${jsType} for a ${type} flag` };
  }
  return { ok: true };
}
