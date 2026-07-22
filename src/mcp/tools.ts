import { z, ZodRawShape } from 'zod';
import { Storage, Flag, FlagEvaluationContext } from '../types.js';
import { FlagEvaluator } from '../evaluator.js';
import { normalizeFlagType, validateTypedValues } from '../flagValue.js';

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
      description: 'Lists FlagForge projects (id and name).',
      inputSchema: {},
      handler: async () => {
        const projects = await storage.getAllProjects();
        return ok(projects.map(p => ({ id: p.id, name: p.name })));
      },
    },
    {
      name: 'list_environments',
      description:
        'Lists the environments (by name) of a project. Does not expose API keys. Use the `name` field as the `environment` value in the other tools (list_flags/set_flag/evaluate_flag).',
      inputSchema: { projectId: z.string() },
      handler: async (args) => {
        const projectId = args.projectId as string;
        const envs = await storage.getEnvironmentsByProject(projectId);
        return ok(envs.map(e => ({ name: e.name })));
      },
    },
    {
      name: 'list_flags',
      description: 'Lists all feature flags for a project+environment.',
      inputSchema: { projectId: z.string(), environment: z.string() },
      handler: async (args) => {
        const flags = await storage.getAllFlags(args.projectId as string, args.environment as string);
        return ok(flags);
      },
    },
    {
      name: 'set_flag',
      description:
        'Creates or updates (upsert) a feature flag in a project+environment. Creates it if it does not exist, otherwise applies the fields passed in.',
      inputSchema: {
        projectId: z.string(),
        environment: z.string(),
        key: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        enabled: z.boolean().optional(),
        targeting: targetingSchema,
        rollout: rolloutSchema,
        type: z.enum(['boolean', 'number', 'string']).optional(),
        value: z.union([z.boolean(), z.number(), z.string()]).optional(),
        defaultValue: z.union([z.boolean(), z.number(), z.string()]).optional(),
      },
      handler: async (args) => {
        if (args.rollout !== undefined) {
          const rolloutResult = rolloutSchema.safeParse(args.rollout);
          if (!rolloutResult.success) {
            return fail(`invalid rollout: ${rolloutResult.error.message}`);
          }
        }

        const projectId = args.projectId as string;
        const environment = args.environment as string;
        const key = args.key as string;

        const envs = await storage.getEnvironmentsByProject(projectId);
        const envNames = envs.map(e => e.name);
        if (!envNames.includes(environment)) {
          return fail(
            `Environment "${environment}" does not exist for this project. Valid environments: ${envNames.join(', ') || '(none)'}. ` +
            `Use the "name" field returned by list_environments.`
          );
        }

        const existing = await storage.getFlag(projectId, key, environment);

        if (!existing) {
          const flagType = normalizeFlagType(args.type);
          const validation = validateTypedValues(flagType, args.value, args.defaultValue);
          if (!validation.ok) return fail(validation.error);

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
            type: flagType,
            value: flagType === 'boolean' ? undefined : (args.value as Flag['value']),
            defaultValue: flagType === 'boolean' ? undefined : (args.defaultValue as Flag['defaultValue']),
          });
          const forEnv = created.find(f => f.environment === environment);
          if (!forEnv) return fail('Flag created but not found for the requested environment.');
          const updates: Partial<Flag> = {};
          if (args.enabled !== undefined) updates.enabled = args.enabled as boolean;
          const result = Object.keys(updates).length ? await storage.updateFlag(forEnv.id, updates) : forEnv;
          return ok(result);
        }

        const existingType = normalizeFlagType(existing.type);
        if (args.type !== undefined && normalizeFlagType(args.type) !== existingType) {
          return fail('flag type is immutable');
        }

        const updates: Partial<Flag> = {};
        if (args.name !== undefined) updates.name = args.name as string;
        if (args.description !== undefined) updates.description = args.description as string;
        if (args.enabled !== undefined) updates.enabled = args.enabled as boolean;
        if (args.targeting !== undefined) updates.targeting = args.targeting as Flag['targeting'];
        if (args.rollout !== undefined) updates.rollout = args.rollout as Flag['rollout'];

        if (existingType !== 'boolean' && (args.value !== undefined || args.defaultValue !== undefined)) {
          const nextValue = args.value !== undefined ? args.value : existing.value;
          const nextDefaultValue = args.defaultValue !== undefined ? args.defaultValue : existing.defaultValue;
          const validation = validateTypedValues(existingType, nextValue, nextDefaultValue);
          if (!validation.ok) return fail(validation.error);
          if (args.value !== undefined) updates.value = args.value as Flag['value'];
          if (args.defaultValue !== undefined) updates.defaultValue = args.defaultValue as Flag['defaultValue'];
        }

        const updated = await storage.updateFlag(existing.id, updates);
        return ok(updated);
      },
    },
    {
      name: 'evaluate_flag',
      description:
        'Evaluates whether a flag is enabled for a given context (userId/attributes) in a project+environment. Also returns `value` (the resolved value based on the flag type) and `reason`, the explanation for the outcome (values: disabled, targeting-miss, rollout-excluded, enabled).',
      inputSchema: {
        projectId: z.string(),
        environment: z.string(),
        key: z.string(),
        userId: z.string().optional(),
        attributes: z.record(z.string(), z.string()).optional(),
      },
      handler: async (args) => {
        const flag = await storage.getFlag(args.projectId as string, args.key as string, args.environment as string);
        if (!flag) return fail('Flag not found for the requested context.');
        const context: FlagEvaluationContext = {
          userId: args.userId as string | undefined,
          attributes: args.attributes as Record<string, string> | undefined,
        };
        const { enabled, value, reason } = evaluator.explain(flag, context);
        return ok({ key: flag.key, environment: flag.environment, value, enabled, reason });
      },
    },
  ];
}
