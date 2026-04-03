import { useState, useEffect, useCallback } from 'react';
import { getApiKeys, createApiKey, deleteApiKey, ApiKey } from '../api/apiKeys';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 14,
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  color: '#374151',
  marginBottom: 4,
};

export function ApiKeysPage({ projectId, environments }: {
  projectId: string;
  environments: string[];
}) {
  const { showToast } = useToast();
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEnv, setNewEnv] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    setNewEnv(environments[0] ?? '');
  }, [environments]);

  const loadKeys = useCallback(async () => {
    if (!projectId) { setApiKeys([]); setLoading(false); return; }
    setLoading(true);
    try {
      const keys = await getApiKeys(projectId);
      setApiKeys(keys.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } catch {
      showToast('Failed to load API keys', 'error');
    } finally {
      setLoading(false);
    }
  }, [projectId, showToast]);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  async function handleCreate() {
    if (!newName || !newEnv) return;
    setSaving(true);
    try {
      await createApiKey(newName, newEnv, projectId);
      showToast('API key created');
      setModalOpen(false);
      setNewName('');
      await loadKeys();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create API key', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteApiKey(id);
      showToast('API key deleted');
      setConfirmDeleteId(null);
      await loadKeys();
    } catch {
      showToast('Failed to delete API key', 'error');
    }
  }

  function copyToClipboard(key: string) {
    void navigator.clipboard.writeText(key).then(() => showToast('Key copied to clipboard'));
  }

  function maskKey(_key: string): string {
    return 'rf_' + '••••••••••••••••';
  }

  return (
    <div style={{ padding: 32 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: '#111827' }}>API Keys</h1>
        <button
          onClick={() => setModalOpen(true)}
          style={{
            padding: '8px 16px',
            background: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          + New API Key
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Spinner />
        </div>
      ) : apiKeys.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: 64,
            color: '#9ca3af',
            border: '2px dashed #e5e7eb',
            borderRadius: 12,
          }}
        >
          <p style={{ fontSize: 15, marginBottom: 12 }}>No API keys yet</p>
          <button
            onClick={() => setModalOpen(true)}
            style={{
              padding: '8px 16px',
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Create your first API key
          </button>
        </div>
      ) : (
        <div
          style={{
            background: 'white',
            borderRadius: 12,
            border: '1px solid #e5e7eb',
            overflow: 'hidden',
          }}
        >
          {apiKeys.map((apiKey, i) => (
            <div
              key={apiKey.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '14px 20px',
                borderTop: i > 0 ? '1px solid #f3f4f6' : 'none',
                gap: 16,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#111827', marginBottom: 2 }}>
                  {apiKey.name}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: '#6b7280' }}>
                  <span
                    style={{
                      background: '#f3f4f6',
                      padding: '1px 8px',
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  >
                    {apiKey.environment}
                  </span>
                  <span>{new Date(apiKey.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code
                  style={{
                    fontSize: 12,
                    color: '#6b7280',
                    background: '#f9fafb',
                    padding: '4px 8px',
                    borderRadius: 4,
                    border: '1px solid #e5e7eb',
                  }}
                >
                  {maskKey(apiKey.key)}
                </code>
                <button
                  onClick={() => copyToClipboard(apiKey.key)}
                  title="Copy to clipboard"
                  style={{
                    background: 'none',
                    border: '1px solid #e5e7eb',
                    borderRadius: 4,
                    padding: '4px 8px',
                    cursor: 'pointer',
                    fontSize: 12,
                    color: '#6b7280',
                  }}
                >
                  Copy
                </button>
              </div>
              <div>
                {confirmDeleteId === apiKey.id ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => void handleDelete(apiKey.id)}
                      style={{
                        padding: '4px 10px',
                        background: '#ef4444',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      style={{
                        padding: '4px 10px',
                        background: 'none',
                        border: '1px solid #d1d5db',
                        borderRadius: 4,
                        fontSize: 12,
                        cursor: 'pointer',
                        color: '#6b7280',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(apiKey.id)}
                    style={{
                      padding: '4px 10px',
                      background: 'none',
                      border: '1px solid #fca5a5',
                      borderRadius: 4,
                      fontSize: 12,
                      cursor: 'pointer',
                      color: '#ef4444',
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {modalOpen && (
        <>
          <div
            onClick={() => setModalOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.3)',
              zIndex: 40,
            }}
          />
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'white',
              borderRadius: 12,
              padding: 24,
              width: 400,
              zIndex: 50,
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>New API Key</h2>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Name *</label>
              <input
                style={inputStyle}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Production Key"
                autoFocus
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={labelStyle}>Environment *</label>
              <select
                style={inputStyle}
                value={newEnv}
                onChange={e => setNewEnv(e.target.value)}
              >
                {environments.length === 0
                  ? <option value="">No environments</option>
                  : environments.map(env => <option key={env} value={env}>{env}</option>)
                }
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => void handleCreate()}
                disabled={saving || !newName || !newEnv || !projectId}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: saving || !newName || !newEnv || !projectId ? '#93c5fd' : '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: saving || !newName || !newEnv || !projectId ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? 'Creating...' : 'Create'}
              </button>
              <button
                onClick={() => setModalOpen(false)}
                style={{
                  padding: '10px 16px',
                  background: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  fontSize: 14,
                  cursor: 'pointer',
                  color: '#6b7280',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
