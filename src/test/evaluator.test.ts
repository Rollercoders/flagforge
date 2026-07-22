import { describe, it, expect } from 'vitest';
import { FlagEvaluator } from '../evaluator';
import { Flag, FlagEvaluationContext } from '../types';

describe('FlagEvaluator', () => {
  const evaluator = new FlagEvaluator();

  const createFlag = (overrides: Partial<Flag> = {}): Flag => ({
    id: 'test-id',
    projectId: '__test__',
    key: 'test-flag',
    name: 'Test Flag',
    enabled: true,
    environment: 'test',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  });

  describe('Basic flag evaluation', () => {
    it('should return false when flag is disabled', () => {
      const flag = createFlag({ enabled: false });
      const context: FlagEvaluationContext = { userId: 'user-1' };

      const result = evaluator.evaluate(flag, context);

      expect(result).toBe(false);
    });

    it('should return true when flag is enabled with no targeting or rollout', () => {
      const flag = createFlag({ enabled: true });
      const context: FlagEvaluationContext = { userId: 'user-1' };

      const result = evaluator.evaluate(flag, context);

      expect(result).toBe(true);
    });
  });

  describe('User targeting', () => {
    it('should return true when userId is in targeting list', () => {
      const flag = createFlag({
        enabled: true,
        targeting: {
          userIds: ['user-1', 'user-2', 'user-3']
        }
      });
      const context: FlagEvaluationContext = { userId: 'user-2' };

      const result = evaluator.evaluate(flag, context);

      expect(result).toBe(true);
    });

    it('should return false when userId is not in targeting list', () => {
      const flag = createFlag({
        enabled: true,
        targeting: {
          userIds: ['user-1', 'user-2']
        }
      });
      const context: FlagEvaluationContext = { userId: 'user-999' };

      const result = evaluator.evaluate(flag, context);

      expect(result).toBe(false);
    });

    it('should return false when no userId in context but targeting is set', () => {
      const flag = createFlag({
        enabled: true,
        targeting: {
          userIds: ['user-1']
        }
      });
      const context: FlagEvaluationContext = {};

      const result = evaluator.evaluate(flag, context);

      expect(result).toBe(false);
    });
  });

  describe('Attribute targeting', () => {
    it('should return true when user has matching attribute', () => {
      const flag = createFlag({
        enabled: true,
        targeting: {
          attributes: {
            plan: ['premium', 'enterprise'],
            region: ['us-west']
          }
        }
      });
      const context: FlagEvaluationContext = {
        userId: 'user-1',
        attributes: {
          plan: 'premium',
          region: 'us-east'
        }
      };

      const result = evaluator.evaluate(flag, context);

      expect(result).toBe(true);
    });

    it('should return false when user attributes do not match', () => {
      const flag = createFlag({
        enabled: true,
        targeting: {
          attributes: {
            plan: ['premium', 'enterprise']
          }
        }
      });
      const context: FlagEvaluationContext = {
        userId: 'user-1',
        attributes: {
          plan: 'free'
        }
      };

      const result = evaluator.evaluate(flag, context);

      expect(result).toBe(false);
    });

    it('should return false when no attributes in context', () => {
      const flag = createFlag({
        enabled: true,
        targeting: {
          attributes: {
            plan: ['premium']
          }
        }
      });
      const context: FlagEvaluationContext = {
        userId: 'user-1'
      };

      const result = evaluator.evaluate(flag, context);

      expect(result).toBe(false);
    });
  });

  describe('Combined targeting (userIds and attributes)', () => {
    it('should return true when userId matches (OR logic)', () => {
      const flag = createFlag({
        enabled: true,
        targeting: {
          userIds: ['user-1'],
          attributes: {
            plan: ['premium']
          }
        }
      });
      const context: FlagEvaluationContext = {
        userId: 'user-1',
        attributes: {
          plan: 'free'
        }
      };

      const result = evaluator.evaluate(flag, context);

      expect(result).toBe(true);
    });

    it('should return true when attributes match (OR logic)', () => {
      const flag = createFlag({
        enabled: true,
        targeting: {
          userIds: ['user-999'],
          attributes: {
            plan: ['premium']
          }
        }
      });
      const context: FlagEvaluationContext = {
        userId: 'user-1',
        attributes: {
          plan: 'premium'
        }
      };

      const result = evaluator.evaluate(flag, context);

      expect(result).toBe(true);
    });
  });

  describe('Percentage rollout', () => {
    it('should return false when no userId is provided', () => {
      const flag = createFlag({
        enabled: true,
        rollout: {
          percentage: 100
        }
      });
      const context: FlagEvaluationContext = {};

      const result = evaluator.evaluate(flag, context);

      expect(result).toBe(false);
    });

    it('should return true for 100% rollout', () => {
      const flag = createFlag({
        enabled: true,
        rollout: {
          percentage: 100
        }
      });
      const context: FlagEvaluationContext = { userId: 'user-1' };

      const result = evaluator.evaluate(flag, context);

      expect(result).toBe(true);
    });

    it('should return false for 0% rollout', () => {
      const flag = createFlag({
        enabled: true,
        rollout: {
          percentage: 0
        }
      });
      const context: FlagEvaluationContext = { userId: 'user-1' };

      const result = evaluator.evaluate(flag, context);

      expect(result).toBe(false);
    });

    it('should consistently return same result for same userId', () => {
      const flag = createFlag({
        enabled: true,
        rollout: {
          percentage: 50
        }
      });
      const context: FlagEvaluationContext = { userId: 'user-consistent' };

      const result1 = evaluator.evaluate(flag, context);
      const result2 = evaluator.evaluate(flag, context);
      const result3 = evaluator.evaluate(flag, context);

      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });

    it('should distribute users across rollout percentage', () => {
      const flag = createFlag({
        enabled: true,
        rollout: {
          percentage: 50
        }
      });

      let enabledCount = 0;
      const totalUsers = 1000;

      for (let i = 0; i < totalUsers; i++) {
        const context: FlagEvaluationContext = { userId: `user-${i}` };
        if (evaluator.evaluate(flag, context)) {
          enabledCount++;
        }
      }

      const actualPercentage = (enabledCount / totalUsers) * 100;

      // Should be approximately 50% (within 10% tolerance)
      expect(actualPercentage).toBeGreaterThan(40);
      expect(actualPercentage).toBeLessThan(60);
    });
  });

  describe('Targeting with rollout', () => {
    it('should return false when targeting does not match, even with 100% rollout', () => {
      const flag = createFlag({
        enabled: true,
        targeting: {
          userIds: ['user-999']
        },
        rollout: {
          percentage: 100
        }
      });
      const context: FlagEvaluationContext = { userId: 'user-1' };

      const result = evaluator.evaluate(flag, context);

      expect(result).toBe(false);
    });

    it('should apply rollout after targeting passes', () => {
      const flag = createFlag({
        enabled: true,
        targeting: {
          userIds: ['user-1']
        },
        rollout: {
          percentage: 0
        }
      });
      const context: FlagEvaluationContext = { userId: 'user-1' };

      const result = evaluator.evaluate(flag, context);

      expect(result).toBe(false);
    });
  });

  describe('explain', () => {
    it('should return disabled reason when flag is disabled', () => {
      const flag = createFlag({ enabled: false });
      const context: FlagEvaluationContext = { userId: 'user-1' };

      const result = evaluator.explain(flag, context);

      expect(result).toEqual({ enabled: false, value: false, reason: 'disabled' });
    });

    it('should return targeting-miss reason when targeting does not match', () => {
      const flag = createFlag({
        enabled: true,
        targeting: { userIds: ['a'] }
      });
      const context: FlagEvaluationContext = { userId: 'b' };

      const result = evaluator.explain(flag, context);

      expect(result).toEqual({ enabled: false, value: false, reason: 'targeting-miss' });
    });

    it('should return enabled reason when targeting matches and no rollout', () => {
      const flag = createFlag({
        enabled: true,
        targeting: { userIds: ['a'] }
      });
      const context: FlagEvaluationContext = { userId: 'a' };

      const result = evaluator.explain(flag, context);

      expect(result).toEqual({ enabled: true, value: true, reason: 'enabled' });
    });

    it('should return rollout-excluded reason when rollout percentage is 0', () => {
      const flag = createFlag({
        enabled: true,
        rollout: { percentage: 0 }
      });
      const context: FlagEvaluationContext = { userId: 'x' };

      const result = evaluator.explain(flag, context);

      expect(result).toEqual({ enabled: false, value: false, reason: 'rollout-excluded' });
    });

    it('should return enabled reason when rollout percentage is 100', () => {
      const flag = createFlag({
        enabled: true,
        rollout: { percentage: 100 }
      });
      const context: FlagEvaluationContext = { userId: 'x' };

      const result = evaluator.explain(flag, context);

      expect(result).toEqual({ enabled: true, value: true, reason: 'enabled' });
    });

    it('should return enabled reason when flag has no targeting nor rollout', () => {
      const flag = createFlag({ enabled: true });
      const context: FlagEvaluationContext = { userId: 'x' };

      const result = evaluator.explain(flag, context);

      expect(result).toEqual({ enabled: true, value: true, reason: 'enabled' });
    });
  });

  describe('Typed flags', () => {
    it('boolean flag keeps returning booleans', () => {
      expect(evaluator.evaluate(createFlag({ type: 'boolean', enabled: true }), {})).toBe(true);
      expect(evaluator.evaluate(createFlag({ type: 'boolean', enabled: false }), {})).toBe(false);
    });

    it('number flag returns value when on, defaultValue when off', () => {
      const on = createFlag({ type: 'number', value: 42, defaultValue: 7, enabled: true });
      const off = createFlag({ type: 'number', value: 42, defaultValue: 7, enabled: false });
      expect(evaluator.evaluate(on, {})).toBe(42);
      expect(evaluator.evaluate(off, {})).toBe(7);
    });

    it('string flag returns defaultValue on targeting miss', () => {
      const flag = createFlag({
        type: 'string', value: 'blue', defaultValue: 'gray', enabled: true,
        targeting: { userIds: ['vip'] },
      });
      expect(evaluator.evaluate(flag, { userId: 'someone-else' })).toBe('gray');
      expect(evaluator.evaluate(flag, { userId: 'vip' })).toBe('blue');
    });

    it('explain exposes the resolved value', () => {
      const flag = createFlag({ type: 'number', value: 99, defaultValue: 0, enabled: false });
      const res = evaluator.explain(flag, {});
      expect(res.enabled).toBe(false);
      expect(res.value).toBe(0);
      expect(res.reason).toBe('disabled');
    });
  });
});
