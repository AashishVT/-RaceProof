import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { connectRealtime } from './services/realtime';
import { useAuth } from './state/auth';
import { Spinner } from './components/ui';
import { AppShell } from './components/shell';
import { AuthPage } from './pages/AuthPage';
import { Dashboard } from './pages/Dashboard';
import { CreateTeam } from './pages/CreateTeam';
import { TeamDetail } from './pages/TeamDetail';

function Protected({ children }) {
  const { token, loading } = useAuth();
  if (loading) return <Spinner label="Restoring your session" />;
  return token ? children : <Navigate to="/login" replace />;
}

function RealtimeSession() {
  const { token } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!token) return undefined;
    const socket = connectRealtime(token);
    const onCreated = (event) => { if (event?.teamId) navigate(`/teams/${event.teamId}`); };
    const onPersonalChange = (event) => window.dispatchEvent(new CustomEvent('raceproof:team-change', { detail: event }));
    const personalEvents = ['team:join_request_accepted', 'team:join_request_declined', 'team:member_joined', 'team:member_removed', 'team:member_left', 'team:leadership_transferred'];
    socket.on('team:created', onCreated);
    personalEvents.forEach((eventName) => socket.on(eventName, onPersonalChange));
    return () => {
      socket.off('team:created', onCreated);
      personalEvents.forEach((eventName) => socket.off(eventName, onPersonalChange));
      socket.disconnect();
    };
  }, [token, navigate]);
  return null;
}

export default function App() {
  return <>
    <RealtimeSession />
    <Routes>
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route path="/" element={<Protected><AppShell><Dashboard /></AppShell></Protected>} />
      <Route path="/teams/new" element={<Protected><AppShell><CreateTeam /></AppShell></Protected>} />
      <Route path="/teams/:teamId" element={<Protected><AppShell><TeamDetail /></AppShell></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </>;
}
