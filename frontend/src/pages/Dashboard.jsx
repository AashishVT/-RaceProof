import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Compass, Hash, Search, Users, UserPlus, CalendarDays, Clock3 } from 'lucide-react';
import { apiErrorMessage, hackathonsApi, teamsApi } from '../services/api';
import { Avatar, Button, CapacityBar, Card, EmptyState, Notice, SearchField, Spinner } from '../components/ui';
import { PageHeader } from '../components/shell';

export function Dashboard() {
  const [teamId, setTeamId] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [hackathonSearch, setHackathonSearch] = useState('');
  const [hackathonPage, setHackathonPage] = useState(1);
  const [hackathons, setHackathons] = useState([]);
  const [selectedHackathonId, setSelectedHackathonId] = useState('');
  const [hackathonPagination, setHackathonPagination] = useState(null);
  const [hackathonsLoading, setHackathonsLoading] = useState(true);
  const [hackathonError, setHackathonError] = useState('');
  const [teamSearch, setTeamSearch] = useState('');
  const [directoryTeams, setDirectoryTeams] = useState([]);
  const [teamsPagination, setTeamsPagination] = useState(null);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState('');
  const [myTeams, setMyTeams] = useState([]);
  const [myRequests, setMyRequests] = useState([]);
  const [myTeamsLoading, setMyTeamsLoading] = useState(true);
  const [myRequestsLoading, setMyRequestsLoading] = useState(true);
  const [personalError, setPersonalError] = useState('');
  const [teamPage, setTeamPage] = useState(1);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setHackathonsLoading(true);
      setHackathonError('');
      try {
        const result = await hackathonsApi.list({ page: hackathonPage, pageSize: 12, q: hackathonSearch || undefined, status: 'upcoming,active' });
        if (!active) return;
        setHackathons(result.hackathons);
        setHackathonPagination(result.pagination);
        setSelectedHackathonId((current) => result.hackathons.some((item) => item.id === current) ? current : result.hackathons[0]?.id || '');
      } catch (requestError) { if (active) setHackathonError(apiErrorMessage(requestError)); }
      finally { if (active) setHackathonsLoading(false); }
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [hackathonSearch, hackathonPage]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      if (!selectedHackathonId) { setDirectoryTeams([]); setTeamsPagination(null); setDirectoryLoading(false); return; }
      setDirectoryLoading(true);
      setDirectoryError('');
      try {
        const result = await hackathonsApi.teams(selectedHackathonId, {
          page: teamPage, pageSize: 8, q: teamSearch || undefined, availableOnly: true,
        });
        if (active) { setDirectoryTeams(result.teams); setTeamsPagination(result.pagination); }
      } catch (requestError) { if (active) setDirectoryError(apiErrorMessage(requestError)); }
      finally { if (active) setDirectoryLoading(false); }
    }, 150);
    return () => { active = false; window.clearTimeout(timer); };
  }, [selectedHackathonId, teamSearch, teamPage]);

  useEffect(() => {
    let active = true;
    Promise.all([teamsApi.mine(), teamsApi.myRequests({ page: 1, pageSize: 8 })])
      .then(([teams, requests]) => {
        if (!active) return;
        setMyTeams(teams);
        setMyRequests(requests.joinRequests);
      })
      .catch((requestError) => { if (active) setPersonalError(apiErrorMessage(requestError)); })
      .finally(() => {
        if (active) { setMyTeamsLoading(false); setMyRequestsLoading(false); }
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      Promise.all([teamsApi.mine(), teamsApi.myRequests({ page: 1, pageSize: 8 })])
        .then(([teams, requests]) => {
          if (active) { setMyTeams(teams); setMyRequests(requests.joinRequests); }
        })
        .catch((requestError) => { if (active) setPersonalError(apiErrorMessage(requestError)); });
    };
    window.addEventListener('raceproof:team-change', refresh);
    return () => { active = false; window.removeEventListener('raceproof:team-change', refresh); };
  }, []);

  async function redeem(event) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('');
    try {
      const result = await teamsApi.redeemInvite(code.trim());
      setCode('');
      navigate(`/teams/${result.teamId}`);
    } catch (requestError) { setError(apiErrorMessage(requestError)); }
    finally { setBusy(false); }
  }
  function openTeam(event) {
    event.preventDefault(); setError('');
    if (!teamId.trim()) return;
    navigate(`/teams/${teamId.trim()}`);
  }

  const selectedHackathon = hackathons.find((hackathon) => hackathon.id === selectedHackathonId);
  return <>
    <PageHeader eyebrow="YOUR WORKSPACE" title="Good things start with a team." subtitle="Find your crew, bring an idea to life, and make your next hackathon count." action={<Link className="button button-primary" to="/teams/new"><span>＋</span> Create a team</Link>} />
    <div className="welcome-banner"><div className="welcome-copy"><span className="banner-kicker">YOUR NEXT BUILD STARTS HERE</span><h2>Big ideas need good people.</h2><p>Start a team or join one that’s already building something great.</p><Link to="/teams/new" className="banner-link">Create your team <ArrowRight size={16} /></Link></div><div className="banner-art" aria-hidden="true"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><span className="orbit-core"><Users size={32} /></span><span className="orbit-person person-one" /><span className="orbit-person person-two" /><span className="orbit-person person-three" /></div></div>

    <div className="section-heading"><div><span className="eyebrow">YOUR RACEPROOF</span><h2>Your teams and requests</h2></div><span className="muted-label">Membership updates appear in real time</span></div>
    {myTeamsLoading ? <Spinner label="Loading your teams" /> : personalError ? <Card className="personal-empty"><EmptyState title="Your teams couldn’t be loaded">{personalError}</EmptyState></Card> : myTeams.length ? <div className="my-team-grid">{myTeams.map((team) => <Card className="my-team-card" key={team.id}><div className="team-card-top"><span className="action-icon lilac"><Users size={18} /></span><span className="team-status"><i /> {team.hackathonStatus}</span></div><span className="card-eyebrow">{team.hackathonName}</span><h3>{team.teamName}</h3><p>You’re a {team.userRole} · {team.members?.length || team.memberCount} members</p><CapacityBar count={team.memberCount} max={team.maxTeamSize} /><Link to={`/teams/${team.id}`} className="team-card-link">Open team <ArrowRight size={15} /></Link></Card>)}</div> : <Card className="personal-empty"><EmptyState title="You haven’t joined a team yet">Explore open teams below or create a team for your hackathon.</EmptyState></Card>}

    <div className="dashboard-columns"><section><div className="section-heading"><div><span className="eyebrow">YOUR ACTIVITY</span><h2>Pending requests</h2></div><span className="count-pill">{myRequestsLoading ? '…' : myRequests.length}</span></div>
      {myRequestsLoading ? <Card className="loading-card"><Spinner label="Loading requests" /></Card> : personalError ? <Card className="dashboard-list"><EmptyState title="Requests couldn’t be loaded">{personalError}</EmptyState></Card> : myRequests.length ? <Card className="dashboard-list">{myRequests.map((request) => <div className="personal-request" key={request.id}><span className="request-icon"><Clock3 size={17} /></span><div><strong>{request.teamName}</strong><small>{request.hackathonName} · sent {new Date(request.createdAt).toLocaleDateString()}</small></div><span className="pending-pill">Pending</span><Link to={`/teams/${request.teamId}`} aria-label={`View ${request.teamName}`} className="icon-button"><ArrowRight size={16} /></Link></div>)}</Card> : <Card className="dashboard-list"><EmptyState title="No pending requests">Requests you’ve sent to join a team will appear here.</EmptyState></Card>}
    </section><section><div className="section-heading"><div><span className="eyebrow">JOIN IN</span><h2>Redeem an invite</h2></div></div><Card className="redeem-card"><span className="action-icon mint"><UserPlus size={19} /></span><p>Enter the secure code a team leader shared with you.</p><form onSubmit={redeem} className="redeem-form"><label htmlFor="dashboard-invite-code">Invite code</label><div><input id="dashboard-invite-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Paste your invite code" autoComplete="off" required /><Button type="submit" loading={busy} aria-label="Redeem invite"><ArrowRight size={17} /></Button></div></form><Notice>{error}</Notice></Card></section></div>

    <div className="section-heading discovery-heading"><div><span className="eyebrow">DISCOVER</span><h2>Hackathons</h2></div><span className="count-pill">{hackathonPagination?.total ?? 0}</span></div>
    <div className="directory-toolbar"><SearchField aria-label="Search hackathons" value={hackathonSearch} onChange={(event) => { setHackathonSearch(event.target.value); setHackathonPage(1); setSelectedHackathonId(''); }} placeholder="Search hackathons by name" /><span>Upcoming and active</span></div>
    {hackathonsLoading ? <Spinner label="Loading hackathons" /> : hackathonError ? <Card className="personal-empty"><EmptyState title="Hackathons couldn’t be loaded">{hackathonError}</EmptyState></Card> : hackathons.length ? <div className="hackathon-grid">{hackathons.map((hackathon) => <button key={hackathon.id} className={`hackathon-card ${selectedHackathonId === hackathon.id ? 'hackathon-selected' : ''}`} onClick={() => { setSelectedHackathonId(hackathon.id); setTeamPage(1); }}><div className="hackathon-card-top"><span className="action-icon sky"><CalendarDays size={18} /></span><span className="team-status"><i />{hackathon.status}</span></div><h3>{hackathon.name}</h3><p>Team size {hackathon.minTeamSize}–{hackathon.maxTeamSize}</p><span className="hackathon-card-cta">{selectedHackathonId === hackathon.id ? 'Showing teams' : 'Explore teams'} <ArrowRight size={14} /></span></button>)}</div> : <Card className="personal-empty"><EmptyState title={hackathonSearch ? 'No matching hackathons' : 'No open hackathons'}>Try another search, or create a team when an organizer shares a hackathon ID.</EmptyState></Card>}

    {selectedHackathon ? <><div className="section-heading team-directory-heading"><div><span className="eyebrow">OPEN TEAMS</span><h2>{selectedHackathon.name}</h2></div><span className="muted-label">Available seats only</span></div><div className="directory-toolbar"><SearchField value={teamSearch} onChange={(event) => { setTeamSearch(event.target.value); setTeamPage(1); }} placeholder="Search teams" /></div><Notice>{directoryError}</Notice>
      {directoryLoading ? <Spinner label="Loading teams" /> : directoryError ? <Card className="personal-empty"><EmptyState title="Teams couldn’t be loaded">{directoryError}</EmptyState></Card> : directoryTeams.length ? <div className="directory-team-grid">{directoryTeams.map((team) => <Card className="directory-team-card" key={team.id}><div className="team-card-top"><span className="action-icon lilac"><Users size={18} /></span><span className="seats-tag">{team.seatsAvailable} seats open</span></div><span className="card-eyebrow">{team.hackathonName}</span><h3>{team.teamName}</h3><CapacityBar count={team.memberCount} max={team.maxTeamSize} /><Link to={`/teams/${team.id}`} className="team-card-link">View team <ArrowUpRight size={15} /></Link></Card>)}</div> : <Card className="personal-empty"><EmptyState title={teamSearch ? 'No matching teams' : 'No open teams yet'}>Try a different name or start a new team.</EmptyState></Card>}
      {teamsPagination?.totalPages > 1 ? <div className="pagination-actions"><span>Page {teamsPagination.page} of {teamsPagination.totalPages}</span><div><Button variant="ghost" disabled={teamPage <= 1} onClick={() => setTeamPage((page) => page - 1)}>Previous</Button><Button variant="soft" disabled={teamPage >= teamsPagination.totalPages} onClick={() => setTeamPage((page) => page + 1)}>Next</Button></div></div> : null}
    </> : null}
    {hackathonPagination?.totalPages > 1 ? <div className="pagination-actions"><span>Page {hackathonPagination.page} of {hackathonPagination.totalPages}</span><div><Button variant="ghost" disabled={hackathonPage <= 1} onClick={() => { setHackathonPage((page) => page - 1); setSelectedHackathonId(''); }}>Previous</Button><Button variant="soft" disabled={hackathonPage >= hackathonPagination.totalPages} onClick={() => { setHackathonPage((page) => page + 1); setSelectedHackathonId(''); }}>Next</Button></div></div> : null}
    <div className="dashboard-footnote"><Hash size={15} /> Search and team details are live; team membership and pending requests are loaded from your account.</div>
  </>;
}
