import React, { useState, useEffect } from 'react';
import Login from './pages/Login.jsx';
import Layout from './components/Layout.jsx';
import Analyze from './pages/Analyze.jsx';
import Employees from './pages/Employees.jsx';
import Settings from './pages/Settings.jsx';
import History from './pages/History.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [page, setPage] = useState('analyze');

  useEffect(() => {
    fetch('/api/me')
      .then((r) => r.json())
      .then((d) => {
        if (d.authenticated) setUser(d.username);
        setChecking(false);
      })
      .catch(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="spinner spinner-dark" style={{ width: 32, height: 32 }} />
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  const renderPage = () => {
    switch (page) {
      case 'analyze': return <Analyze />;
      case 'employees': return <Employees />;
      case 'history': return <History onNavigate={setPage} />;
      case 'settings': return <Settings onLogout={() => setUser(null)} />;
      default: return <Analyze />;
    }
  };

  return (
    <Layout page={page} onNavigate={setPage} username={user}>
      {renderPage()}
    </Layout>
  );
}
