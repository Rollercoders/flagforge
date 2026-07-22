import { useState, useEffect, useCallback } from 'react';
import {
  getFlags,
  createFlag,
  updateFlag,
  deleteFlag,
  Flag,
  UpdateFlagPayload,
} from '../api/flags';
import { Toggle } from '../components/Toggle';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { Drawer } from '../components/Drawer';
import { useToast } from '../components/Toast';
import { useFlagChanges } from '../hooks/useFlagChanges';

interface FlagsPageProps {
  projectId: string;
  projectName: string;
  environment: string;
}

interface FlagFormState {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  targetingUserIds: string[];
  targetingUserIdInput: string;
  targetingAttributes: { key: string; values: string }[];
  rolloutPercentage: string;
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function evaluateFlag(form: FlagFormState, userId: string, attrs: { key: string; value: string }[]): boolean {
  if (!form.enabled) return false;

  const hasUserIds = form.targetingUserIds.length > 0;
  const hasAttrs = form.targetingAttributes.some(a => a.key.trim());
  const hasTargeting = hasUserIds || hasAttrs;

  if (hasTargeting) {
    if (hasUserIds && userId && form.targetingUserIds.includes(userId)) return true;
    if (hasAttrs) {
      const attrMap: Record<string, string> = {};
      for (const a of attrs) { if (a.key.trim()) attrMap[a.key.trim()] = a.value; }
      for (const ta of form.targetingAttributes) {
        if (!ta.key.trim()) continue;
        const vals = ta.values.split(',').map(s => s.trim()).filter(Boolean);
        if (attrMap[ta.key.trim()] && vals.includes(attrMap[ta.key.trim()])) return true;
      }
    }
    if (!form.rolloutPercentage) return false;
  }

  if (form.rolloutPercentage) {
    if (!userId) return false;
    return (hashString(userId) % 100) < Number(form.rolloutPercentage);
  }

  return true;
}

function emptyForm(): FlagFormState {
  return {
    key: '',
    name: '',
    description: '',
    enabled: false,
    targetingUserIds: [],
    targetingUserIdInput: '',
    targetingAttributes: [],
    rolloutPercentage: '',
  };
}

function flagToForm(flag: Flag): FlagFormState {
  return {
    key: flag.key,
    name: flag.name,
    description: flag.description ?? '',
    enabled: flag.enabled,
    targetingUserIds: flag.targeting?.userIds ?? [],
    targetingUserIdInput: '',
    targetingAttributes: Object.entries(flag.targeting?.attributes ?? {}).map(([k, v]) => ({
      key: k,
      values: v.join(', '),
    })),
    rolloutPercentage: flag.rollout != null ? String(flag.rollout.percentage) : '',
  };
}

function formToPayload(form: FlagFormState) {
  const userIds = form.targetingUserIds;

  const attributes: Record<string, string[]> = {};
  for (const attr of form.targetingAttributes) {
    if (attr.key.trim()) {
      attributes[attr.key.trim()] = attr.values
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    }
  }

  const hasTargeting = userIds.length > 0 || Object.keys(attributes).length > 0;
  const rolloutPct = form.rolloutPercentage !== '' ? Number(form.rolloutPercentage) : null;

  return {
    key: form.key,
    name: form.name,
    description: form.description || undefined,
    targeting: hasTargeting ? { userIds: userIds.length ? userIds : undefined, attributes: Object.keys(attributes).length ? attributes : undefined } : undefined,
    rollout: rolloutPct != null ? { percentage: rolloutPct } : undefined,
  };
}

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

const fieldStyle: React.CSSProperties = {
  marginBottom: 16,
};

export function FlagsPage({ projectId, projectName, environment }: FlagsPageProps) {
  const { showToast } = useToast();
  const [flags, setFlags] = useState<Flag[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingFlag, setEditingFlag] = useState<Flag | null>(null);
  const [form, setForm] = useState<FlagFormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUserId, setPreviewUserId] = useState('');
  const [previewAttrs, setPreviewAttrs] = useState<{ key: string; value: string }[]>([{ key: '', value: '' }]);

