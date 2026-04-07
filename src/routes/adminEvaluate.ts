import { Router } from 'express';
import { Storage, FlagEvaluationContext } from '../types.js';
import { FlagEvaluator } from '../evaluator.js';

export function createAdminEvaluateRouter(storage: Storage, evaluator: FlagEvaluator) {
  const router = Router();

  router.post('/all', async (req, res) => {
    try {
      const { projectId, environment, userId, attributes } = req.body as {
        projectId: string;
        environment: string;
        userId?: string;
        attributes?: Record<string, string>;
      };
      if (!projectId || !environment) {
        res.status(400).json({ error: 'projectId and environment are required' });
        return;
      }
      const context: FlagEvaluationContext = { userId, attributes };
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

  return router;
}
