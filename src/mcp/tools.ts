import { z, ZodRawShape } from 'zod';
import { Storage, Flag, FlagEvaluationContext } from '../types.js';
import { FlagEvaluator } from '../evaluator.js';

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<McpToolResult>;
}

function ok(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
function fail(message: string): McpToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

const targetingSchema = z
  .object({
    userIds: z.array(z.string()).optional(),
    attributes: z.record(z.string(), z.array(z.string())).optional(),
  })
  .optional();

const rolloutSchema = z
  .object({ percentage: z.number().min(0).max(100) })
  .optional();

export function buildTools(storage: Storage, evaluator: FlagEvaluator): McpToolDef[] {
  return [
    {
      name: 'list_projects',
      description: 'Elenca i progetti FlagForge (id e nome).',
      inputSchema: {},
      handler: async () => {
        const projects = await storage.getAllProjects();
        return ok(projects.map(p => ({ id: p.id, name: p.name })));
      },
    },
    {
      name: 'list_environments',
      description: 'Elenca gli environment di un progetto (id e nome). Non espone le API key.',
      inputSchema: { projectId: z.string() },
      handler: async (args) => {
        const projectId = args.projectId as string;
        const envs = await storage.getEnvironmentsByProject(projectId);
        return ok(envs.map(e => ({ id: e.id, name: e.name })));
      },
    },
    {
      name: 'list_flags',
      description: 'Elenca tutti i feature flag di un progetto+environment.',
      inputSchema: { projectId: z.string(), environment: z.string() },
      handler: async (args) => {
        const flags = await storage.getAllFlags(args.projectId as string, args.environment as string);
        return ok(flags);
      },
    },
    {
      name: 'set_flag',
      description:
        'Crea o aggiorna (upsert) un feature flag in un progetto+environment. Se non esiste lo crea, altrimenti applica i campi passati.',
      inputSchema: {
        projectId: z.string(),
        environment: z.string(),
        key: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        enabled: z.boolean().optional(),
        targeting: targetingSchema,
        rollout: rolloutSchema,
      },
      handler: async (args) => {
        if (args.rollout !== undefined) {
          const rolloutResult = rolloutSchema.safeParse(args.rollout);
          if (!rolloutResult.success) {
            return fail(`rollout non valido: ${rolloutResult.error.message}`);
          }
        }

        const projectId = args.projectId as string;
        const environment = args.environment as string;
        const key = args.key as string;
        const existing = await storage.getFlag(projectId, key, environment);

        if (!existing) {
          const name = (args.name as string | undefined) ?? key;
          const created = await storage.createFlag({
            projectId,
            key,
            name,
            description: args.description as string | undefined,
            enabled: false,
            environment,
            targeting: args.targeting as Flag['targeting'],
            rollout: args.rollout as Flag['rollout'],
          });
          const forEnv = created.find(f => f.environment === environment);
          if (!forEnv) return fail('Flag creato ma non trovato per l’environment richiesto.');
          const updates: Partial<Flag> = {};
          if (args.enabled !== undefined) updates.enabled = args.enabled as boolean;
          const result = Object.keys(updates).length ? await storage.updateFlag(forEnv.id, updates) : forEnv;
          return ok(result);
        }

        const updates: Partial<Flag> = {};
        if (args.name !== undefined) updates.name = args.name as string;
        if (args.description !== undefined) updates.description = args.description as string;
        if (args.enabled !== undefined) updates.enabled = args.enabled as boolean;
        if (args.targeting !== undefined) updates.targeting = args.targeting as Flag['targeting'];
        if (args.rollout !== undefined) updates.rollout = args.rollout as Flag['rollout'];
        const updated = await storage.updateFlag(existing.id, updates);
        return ok(updated);
      },
    },
    {
      name: 'evaluate_flag',
      description:
        'Valuta se un flag è attivo per un dato contesto (userId/attributes) in un progetto+environment.',
      inputSchema: {
        projectId: z.string(),
        environment: z.string(),
        key: z.string(),
        userId: z.string().optional(),
        attributes: z.record(z.string(), z.string()).optional(),
      },
      handler: async (args) => {
        const flag = await storage.getFlag(args.projectId as string, args.key as string, args.environment as string);
        if (!flag) return fail('Flag non trovato per il contesto richiesto.');
        const context: FlagEvaluationContext = {
          userId: args.userId as string | undefined,
          attributes: args.attributes as Record<string, string> | undefined,
        };
        const enabled = evaluator.evaluate(flag, context);
        return ok({ key: flag.key, environment: flag.environment, enabled });
      },
    },
  ];
}
