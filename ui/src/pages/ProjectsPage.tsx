import { useState, useEffect, useCallback } from 'react';
import {
  getProjects, createProject, deleteProject,
  getEnvironments, createEnvironment, deleteEnvironment, renameEnvironment,
  Project, Environment,
} from '../api/projects';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';

const inputStyle: React.CSSProperties = {
  padding: '7px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 13,
  outline: 'none',
};

const btnStyle = (variant: 'primary' | 'danger' | 'ghost'): React.CSSProperties => ({
  padding: '6px 12px',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
  border: variant === 'ghost' ? '1px solid #d1d5db' : 'none',
  background: variant === 'primary' ? '#1d4ed8' : variant === 'danger' ? '#ef4444' : 'white',
  color: variant === 'ghost' ? '#374151' : 'white',
  fontWeight: 500,
});

interface ProjectRowProps {
  project: Project;
  onDeleted: () => void;
  onSelectEnvironment: (project: Project, envName: string) => void;
}

function ProjectRow({ project, onDeleted, onSelectEnvironment }: ProjectRowProps) {
  const { showToast } = useToast();
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [newEnvName, setNewEnvName] = useState('');
  const [addingEnv, setAddingEnv] = useState(false);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);
  const [confirmDeleteEnvId, setConfirmDeleteEnvId] = useState<string | null>(null);
  const [editingEnvId, setEditingEnvId] = useState<string | null>(null);
  const [editingEnvName, setEditingEnvName] = useState('');

  const loadEnvs = useCallback(async () => {
    try {
      const envs = await getEnvironments(project.id);
      setEnvironments(envs);
    } catch {
      showToast('Failed to load environments', 'error');
    }
  }, [project.id, showToast]);

  useEffect(() => { void loadEnvs(); }, [loadEnvs]);

  async function handleAddEnv() {
    if (!newEnvName.trim()) return;
    try {
      await createEnvironment(project.id, newEnvName.trim());
      setNewEnvName('');
      setAddingEnv(false);
      await loadEnvs();
      showToast('Environment created');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create environment', 'error');
    }
  }

  async function handleDeleteEnv(envId: string) {
    try {
      await deleteEnvironment(project.id, envId);
      setConfirmDeleteEnvId(null);
      await loadEnvs();
      showToast('Environment deleted');
    } catch {
      showToast('Failed to delete environment', 'error');
    }
  }

  async function handleRenameEnv(envId: string) {
    if (!editingEnvName.trim()) return;
    try {
      await renameEnvironment(project.id, envId, editingEnvName.trim());
      setEditingEnvId(null);
      setEditingEnvName('');
      await loadEnvs();
      showToast('Environment renamed');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to rename environment', 'error');
    }
  }

  async function handleDeleteProject() {
    try {
      await deleteProject(project.id);
      onDeleted();
    } catch {
      showToast('Failed to delete project', 'error');
    }
  }

  return (
    <div style={{ background: 'white', borderRadius: 10, border: '1px solid #e5e7eb', marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '14px 20px', borderBottom: environments.length > 0 || addingEnv ? '1px solid #f3f4f6' : 'none' }}>
        <div style={{ flex: 1 }}>
          <span style={{ fontWeight: 600, fontSize: 15, color: '#111827' }}>{project.name}</span>
          <span style={{ fontSize: 12, color: '#4b5563', marginLeft: 8 }}>{new Date(project.createdAt).toLocaleDateString()}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btnStyle('ghost')} onClick={() => setAddingEnv(v => !v)}>+ Environment</button>
          {!confirmDeleteProject ? (
            <button style={btnStyle('ghost')} onClick={() => setConfirmDeleteProject(true)}>Delete</button>
          ) : (
            <>
              <button style={btnStyle('danger')} onClick={() => void handleDeleteProject()}>Confirm delete</button>
              <button style={btnStyle('ghost')} onClick={() => setConfirmDeleteProject(false)}>Cancel</button>
            </>
          )}
        </div>
      </div>

      {environments.map(env => (
        <div key={env.id} style={{ display: 'flex', alignItems: 'center', padding: '10px 20px 10px 36px', borderBottom: '1px solid #f9fafb' }}>
          {editingEnvId === env.id ? (
            <>
              <input
                style={{ ...inputStyle, flex: 1, marginRight: 8 }}
                value={editingEnvName}
                autoFocus
                onChange={e => setEditingEnvName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') void handleRenameEnv(env.id);
                  if (e.key === 'Escape') { setEditingEnvId(null); setEditingEnvName(''); }
                }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={{ ...btnStyle('primary'), padding: '4px 10px', fontSize: 12 }} onClick={() => void handleRenameEnv(env.id)} disabled={!editingEnvName.trim()}>Save</button>
                <button style={{ ...btnStyle('ghost'), padding: '4px 10px', fontSize: 12 }} onClick={() => { setEditingEnvId(null); setEditingEnvName(''); }}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <span
                style={{ flex: 1, fontSize: 13, color: '#374151', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: '#d1d5db' }}
                onClick={() => onSelectEnvironment(project, env.name)}
                title="Go to flags for this environment"
              >{env.name}</span>
              {confirmDeleteEnvId === env.id ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={{ ...btnStyle('danger'), padding: '4px 10px', fontSize: 12 }} onClick={() => void handleDeleteEnv(env.id)}>Confirm</button>
                  <button style={{ ...btnStyle('ghost'), padding: '4px 10px', fontSize: 12 }} onClick={() => setConfirmDeleteEnvId(null)}>Cancel</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    style={{ ...btnStyle('ghost'), padding: '4px 10px', fontSize: 12 }}
                    onClick={() => { setEditingEnvId(env.id); setEditingEnvName(env.name); setConfirmDeleteEnvId(null); }}
                    title="Rename"
                  >✎</button>
                  <button style={{ ...btnStyle('ghost'), padding: '4px 10px', fontSize: 12, color: '#ef4444', borderColor: '#fca5a5' }} onClick={() => setConfirmDeleteEnvId(env.id)}>Delete</button>
                </div>
              )}
            </>
          )}
        </div>
      ))}

      {addingEnv && (
        <div style={{ display: 'flex', gap: 8, padding: '10px 20px 10px 36px', background: '#f9fafb', borderTop: '1px solid #f3f4f6' }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            placeholder="environment name (e.g. staging)"
            value={newEnvName}
            autoFocus
            onChange={e => setNewEnvName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void handleAddEnv(); if (e.key === 'Escape') setAddingEnv(false); }}
          />
          <button style={btnStyle('primary')} onClick={() => void handleAddEnv()} disabled={!newEnvName.trim()}>Add</button>
          <button style={btnStyle('ghost')} onClick={() => setAddingEnv(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

export function ProjectsPage({ onProjectsChange, onSelectEnvironment }: { onProjectsChange?: () => void; onSelectEnvironment?: (project: Project, envName: string) => void }) {
  const { showToast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [newProjectName, setNewProjectName] = useState('');
  const [creating, setCreating] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      setProjects(await getProjects());
    } catch {
      showToast('Failed to load projects', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  async function handleCreate() {
    if (!newProjectName.trim()) return;
    setCreating(true);
    try {
      await createProject(newProjectName.trim());
      setNewProjectName('');
      await loadProjects();
      onProjectsChange?.();
      showToast('Project created');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create project', 'error');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: '#111827' }}>Projects</h1>
      </div>

      {!loading && projects.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          <input
            style={{ ...inputStyle, flex: 1, maxWidth: 320 }}
            placeholder="New project name"
            value={newProjectName}
            onChange={e => setNewProjectName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void handleCreate(); }}
          />
          <button
            style={{ ...btnStyle('primary'), opacity: creating || !newProjectName.trim() ? 0.6 : 1 }}
            onClick={() => void handleCreate()}
            disabled={creating || !newProjectName.trim()}
          >
            {creating ? 'Creating...' : 'Create Project'}
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner /></div>
      ) : projects.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 64, border: '2px dashed #e5e7eb', borderRadius: 12 }}>
          <p style={{ fontSize: 18, fontWeight: 600, color: '#111827', marginBottom: 8 }}>No projects yet</p>
          <p style={{ fontSize: 14, color: '#4b5563', marginBottom: 4 }}>Projects group your feature flags and API keys by application.</p>
          <p style={{ fontSize: 14, color: '#4b5563', marginBottom: 24 }}>Create your first project to start managing your features.</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <input
              style={{ ...inputStyle, width: 240 }}
              placeholder="Project name"
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleCreate(); }}
              autoFocus
            />
            <button
              style={{ ...btnStyle('primary'), opacity: creating || !newProjectName.trim() ? 0.6 : 1, padding: '7px 20px', fontSize: 14 }}
              onClick={() => void handleCreate()}
              disabled={creating || !newProjectName.trim()}
            >
              {creating ? 'Creating...' : 'Create project'}
            </button>
          </div>
        </div>
      ) : (
        projects.map(p => (
          <ProjectRow key={p.id} project={p} onDeleted={() => { void loadProjects(); onProjectsChange?.(); }} onSelectEnvironment={onSelectEnvironment ?? (() => {})} />
        ))
      )}
    </div>
  );
}
