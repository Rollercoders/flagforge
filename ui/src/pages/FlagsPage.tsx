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

interface FlagsPageProps {
  projectId: string;
  environment: string;
}

interface FlagFormState {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  targetingUserIds: string;
  targetingAttributes: { key: string; values: string }[];
  rolloutPercentage: string;
}

function emptyForm(): FlagFormState {
  return {
    key: '',
    name: '',
    description: '',
    enabled: false,
    targetingUserIds: '',
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
    targetingUserIds: flag.targeting?.userIds?.join(', ') ?? '',
    targetingAttributes: Object.entries(flag.targeting?.attributes ?? {}).map(([k, v]) => ({
      key: k,
      values: v.join(', '),
    })),
    rolloutPercentage: flag.rollout != null ? String(flag.rollout.percentage) : '',
  };
}

function formToPayload(form: FlagFormState) {
  const userIds = form.targetingUserIds
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

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

export function FlagsPage({ projectId, environment }: FlagsPageProps) {
  const { showToast } = useToast();
  const [flags, setFlags] = useState<Flag[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingFlag, setEditingFlag] = useState<Flag | null>(null);
  const [form, setForm] = useState<FlagFormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadFlags = useCallback(async () => {
    if (!projectId || !environment) { setFlags([]); setLoading(false); return; }
    setLoading(true);
    try {
      const flags = await getFlags(environment);
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
      await updateFlag(flag.key, { enabled: !flag.enabled });
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
        const updates: UpdateFlagPayload = {
          name: payload.name,
          description: payload.description,
          targeting: payload.targeting,
          rollout: payload.rollout,
        };
        await updateFlag(editingFlag.key, updates);
        showToast('Flag updated');
      } else {
        await createFlag({
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
      await deleteFlag(editingFlag.key);
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
          <h1 style={{ fontSize: 20, fontWeight: 600, color: '#111827' }}>Feature Flags</h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{environment}</p>
        </div>
        <button
          onClick={openCreate}
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
          + New Flag
        </button>
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
            color: '#9ca3af',
            border: '2px dashed #e5e7eb',
            borderRadius: 12,
          }}
        >
          <p style={{ fontSize: 15, marginBottom: 12 }}>No flags yet in {environment}</p>
          <button
            onClick={openCreate}
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
            Create your first flag
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
                <span style={{ fontSize: 13, color: '#6b7280' }}>{flag.name}</span>
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

        {/* name */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Name *</label>
          <input
            style={inputStyle}
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Dark Mode"
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
          <input
            style={inputStyle}
            value={form.targetingUserIds}
            onChange={e => setForm(f => ({ ...f, targetingUserIds: e.target.value }))}
            placeholder="user-1, user-2, user-3"
          />
          <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Comma-separated user IDs</p>
        </div>

        {/* targeting attributes */}
        <div style={fieldStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>Targeting — Attributes</label>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, targetingAttributes: [...f.targetingAttributes, { key: '', values: '' }] }))}
              style={{ fontSize: 12, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}
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
          <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Leave empty to disable rollout</p>
        </div>

        {/* actions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 24, paddingTop: 16, borderTop: '1px solid #f3f4f6' }}>
          <button
            onClick={() => void handleSave()}
            disabled={saving || !form.key || !form.name}
            style={{
              flex: 1,
              padding: '10px',
              background: saving || !form.key || !form.name ? '#93c5fd' : '#3b82f6',
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
