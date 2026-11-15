import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Clock3, Copy, Crown, Link2, LogOut, RefreshCw, Sparkles, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { apiErrorMessage, teamsApi } from '../services/api';
import { connectRealtime, subscribeToTeam } from '../services/realtime';
import { useAuth } from '../state/auth';
import { Avatar, Button, CapacityBar, Card, EmptyState, Field, Notice, Spinner } from '../components/ui';
import { PageHeader } from '../components/shell';

const LIVE_EVENTS = [
  'team:join_request_created', 'team:join_request_accepted', 'team:join_request_declined',
  'team:member_joined', 'team:member_removed', 'team:member_left',
  'team:leadership_transferred', 'team:invite_revoked',
];

export function TeamDetail() {
  const { teamId } = useParams();
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [team, setTeam] = useState(null);
  const [requests, setRequests] = useState([]);
  const [suggestionData, setSuggestionData] = useState(null);
  const [invites, setInvites] = useState([]);
  const [inviteHours, setInviteHours] = useState(24);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [joinState, setJoinState] = useState('idle');
  const [copiedId, setCopiedId] = useState('');
  const debounceRef = useRef(null);
  const leadershipUpdateRef = useRef(null);

  const isMember = useMemo(() => team?.members?.some((member) => member.userId === user?.id) || false, [team, user]);
  const isLeader = team?.leaderId === user?.id;

  const loadTeam = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const nextTeam = await teamsApi.get(teamId);
      setTeam(nextTeam);
      const member = nextTeam.members?.some((entry) => entry.userId === user?.id);
      const leader = nextTeam.leaderId === user?.id;
      if (leader) {
        try { setRequests(await teamsApi.requests(teamId)); }
        catch (requestError) { if (requestError.response?.status !== 403) setError(apiErrorMessage(requestError)); }
        try { setInvites(await teamsApi.invites(teamId)); }
        catch (requestError) { if (requestError.response?.status !== 403) setError(apiErrorMessage(requestError)); }
      } else { setRequests([]); setInvites([]); }
      if (member) {
        try { setSuggestionData(await teamsApi.suggestions(teamId)); }
        catch { setSuggestionData(null); }
      } else setSuggestionData(null);
      return nextTeam;
    } catch (requestError) {
      setError(apiErrorMessage(requestError));
      if (requestError.response?.status === 404) setTeam(null);
    } finally { if (!quiet) setLoading(false); }
  }, [teamId, user?.id]);

  useEffect(() => { loadTeam(); }, [loadTeam]);

  useEffect(() => {
    if (!token || !team || !isMember) return undefined;
    const socket = connectRealtime(token);
    let disposed = false;
    const refresh = (event) => {
      if (event?.teamId !== teamId) return;
      window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(async () => {
        if (disposed) return;
        const updated = await loadTeam({ quiet: true });
        if (leadershipUpdateRef.current?.teamId === teamId) {
          const { toUserId } = leadershipUpdateRef.current;
          const nextLeader = updated?.members?.find((member) => member.userId === toUserId);
          setNotice(nextLeader ? `Leadership transferred to ${nextLeader.name}.` : 'Team leadership changed.');
          leadershipUpdateRef.current = null;
        }
      }, 80);
    };
    const onLeadershipTransfer = (event) => {
      if (event?.teamId !== teamId) return;
      leadershipUpdateRef.current = { teamId, toUserId: event.toUserId };
      refresh(event);
    };
    const subscribe = () => { void subscribeToTeam(socket, teamId); };
    socket.on('connect', subscribe);
    LIVE_EVENTS.filter((eventName) => eventName !== 'team:leadership_transferred').forEach((eventName) => socket.on(eventName, refresh));
    socket.on('team:leadership_transferred', onLeadershipTransfer);
    if (socket.connected) subscribe();
    return () => {
      disposed = true;
      window.clearTimeout(debounceRef.current);
      socket.off('connect', subscribe);
      LIVE_EVENTS.filter((eventName) => eventName !== 'team:leadership_transferred').forEach((eventName) => socket.off(eventName, refresh));
      socket.off('team:leadership_transferred', onLeadershipTransfer);
      socket.emit('team:unsubscribe', { teamId });
      socket.disconnect();
    };
  }, [token, teamId, team?.id, isMember, loadTeam]);

  async function runAction(key, action, successMessage, onSuccess) {
    setActionLoading(key); setError(''); setNotice('');
    try {
      const result = await action();
      setNotice(successMessage);
      window.dispatchEvent(new CustomEvent('raceproof:team-change', { detail: { teamId } }));
      await loadTeam({ quiet: true });
      if (onSuccess) onSuccess(result);
    } catch (requestError) { setError(apiErrorMessage(requestError)); }
    finally { setActionLoading(''); }
  }

  async function createInvite(event) {
    event.preventDefault();
    await runAction('invite', async () => {
      return teamsApi.createInvite(teamId, Number(inviteHours));
    }, 'Invite code created. Copy it now; the API returns the code only when it is created.', (invite) => {
      setInvites((previous) => [{ ...invite, isActive: true, isExpired: false }, ...previous.filter((entry) => entry.id !== invite.id)]);
    });
  }

  async function copyInvite(invite) {
    try {
      await navigator.clipboard.writeText(invite.code);
      setCopiedId(invite.id);
      window.setTimeout(() => setCopiedId(''), 1800);
    } catch { setError('Could not access the clipboard. Select and copy the invite code.'); }
  }

  if (loading) return <Spinner label="Loading team details" />;
  if (!team) return <><PageHeader eyebrow="TEAM" title="Team unavailable" subtitle={error || 'This team could not be loaded.'} /><Button variant="soft" onClick={() => navigate(-1)}><ArrowLeft size={16} /> Go back</Button></>;

  return <>
    <PageHeader eyebrow={team.hackathonStatus?.toUpperCase() || 'HACKATHON TEAM'} title={team.teamName} subtitle={`Team workspace · created ${new Date(team.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`} action={<button className="back-link" onClick={() => navigate(-1)}><ArrowLeft size={16} /> Back</button>} />
    {location.state?.created ? <Notice kind="success">Your team is live. You’re the leader.</Notice> : null}
    <Notice>{error}</Notice><Notice kind="success">{notice}</Notice>
    <div className="team-overview-grid">
      <Card className="team-summary"><div className="team-summary-top"><div><span className="card-eyebrow">TEAM SNAPSHOT</span><h2>{team.teamName}</h2><span className="id-label">Team ID <code>{team.id}</code></span></div><span className="team-status"><i /> {team.hackathonStatus}</span></div><div className="team-summary-bottom"><CapacityBar count={team.memberCount ?? team.members?.length} max={team.maxTeamSize} /><div className="seats-count"><strong>{Math.max(team.maxTeamSize - team.memberCount, 0)}</strong><span>seats available</span></div></div></Card>
      <Card className="team-hackathon"><span className="action-icon sky"><Sparkles size={20} /></span><span className="card-eyebrow">HACKATHON</span><h3>Ready to make something?</h3><p>Your team is part of hackathon <code>{team.hackathonId}</code>.</p><div className="id-copy">Team workspace <Link2 size={15} /></div></Card>
    </div>

    <div className="team-content-grid"><div className="team-main-column">
      <Card className="members-card"><div className="card-heading-row"><div><span className="card-eyebrow">YOUR CREW</span><h2>Team members <span className="count-pill">{team.members?.length || 0}</span></h2></div><span className="muted-label">{isMember ? 'Live updates enabled' : 'Team roster'}</span></div>
        <div className="member-list">{team.members?.map((member) => <div className="member-row" key={member.userId}><Avatar name={member.name} /><div className="member-info"><strong>{member.name}{member.userId === user?.id ? <small className="you-tag">YOU</small> : null}</strong><small>{member.timeZone || 'Timezone not set'}</small></div>{member.role === 'leader' ? <span className="role-badge"><Crown size={13} /> Leader</span> : <span className="role-badge role-member">Member</span>}{isLeader && member.userId !== user?.id ? <Button variant="danger-ghost" className="member-remove" loading={actionLoading === `remove-${member.userId}`} onClick={() => runAction(`remove-${member.userId}`, () => teamsApi.remove(teamId, member.userId), `${member.name} was removed.`)} aria-label={`Remove ${member.name}`}><UserMinus size={16} /></Button> : null}</div>)}</div>
        {!team.members?.length ? <EmptyState title="No members yet">Invite someone to start building the team.</EmptyState> : null}
        {!isMember ? <Button onClick={() => runAction('join', () => teamsApi.join(teamId), 'Join request sent. The team leader will review it.', () => setJoinState('sent'))} loading={actionLoading === 'join'} disabled={joinState === 'sent' || team.memberCount >= team.maxTeamSize}><UserPlus size={16} />{joinState === 'sent' ? 'Request sent' : 'Request to join'}</Button> : null}
        {isMember ? <Button variant="danger-ghost" onClick={() => { if (window.confirm(isLeader ? 'Leave this team? Leadership will transfer to another member, or the empty team will be deleted.' : 'Leave this team?')) runAction('leave', () => teamsApi.leave(teamId), 'You left the team.', (result) => result.deleted && navigate('/')); }} loading={actionLoading === 'leave'}><LogOut size={16} /> Leave team</Button> : null}
      </Card>

      {isLeader ? <Card className="requests-card"><div className="card-heading-row"><div><span className="card-eyebrow">TEAM INBOX</span><h2>Join requests <span className="count-pill">{requests.length}</span></h2></div><button className="icon-button" onClick={() => loadTeam({ quiet: true })} aria-label="Refresh join requests"><RefreshCw size={16} /></button></div>{requests.length ? <div className="request-list">{requests.map((request) => <div className="request-row" key={request.id}><Avatar name={request.userName} /><div className="request-info"><strong>{request.userName}</strong><small>{request.userEmail}</small><div className="skill-tags">{(request.skills || []).slice(0, 4).map((skill) => <span key={skill}>{skill}</span>)}</div></div><div className="request-actions"><Button className="small-button" loading={actionLoading === `accept-${request.id}`} onClick={() => runAction(`accept-${request.id}`, () => teamsApi.accept(teamId, request.id), `${request.userName} joined the team.`)}><Check size={15} /> Accept</Button><Button className="small-button" variant="ghost" loading={actionLoading === `decline-${request.id}`} onClick={() => runAction(`decline-${request.id}`, () => teamsApi.decline(teamId, request.id), 'Join request declined.')}><X size={15} /> Decline</Button></div></div>)}</div> : <EmptyState title="No pending requests">When someone asks to join, their request will appear here.</EmptyState>}</Card> : null}

      {isMember ? <Card className="suggestions-card"><div className="card-heading-row"><div><span className="card-eyebrow">SMART MATCHES</span><h2>People who complement your team</h2></div><Sparkles size={19} className="purple-icon" /></div>{suggestionData ? <><p className="suggestion-intro">{suggestionData.scoring.formula}</p>{suggestionData.teamSkillGaps?.length ? <div className="gap-tags"><span>Team skill gaps</span>{suggestionData.teamSkillGaps.map((skill) => <i key={skill}>{skill}</i>)}</div> : <p className="muted-label">Your team’s skill profile is still taking shape.</p>}{suggestionData.suggestions?.length ? <div className="suggestion-list">{suggestionData.suggestions.map((candidate) => <div className="suggestion-row" key={candidate.userId}><Avatar name={candidate.name} /><div className="suggestion-person"><strong>{candidate.name}</strong><div className="skill-tags">{candidate.skills.slice(0, 4).map((skill) => <span key={skill}>{skill}</span>)}</div><small>{candidate.explanation.matchedSkillGaps.length ? `Covers ${candidate.explanation.matchedSkillGaps.join(', ')}` : 'Could bring a fresh perspective'} · {candidate.explanation.timeZoneCompatibility}</small></div><span className="score-pill">{candidate.score}<small>score</small></span></div>)}</div> : <EmptyState title="No matches just yet">Eligible participants will show up here as they join the hackathon.</EmptyState>}<details className="scoring-note"><summary>How is this ranked?</summary><p>{suggestionData.scoring.skillGapDefinition} Time-zone points use these bands: {suggestionData.scoring.timeZoneBands.map((band) => `${band.maximumDifferenceHours}h / ${band.points} pts`).join(' · ')}.</p></details></> : <p className="muted-label">Suggestions are unavailable right now.</p>}</Card> : null}
    </div><aside className="team-aside-column">
      {isLeader ? <Card className="invite-card"><div className="invite-heading"><span className="action-icon mint"><Link2 size={19} /></span><div><span className="card-eyebrow">GROW YOUR TEAM</span><h2>Invite someone</h2></div></div><p>Create a secure, time-limited invite code to share with a teammate.</p><form onSubmit={createInvite} className="invite-form"><label className="field"><span>Expires in</span><select value={inviteHours} onChange={(event) => setInviteHours(event.target.value)}>{[1, 6, 12, 24, 72, 168, 720].map((hours) => <option value={hours} key={hours}>{hours < 24 ? `${hours} hour${hours > 1 ? 's' : ''}` : hours / 24 === 1 ? '1 day' : `${hours / 24} days`}</option>)}</select></label><Button type="submit" loading={actionLoading === 'invite'} disabled={team.memberCount >= team.maxTeamSize}><Link2 size={16} /> Generate code</Button></form>{invites.length ? <div className="invite-list"><span className="card-eyebrow">INVITE HISTORY</span>{invites.map((invite) => <div className="invite-code-row" key={invite.id}><div><code>{invite.code || 'Code hidden after creation'}</code><small><Clock3 size={12} /> {invite.isActive ? (invite.isExpired ? 'Expired' : `Expires ${new Date(invite.expiresAt).toLocaleString()}`) : 'Revoked'}</small></div><button className="icon-button" onClick={() => copyInvite(invite)} aria-label="Copy invite code" disabled={!invite.code || !invite.isActive || invite.isExpired}>{copiedId === invite.id ? <Check size={17} /> : <Copy size={17} />}</button><button className="icon-button danger-icon" onClick={() => runAction(`revoke-${invite.id}`, () => teamsApi.revokeInvite(teamId, invite.id), 'Invite revoked.')} aria-label="Revoke invite" disabled={!invite.isActive}>{invite.isActive ? <X size={17} /> : <Check size={17} />}</button></div>)}</div> : <EmptyState title="No invites yet">Generate an invite code and share it with a teammate.</EmptyState>}<p className="private-note">Invite codes are returned only at creation. After reload, you can inspect status and revoke them, but cannot retrieve the raw code.</p></Card> : null}
      <Card className="team-tip"><span className="tip-spark">✦</span><strong>Good teams make space.</strong><p>A mix of skills and perspectives can take an idea further.</p></Card>
    </aside></div>
  </>;
}
