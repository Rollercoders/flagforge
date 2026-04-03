import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { FlagsPage } from './pages/FlagsPage';
import { ApiKeysPage } from './pages/ApiKeysPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { LoginPage } from './pages/LoginPage';
import { Spinner } from './components/Spinner';
import { getProjects, getEnvironments, Project, Environment } from './api/projects';
import { checkAuth, logout } from './api/auth';

const globalStyles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; color: #111827; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
`;

export default function App() {
  const navigate = useNavigate();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [environment, setEnvironment] = useState('');

  useEffect(() => {
    checkAuth().then(ok => setAuthenticated(ok));
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    getProjects().then(ps => {
      setProjects(ps);
      if (ps.length > 0) setProject(ps[0]);
    }).catch(() => {});
  }, [authenticated]);

  useEffect(() => {
    if (!project) { setEnvironments([]); setEnvironment(''); return; }
    getEnvironments(project.id).then(envs => {
      setEnvironments(envs);
      setEnvironment(prev => envs.find(e => e.name === prev) ? prev : (envs.length > 0 ? envs[0].name : ''));
    }).catch(() => {});
  }, [project]);

  useEffect(() => {
    function handleUnauthorized() { setAuthenticated(false); }
    window.addEventListener('rf:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('rf:unauthorized', handleUnauthorized);
  }, []);

  async function handleLogout() {
    try { await logout(); } catch { /* ignore */ }
    setAuthenticated(false);
  }

  function selectEnvironment(proj: Project, envName: string) {
    setProject(proj);
    setEnvironment(envName);
    navigate('/flags');
  }

  function refreshProjects() {
    getProjects().then(ps => {
      setProjects(ps);
      if (project && !ps.find(p => p.id === project.id)) {
        // currently selected project was deleted — reselect
        setProject(ps.length > 0 ? ps[0] : null);
      } else if (!project && ps.length > 0) {
        setProject(ps[0]);
      }
    }).catch(() => {});
  }

  if (authenticated === null) {
    return (
      <>
        <style>{globalStyles}</style>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
          <Spinner />
        </div>
      </>
    );
  }

  if (!authenticated) {
    return (
      <>
        <style>{globalStyles}</style>
        <LoginPage onLogin={() => setAuthenticated(true)} />
      </>
    );
  }

  const selectorStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 8px',
    background: '#334155',
    border: '1px solid #475569',
    borderRadius: 6,
    color: 'white',
    fontSize: 13,
    cursor: 'pointer',
  };

  return (
    <>
      <style>{globalStyles}</style>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <aside style={{ width: 220, background: '#1e293b', color: '#94a3b8', display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'fixed', top: 0, left: 0, bottom: 0 }}>
          <div style={{ padding: '20px 20px 16px', color: 'white', fontWeight: 700, fontSize: 16, borderBottom: '1px solid #334155' }}>
            <img src="/logo.png" alt="FlagForge" style={{ height: 24, marginRight: 8, verticalAlign: 'middle' }} />FlagForge
          </div>

          <div style={{ padding: '12px 16px', borderBottom: '1px solid #334155' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Project</div>
            <select value={project?.id ?? ''} onChange={e => setProject(projects.find(p => p.id === e.target.value) ?? null)} style={selectorStyle}>
              {projects.length === 0
                ? <option value="">No projects yet</option>
                : projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)
              }
            </select>
          </div>

          <div style={{ padding: '12px 16px', borderBottom: '1px solid #334155' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Environment</div>
            <select value={environment} onChange={e => setEnvironment(e.target.value)} style={selectorStyle}>
              {environments.length === 0
                ? <option value="">No environments yet</option>
                : environments.map(env => <option key={env.id} value={env.name}>{env.name}</option>)
              }
            </select>
          </div>

          <nav style={{ flex: 1, padding: '12px 12px' }}>
            {[
              { to: '/projects', label: 'Projects' },
              { to: '/flags', label: 'Feature Flags' },
              { to: '/api-keys', label: 'API Keys' },
            ].map(({ to, label }) => (
              <NavLink key={to} to={to} style={({ isActive }) => ({
                display: 'block', padding: '8px 12px', borderRadius: 6, marginBottom: 2,
                color: isActive ? 'white' : '#cbd5e1', background: isActive ? '#334155' : 'transparent',
                textDecoration: 'none', fontSize: 14, fontWeight: isActive ? 500 : 400,
              })}>
                {label}
              </NavLink>
            ))}
          </nav>

          <div style={{ padding: '12px 16px', borderTop: '1px solid #334155' }}>
            <button onClick={() => void handleLogout()} style={{ width: '100%', padding: '7px 12px', background: 'transparent', border: '1px solid #475569', borderRadius: 6, color: '#cbd5e1', fontSize: 13, cursor: 'pointer', textAlign: 'left' }}>
              Sign out
            </button>
          </div>
        </aside>

        <main style={{ flex: 1, marginLeft: 220, minHeight: '100vh' }}>
          <Routes>
            <Route path="/" element={<Navigate to="/flags" replace />} />
            <Route path="/flags" element={<FlagsPage projectId={project?.id ?? ''} projectName={project?.name ?? ''} environment={environment} />} />
            <Route path="/api-keys" element={<ApiKeysPage projectId={project?.id ?? ''} environments={environments.map(e => e.name)} />} />
            <Route path="/projects" element={<ProjectsPage onProjectsChange={refreshProjects} onSelectEnvironment={selectEnvironment} />} />
          </Routes>
        </main>
      </div>
    </>
  );
}
