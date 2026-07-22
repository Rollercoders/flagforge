import { Flag, FlagEvaluationContext, FlagValue } from './types.js';
import { resolveActiveValue, resolveDefaultValue } from './flagValue.js';

export class FlagEvaluator {
  evaluate(flag: Flag, context: FlagEvaluationContext): FlagValue {
    return this.isOn(flag, context)
      ? resolveActiveValue(flag)
      : resolveDefaultValue(flag);
  }

  explain(flag: Flag, context: FlagEvaluationContext): { enabled: boolean; value: FlagValue; reason: string } {
    if (!flag.enabled) {
      return { enabled: false, value: resolveDefaultValue(flag), reason: 'disabled' };
    }
    if (flag.targeting && !this.matchesTargeting(flag.targeting, context)) {
      return { enabled: false, value: resolveDefaultValue(flag), reason: 'targeting-miss' };
    }
    if (flag.rollout && !this.matchesRollout(flag.rollout.percentage, context)) {
      return { enabled: false, value: resolveDefaultValue(flag), reason: 'rollout-excluded' };
    }
    return { enabled: true, value: resolveActiveValue(flag), reason: 'enabled' };
  }

  private isOn(flag: Flag, context: FlagEvaluationContext): boolean {
    if (!flag.enabled) return false;
    if (flag.targeting && !this.matchesTargeting(flag.targeting, context)) return false;
    if (flag.rollout) return this.matchesRollout(flag.rollout.percentage, context);
    return true;
  }

  private matchesTargeting(targeting: NonNullable<Flag['targeting']>, context: FlagEvaluationContext): boolean {
    if (targeting.userIds && context.userId) {
      if (targeting.userIds.includes(context.userId)) return true;
    }
    if (targeting.attributes && context.attributes) {
      for (const [key, values] of Object.entries(targeting.attributes)) {
        if (context.attributes[key] && values.includes(context.attributes[key])) return true;
      }
    }
    return false;
  }

  private matchesRollout(percentage: number, context: FlagEvaluationContext): boolean {
    if (!context.userId) return false;
    const hash = this.hashString(context.userId);
    return (hash % 100) < percentage;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
}
