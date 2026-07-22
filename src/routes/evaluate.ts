import { Router } from 'express';
import { Storage, FlagEvaluationContext } from '../types';
import { FlagEvaluator } from '../evaluator';
import { AuthRequest } from '../middleware/auth';

export function createEvaluateRouter(storage: Storage, evaluator: FlagEvaluator) {
  const router = Router();

  // Evaluate all flags for the environment
  router.post('/all', async (req: AuthRequest, res) => {
    try {
      const environment = req.apiKey?.environment;

      if (!environment) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const projectId = req.apiKey?.projectId ?? '';
      const body = req.body as { userId?: string; attributes?: Record<string, string> };
      const context: FlagEvaluationContext = {
        userId: body.userId,
        attributes: body.attributes
      };

      const flags = await storage.getAllFlags(projectId, environment);
      const results: Record<string, boolean> = {};

      for (const flag of flags) {
        results[flag.key] = evaluator.evaluate(flag, context);
      }

      res.json(results);
    } catch (_error) {
      res.status(500).json({ error: 'Failed to evaluate flags' });
    }
  });

  // Evaluate a single flag
  router.post('/:key', async (req: AuthRequest, res) => {
    try {
      const { key } = req.params;
      const environment = req.apiKey?.environment;

      if (!environment) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const projectId = req.apiKey?.projectId ?? '';
      const flag = await storage.getFlag(projectId, key, environment);

      if (!flag) {
        res.status(404).json({ error: 'Flag not found' });
        return;
      }

      const body = req.body as { userId?: string; attributes?: Record<string, string> };
      const context: FlagEvaluationContext = {
        userId: body.userId,
        attributes: body.attributes
      };

      const result = evaluator.evaluate(flag, context);

      res.json({
        key: flag.key,
        enabled: result,
        metadata: {
          flagEnabled: flag.enabled,
          hasTargeting: !!flag.targeting,
          hasRollout: !!flag.rollout
        }
      });
    } catch (_error) {
      res.status(500).json({ error: 'Failed to evaluate flag' });
    }
  });

  // Batch evaluate multiple flags
  router.post('/', async (req: AuthRequest, res) => {
    try {
      const body = req.body as {
        flags?: unknown;
        context?: { userId?: string; attributes?: Record<string, string> }
      };
      const { flags, context } = body;
      const environment = req.apiKey?.environment;

      if (!environment) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (!Array.isArray(flags)) {
        res.status(400).json({ error: 'flags must be an array of flag keys' });
        return;
      }

      const evaluationContext: FlagEvaluationContext = {
        userId: context?.userId,
        attributes: context?.attributes
      };

      const results: Record<string, boolean> = {};

      const projectId = req.apiKey?.projectId ?? '';
      for (const key of flags) {
        if (typeof key === 'string') {
          const flag = await storage.getFlag(projectId, key, environment);
          if (flag) {
            results[key] = evaluator.evaluate(flag, evaluationContext);
          } else {
            results[key] = false;
          }
        }
      }

      res.json(results);
    } catch (_error) {
      res.status(500).json({ error: 'Failed to evaluate flags' });
    }
  });

  return router;
}
