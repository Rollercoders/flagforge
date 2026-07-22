import { Flag, FlagEvaluationContext } from './types';

export class FlagEvaluator {
  evaluate(flag: Flag, context: FlagEvaluationContext): boolean {
    if (!flag.enabled) {
      return false;
    }

    // Check targeting rules
    if (flag.targeting) {
      if (!this.matchesTargeting(flag.targeting, context)) {
        return false;
      }
    }

    // Check rollout percentage
    if (flag.rollout) {
      return this.matchesRollout(flag.rollout.percentage, context);
    }

    return true;
  }

  explain(flag: Flag, context: FlagEvaluationContext): { enabled: boolean; reason: string } {
    if (!flag.enabled) {
      return { enabled: false, reason: 'disabled' };
    }

    if (flag.targeting) {
      if (!this.matchesTargeting(flag.targeting, context)) {
        return { enabled: false, reason: 'targeting-miss' };
      }
    }

    if (flag.rollout) {
      if (!this.matchesRollout(flag.rollout.percentage, context)) {
        return { enabled: false, reason: 'rollout-excluded' };
      }
    }

    return { enabled: true, reason: 'enabled' };
  }

  private matchesTargeting(targeting: NonNullable<Flag['targeting']>, context: FlagEvaluationContext): boolean {
    if (targeting.userIds && context.userId) {
      if (targeting.userIds.includes(context.userId)) {
        return true;
      }
    }

    if (targeting.attributes && context.attributes) {
      for (const [key, values] of Object.entries(targeting.attributes)) {
        if (context.attributes[key] && values.includes(context.attributes[key])) {
          return true;
        }
      }
    }

    return false;
  }

  private matchesRollout(percentage: number, context: FlagEvaluationContext): boolean {
    if (!context.userId) {
      return false;
    }

    const hash = this.hashString(context.userId);
    const bucket = hash % 100;

    return bucket < percentage;
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
