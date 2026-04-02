import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useState } from 'react';
import { FlagsPage } from './pages/FlagsPage';
import { ApiKeysPage } from './pages/ApiKeysPage';

const ENVIRONMENTS = ['production', 'staging', 'development'];

const globalStyles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; color: #111827; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
`;

export default function App() {
  const [environment, setEnvironment] = useState('production');

  return (
    <>
      <style>{globalStyles}</style>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        {/* Sidebar */}
        <aside
          style={{
            width: 220,
            background: '#1e293b',
            color: '#94a3b8',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            position: 'fixed',
            top: 0,
            left: 0,
            bottom: 0,
          }}
        >
          {/* Logo */}
          <div
            style={{
              padding: '20px 20px 16px',
              color: 'white',
              fontWeight: 700,
              fontSize: 16,
              borderBottom: '1px solid #334155',
            }}
          >
            🚩 RollerFlags
          </div>

          {/* Nav */}
          <nav style={{ flex: 1, padding: '12px 12px' }}>
            {[
              { to: '/flags', label: 'Feature Flags' },
              { to: '/api-keys', label: 'API Keys' },
            ].map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                style={({ isActive }) => ({
                  display: 'block',
                  padding: '8px 12px',
                  borderRadius: 6,
                  marginBottom: 2,
                  color: isActive ? 'white' : '#94a3b8',
                  background: isActive ? '#334155' : 'transparent',
                  textDecoration: 'none',
                  fontSize: 14,
                  fontWeight: isActive ? 500 : 400,
                })}
              >
                {label}
              </NavLink>
            ))}
          </nav>

          {/* Environment selector */}
          <div
            style={{
              padding: '16px',
              borderTop: '1px solid #334155',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Environment
            </div>
            <select
              value={environment}
              onChange={e => setEnvironment(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 8px',
                background: '#334155',
                border: '1px solid #475569',
                borderRadius: 6,
                color: 'white',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {ENVIRONMENTS.map(env => (
                <option key={env} value={env}>{env}</option>
              ))}
            </select>
          </div>
        </aside>

        {/* Main content */}
        <main style={{ flex: 1, marginLeft: 220, minHeight: '100vh' }}>
          <Routes>
            <Route path="/" element={<Navigate to="/flags" replace />} />
            <Route path="/flags" element={<FlagsPage environment={environment} />} />
            <Route path="/api-keys" element={<ApiKeysPage />} />
          </Routes>
        </main>
      </div>
    </>
  );
}
