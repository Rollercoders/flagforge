import { Router } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Storage } from '../types.js';
import { FlagEvaluator } from '../evaluator.js';
import { mcpBearerAuth } from './auth.js';
import { buildTools } from './tools.js';

export function createMcpRouter(storage: Storage, evaluator: FlagEvaluator, token: string): Router {
  const router = Router();
  router.use(mcpBearerAuth(token));

  const tools = buildTools(storage, evaluator);

  router.post('/', async (req, res) => {
    // Un McpServer + transport nuovo per richiesta (stateless).
    const server = new McpServer({ name: 'flagforge', version: '1.0.0' });
    for (const t of tools) {
      server.registerTool(
        t.name,
        { description: t.description, inputSchema: t.inputSchema },
        // The SDK passes arguments already validated against inputSchema.
        // Cast to CallToolResult: McpToolResult has the same shape but without the
        // index signature that SDK 1.29.0 requires for the tool callback return type.
        async (args: Record<string, unknown>): Promise<CallToolResult> => {
          const result = await t.handler(args ?? {});
          return result as CallToolResult;
        },
      );
    }

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  return router;
}
