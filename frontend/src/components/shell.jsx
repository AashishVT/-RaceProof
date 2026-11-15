import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { ChevronDown, Command, LogOut, Menu, Plus, Users, X } from 'lucide-react';
import { useAuth } from '../state/auth';
import { Avatar, Button } from './ui';

export function AppShell({ children }) {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  return <div className="app-frame">
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <Link to="/" className="brand"><span className="brand-mark"><Command size={19} /></span><span>raceproof</span></Link>
      <div className="workspace-label">WORKSPACE</div>
      <nav aria-label="Main navigation" className="side-nav">
        <NavLink to="/" end onClick={() => setMenuOpen(false)}><span className="nav-dot" />Overview</NavLink>
        <NavLink to="/teams/new" onClick={() => setMenuOpen(false)}><Plus size={17} />Create a team</NavLink>
      </nav>
      <div className="sidebar-bottom">
        <div className="help-card"><div className="help-icon">✦</div><strong>Make your next thing</strong><p>Great ideas get better with the right people.</p><Link to="/teams/new">Start building <span>↗</span></Link></div>
        <div className="user-card"><Avatar name={user?.name} /><div className="user-meta"><strong>{user?.name || 'Member'}</strong><small>{user?.email}</small></div><button title="Log out" className="icon-button" onClick={logout}><LogOut size={17} /></button></div>
      </div>
    </aside>
    <div className="main-column">
      <header className="topbar">
        <button className="mobile-menu icon-button" onClick={() => setMenuOpen((value) => !value)} aria-label={menuOpen ? 'Close menu' : 'Open menu'}>{menuOpen ? <X /> : <Menu />}</button>
        <div className="breadcrumb"><span>Workspace</span><span className="crumb-sep">/</span><strong>Teams</strong></div>
        <div className="top-actions"><span className="connection-status"><i /> Live updates enabled</span><button className="top-user" onClick={() => navigate('/')}><Avatar name={user?.name} size="small" /><ChevronDown size={15} /></button></div>
      </header>
      <main className="page-content" onClick={() => menuOpen && setMenuOpen(false)}>{children}</main>
    </div>
  </div>;
}

export function PageHeader({ eyebrow, title, subtitle, action }) {
  return <div className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>{action ? <div className="page-header-action">{action}</div> : null}</div>;
}

export function PrimaryLink({ to, children }) {
  return <Button onClick={() => window.location.assign(to)}><Plus size={16} />{children}</Button>;
}
