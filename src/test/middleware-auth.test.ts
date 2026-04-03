import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Response, NextFunction } from 'express';
import { createAuthMiddleware, AuthRequest } from '../middleware/auth';
import { Storage, ApiKey } from '../types';

describe('Auth Middleware', () => {
  let mockStorage: Storage;
  let mockReq: Partial<AuthRequest>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      headers: {}
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    };

    mockNext = vi.fn() as unknown as NextFunction;

    mockStorage = {
      initialize: vi.fn(),
      createFlag: vi.fn(),
      getFlag: vi.fn(),
      getAllFlags: vi.fn(),
      updateFlag: vi.fn(),
      deleteFlag: vi.fn(),
      createApiKey: vi.fn(),
      getApiKey: vi.fn(),
      getAllApiKeys: vi.fn(),
      deleteApiKey: vi.fn(),
      createProject: vi.fn(),
      getProject: vi.fn(),
      getAllProjects: vi.fn(),
      deleteProject: vi.fn(),
      createEnvironment: vi.fn(),
      getEnvironmentsByProject: vi.fn(),
      deleteEnvironment: vi.fn()
    };
  });

  it('should reject request without authorization header', async () => {
    const middleware = createAuthMiddleware(mockStorage);

    await middleware(mockReq as AuthRequest, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Missing or invalid authorization header'
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should reject request with invalid authorization header format', async () => {
    mockReq.headers = {
      authorization: 'InvalidFormat token123'
    };

    const middleware = createAuthMiddleware(mockStorage);

    await middleware(mockReq as AuthRequest, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Missing or invalid authorization header'
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should reject request with invalid API key', async () => {
    mockReq.headers = {
      authorization: 'Bearer invalid-key'
    };

    (mockStorage.getApiKey as any) = vi.fn().mockResolvedValue(null);

    const middleware = createAuthMiddleware(mockStorage);

    await middleware(mockReq as AuthRequest, mockRes as Response, mockNext);

    expect(mockStorage.getApiKey).toHaveBeenCalledWith('invalid-key');
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Invalid API key'
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should accept request with valid API key', async () => {
    const validApiKey: ApiKey = {
      id: 'key-id-123',
      key: 'valid-key',
      name: 'Test Key',
      projectId: 'test-project',
      environment: 'production',
      createdAt: new Date().toISOString()
    };

    mockReq.headers = {
      authorization: 'Bearer valid-key'
    };

    (mockStorage.getApiKey as any) = vi.fn().mockResolvedValue(validApiKey);

    const middleware = createAuthMiddleware(mockStorage);

    await middleware(mockReq as AuthRequest, mockRes as Response, mockNext);

    expect(mockStorage.getApiKey).toHaveBeenCalledWith('valid-key');
    expect(mockReq.apiKey).toEqual({
      id: 'key-id-123',
      name: 'Test Key',
      projectId: 'test-project',
      environment: 'production'
    });
    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('should handle storage errors gracefully', async () => {
    mockReq.headers = {
      authorization: 'Bearer some-key'
    };

    (mockStorage.getApiKey as any) = vi.fn().mockRejectedValue(
      new Error('Database connection failed')
    );

    const middleware = createAuthMiddleware(mockStorage);

    await middleware(mockReq as AuthRequest, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Authentication error'
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should extract token correctly from Bearer format', async () => {
    const validApiKey: ApiKey = {
      id: 'key-id-123',
      key: 'rf_abc123xyz',
      name: 'Test Key',
      projectId: 'test-project',
      environment: 'staging',
      createdAt: new Date().toISOString()
    };

    mockReq.headers = {
      authorization: 'Bearer rf_abc123xyz'
    };

    (mockStorage.getApiKey as any) = vi.fn().mockResolvedValue(validApiKey);

    const middleware = createAuthMiddleware(mockStorage);

    await middleware(mockReq as AuthRequest, mockRes as Response, mockNext);

    expect(mockStorage.getApiKey).toHaveBeenCalledWith('rf_abc123xyz');
    expect(mockNext).toHaveBeenCalled();
  });

  it('should handle empty Bearer token', async () => {
    mockReq.headers = {
      authorization: 'Bearer '
    };

    (mockStorage.getApiKey as any) = vi.fn().mockResolvedValue(null);

    const middleware = createAuthMiddleware(mockStorage);

    await middleware(mockReq as AuthRequest, mockRes as Response, mockNext);

    expect(mockStorage.getApiKey).toHaveBeenCalledWith('');
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });
});
