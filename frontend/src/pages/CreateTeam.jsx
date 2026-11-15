import { useState } from 'react';
import { ArrowLeft, Info, ShieldCheck, Users } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { apiErrorMessage, teamsApi } from '../services/api';
import { Button, Card, Field, Notice } from '../components/ui';
import { PageHeader } from '../components/shell';

export function CreateTeam() {
  const [values, setValues] = useState({ hackathonId: '', teamName: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  async function submit(event) {
    event.preventDefault(); setError(''); setLoading(true);
    try {
      const team = await teamsApi.create(values);
      navigate(`/teams/${team.id}`, { state: { created: true } });
    } catch (requestError) { setError(apiErrorMessage(requestError)); }
    finally { setLoading(false); }
  }
  return <>
    <PageHeader eyebrow="TEAM SETUP" title="Start something together." subtitle="Create a home for your idea and invite the right people in." action={<Link className="back-link" to="/"><ArrowLeft size={16} /> Back to overview</Link>} />
    <div className="create-layout"><Card className="create-card"><div className="form-card-heading"><span className="action-icon lilac"><Users size={20} /></span><div><h2>Team details</h2><p>Choose a name your future teammates will recognize.</p></div></div><Notice>{error}</Notice><form className="form-stack" onSubmit={submit}>
      <Field label="Hackathon ID" name="hackathonId" value={values.hackathonId} onChange={(event) => setValues({ ...values, hackathonId: event.target.value.trim() })} placeholder="Paste the organizer-provided ID" required aria-describedby="hackathon-help" />
      <p id="hackathon-help" className="field-note"><Info size={15} /> Hackathon discovery isn’t available in the current API. Use the ID provided by your organizer.</p>
      <Field label="Team name" name="teamName" value={values.teamName} onChange={(event) => setValues({ ...values, teamName: event.target.value })} placeholder="e.g. The Good Idea Club" minLength={2} maxLength={80} required />
      <div className="policy-row"><span className="policy-icon"><ShieldCheck size={18} /></span><div><strong>Size rules come from the hackathon</strong><small>The API applies the organizer’s minimum and maximum team size. You’ll start as team leader.</small></div></div>
      <div className="form-actions"><Link className="button button-ghost" to="/">Cancel</Link><Button type="submit" loading={loading}>Create team <span>→</span></Button></div>
    </form></Card><div className="side-note"><span className="note-number">01</span><h3>Make room for good ideas.</h3><p>Once your team is created, share an invite or review join requests as they come in.</p><div className="note-rule" /><small>Team formation, made a little easier.</small></div></div>
  </>;
}