  const loadFlags = useCallback(async () => {
    if (!projectId || !environment) { setFlags([]); setLoading(false); return; }
    setLoading(true);
    try {
      const flags = await getFlags(projectId, environment);
      setFlags(flags);
    } catch {
      showToast('Failed to load flags', 'error');
    } finally {
      setLoading(false);
    }
  }, [projectId, environment, showToast]);

  useEffect(() => {
    void loadFlags();
  }, [loadFlags]);

  useFlagChanges((change) => {
    // Rifai la fetch solo se l'evento riguarda la vista corrente.
    if (change.projectId === projectId && (change.environment === undefined || change.environment === environment)) {
      void loadFlags();
    }
  });

  function openCreate() {
    setEditingFlag(null);
    setForm(emptyForm());
    setConfirmDelete(false);
    setDrawerOpen(true);
  }

  function openEdit(flag: Flag) {
    setEditingFlag(flag);
    setForm(flagToForm(flag));
    setConfirmDelete(false);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setEditingFlag(null);
    setConfirmDelete(false);
  }

  async function handleToggleEnabled(flag: Flag) {
    try {
      await updateFlag(flag.key, projectId, environment, { enabled: !flag.enabled });
      await loadFlags();
    } catch {
      showToast('Failed to update flag', 'error');
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = formToPayload(form);
      if (editingFlag) {
        // In modifica inviamo `null` (non `undefined`) per i campi svuotati:
        // `JSON.stringify` scarta le chiavi `undefined`, e una PATCH senza la
        // chiave viene interpretata come "non modificare", lasciando il vecchio
        // valore in DB. `null` invece sopravvive alla serializzazione e azzera.
        const updates: UpdateFlagPayload = {
          name: payload.name,
          description: payload.description ?? null,
          enabled: form.enabled,
          targeting: payload.targeting ?? null,
          rollout: payload.rollout ?? null,
        };
        await updateFlag(editingFlag.key, projectId, environment, updates);
        showToast('Flag updated');
      } else {
        await createFlag(projectId, environment, {
          key: payload.key,
          name: payload.name,
          description: payload.description,
          targeting: payload.targeting,
          rollout: payload.rollout,
        });
        showToast('Flag created');
      }
      closeDrawer();
      await loadFlags();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save flag', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editingFlag) return;
    setSaving(true);
    try {
      await deleteFlag(editingFlag.key, projectId, environment);
      showToast('Flag deleted');
      closeDrawer();
      await loadFlags();
    } catch {
      showToast('Failed to delete flag', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: 32 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: '#111827' }}>{projectName ? `${projectName} — Feature Flags` : 'Feature Flags'}</h1>
          <p style={{ fontSize: 13, color: '#374151', marginTop: 2 }}>{environment}</p>
        </div>
        {!loading && flags.length > 0 && (
          <button
            onClick={openCreate}
            style={{
              padding: '8px 16px',
              background: '#1d4ed8',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            + New Flag
          </button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Spinner />
        </div>
      ) : flags.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: 64,
            color: '#4b5563',
            border: '2px dashed #e5e7eb',
            borderRadius: 12,
          }}
        >
          <p style={{ fontSize: 18, fontWeight: 600, color: '#111827', marginBottom: 8 }}>No feature flags yet in {environment}</p>
          <p style={{ fontSize: 14, color: '#4b5563', marginBottom: 24 }}>Feature flags let you control your app behavior without deploying code.</p>
          <button
            onClick={openCreate}
            style={{
              padding: '8px 16px',
              background: '#1d4ed8',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Create your first flag
          </button>
          <p style={{ fontSize: 12, color: '#4b5563', marginTop: 12 }}>Example: new-checkout, beta-dashboard, enable-chat</p>
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
          {flags.map((flag, i) => (
            <div
              key={flag.id}
              onClick={() => openEdit(flag)}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '14px 20px',
                borderTop: i > 0 ? '1px solid #f3f4f6' : 'none',
                cursor: 'pointer',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
              onMouseLeave={e => (e.currentTarget.style.background = 'white')}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>{flag.key}</span>
                  {flag.targeting && <Badge color="blue">Targeting</Badge>}
                  {flag.rollout && <Badge color="purple">Rollout {flag.rollout.percentage}%</Badge>}
                </div>
                <span style={{ fontSize: 13, color: '#374151' }}>{flag.name}</span>
              </div>
              <div onClick={e => e.stopPropagation()}>
                <Toggle
                  checked={flag.enabled}
                  onChange={() => void handleToggleEnabled(flag)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Drawer */}
      <Drawer
        open={drawerOpen}
        onClose={closeDrawer}
        title={editingFlag ? `Edit: ${editingFlag.key}` : 'New Flag'}
      >
        {!editingFlag && (
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 13, color: '#4b5563', marginBottom: 4 }}>New flags are created disabled by default.</p>
            <p style={{ fontSize: 13, color: '#4b5563' }}>When no rules match, the flag returns its enabled value.</p>
          </div>
        )}

        {/* name */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Name *</label>
          <input
            style={inputStyle}
            value={form.name}
            onChange={e => {
              const name = e.target.value;
              const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
              setForm(f => ({ ...f, name, ...(editingFlag ? {} : { key }) }));
            }}
            placeholder="e.g. Dark Mode"
          />
        </div>

        {/* key */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Key *</label>
          <input
            style={{ ...inputStyle, background: editingFlag ? '#f9fafb' : 'white' }}
            value={form.key}
            readOnly={!!editingFlag}
            onChange={e => setForm(f => ({ ...f, key: e.target.value }))}
            placeholder="e.g. dark-mode"
          />
        </div>

        {/* description */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Description</label>
          <textarea
            style={{ ...inputStyle, resize: 'vertical', minHeight: 64 }}
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Optional description"
          />
        </div>

        {/* enabled — only shown when editing (new flags always start disabled) */}
        {editingFlag && (
          <div style={{ ...fieldStyle, display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>Enabled</label>
            <Toggle
              checked={form.enabled}
              onChange={v => setForm(f => ({ ...f, enabled: v }))}
            />
          </div>
        )}

        {/* targeting user IDs */}
        <div style={{ ...fieldStyle, borderTop: '1px solid #f3f4f6', paddingTop: 16 }}>
          <label style={labelStyle}>Targeting — User IDs</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, minHeight: 38, alignItems: 'center' }}>
            {form.targetingUserIds.map(uid => (
              <span key={uid} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#e0e7ff', color: '#3730a3', fontSize: 12, fontWeight: 500, padding: '2px 8px', borderRadius: 999 }}>
                {uid}
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, targetingUserIds: f.targetingUserIds.filter(u => u !== uid) }))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3730a3', fontSize: 14, lineHeight: 1, padding: 0 }}
                >×</button>
              </span>
            ))}
            <input
              style={{ border: 'none', outline: 'none', fontSize: 13, flex: 1, minWidth: 120, padding: '2px 0' }}
              value={form.targetingUserIdInput}
              onChange={e => setForm(f => ({ ...f, targetingUserIdInput: e.target.value }))}
              onKeyDown={e => {
                if (e.key === 'Enter' && form.targetingUserIdInput.trim()) {
                  e.preventDefault();
                  const val = form.targetingUserIdInput.trim();
                  if (!form.targetingUserIds.includes(val)) {
                    setForm(f => ({ ...f, targetingUserIds: [...f.targetingUserIds, val], targetingUserIdInput: '' }));
                  }
                } else if (e.key === 'Backspace' && !form.targetingUserIdInput && form.targetingUserIds.length > 0) {
                  setForm(f => ({ ...f, targetingUserIds: f.targetingUserIds.slice(0, -1) }));
                }
              }}
              placeholder={form.targetingUserIds.length === 0 ? 'Type and press Enter' : ''}
            />
          </div>
        </div>

        {/* targeting attributes */}
        <div style={fieldStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>Targeting — Attributes</label>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, targetingAttributes: [...f.targetingAttributes, { key: '', values: '' }] }))}
              style={{ fontSize: 12, color: '#1d4ed8', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              + Add
            </button>
          </div>
          {form.targetingAttributes.map((attr, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                placeholder="attribute key"
                value={attr.key}
                onChange={e => setForm(f => {
                  const attrs = [...f.targetingAttributes];
                  attrs[i] = { ...attrs[i], key: e.target.value };
                  return { ...f, targetingAttributes: attrs };
                })}
              />
              <input
                style={{ ...inputStyle, flex: 2 }}
                placeholder="value1, value2"
                value={attr.values}
                onChange={e => setForm(f => {
                  const attrs = [...f.targetingAttributes];
                  attrs[i] = { ...attrs[i], values: e.target.value };
                  return { ...f, targetingAttributes: attrs };
                })}
              />
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, targetingAttributes: f.targetingAttributes.filter((_, j) => j !== i) }))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 16 }}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {/* rollout */}
        <div style={{ ...fieldStyle, borderTop: '1px solid #f3f4f6', paddingTop: 16 }}>
          <label style={labelStyle}>Rollout percentage</label>
          <input
            style={{ ...inputStyle, width: 120 }}
            type="number"
            min={0}
            max={100}
            value={form.rolloutPercentage}
            onChange={e => setForm(f => ({ ...f, rolloutPercentage: e.target.value }))}
            placeholder="e.g. 50"
          />
          <p style={{ fontSize: 11, color: '#4b5563', marginTop: 4 }}>Leave empty to disable rollout</p>
          <p style={{ fontSize: 11, color: '#4b5563', marginTop: 8 }}>Evaluation order: User IDs → Attributes → Rollout → Enabled value</p>
        </div>

        {/* preview */}
        <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 16, marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setPreviewOpen(v => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#374151', padding: 0, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span style={{ fontSize: 11 }}>{previewOpen ? '▼' : '▶'}</span> Test this flag
          </button>

          {previewOpen && (
            <div style={{ marginTop: 12, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
              <div style={{ marginBottom: 10 }}>
                <label style={{ ...labelStyle, fontSize: 12 }}>userId</label>
                <input
                  style={{ ...inputStyle, fontSize: 13, padding: '5px 10px' }}
                  value={previewUserId}
                  onChange={e => setPreviewUserId(e.target.value)}
                  placeholder="e.g. ale123"
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ ...labelStyle, fontSize: 12 }}>Attributes</label>
                {previewAttrs.map((attr, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <input
                      style={{ ...inputStyle, fontSize: 12, padding: '4px 8px', flex: 1 }}
                      value={attr.key}
                      onChange={e => setPreviewAttrs(prev => prev.map((a, j) => j === i ? { ...a, key: e.target.value } : a))}
                      placeholder="key"
                    />
                    <input
                      style={{ ...inputStyle, fontSize: 12, padding: '4px 8px', flex: 1 }}
                      value={attr.value}
                      onChange={e => {
                        const updated = previewAttrs.map((a, j) => j === i ? { ...a, value: e.target.value } : a);
                        if (i === previewAttrs.length - 1 && e.target.value) updated.push({ key: '', value: '' });
                        setPreviewAttrs(updated);
                      }}
                      placeholder="value"
                    />
                  </div>
                ))}
              </div>
              {(() => {
                const result = evaluateFlag(form, previewUserId, previewAttrs);
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
                    <span style={{ color: '#4b5563' }}>→ Result:</span>
                    <span style={{ color: result ? '#065f46' : '#991b1b', background: result ? '#d1fae5' : '#fee2e2', padding: '2px 10px', borderRadius: 999 }}>
                      {result ? 'true' : 'false'}
                    </span>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* actions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 24, paddingTop: 16, borderTop: '1px solid #f3f4f6' }}>
          <button
            onClick={() => void handleSave()}
            disabled={saving || !form.key || !form.name}
            style={{
              flex: 1,
              padding: '10px',
              background: saving || !form.key || !form.name ? '#9ca3af' : '#1d4ed8',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              cursor: saving || !form.key || !form.name ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          {editingFlag && !confirmDelete && (
            <button
              onClick={() => setConfirmDelete(true)}
              style={{
                padding: '10px 16px',
                background: 'white',
                color: '#ef4444',
                border: '1px solid #fca5a5',
                borderRadius: 6,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Delete
            </button>
          )}
          {editingFlag && confirmDelete && (
            <button
              onClick={() => void handleDelete()}
              disabled={saving}
              style={{
                padding: '10px 16px',
                background: '#ef4444',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Confirm delete
            </button>
          )}
        </div>
      </Drawer>
    </div>
  );
}
