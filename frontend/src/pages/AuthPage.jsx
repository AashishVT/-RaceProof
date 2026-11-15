import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, Command, Sparkles } from 'lucide-react';
import { authApi, apiErrorMessage } from '../services/api';
import { useAuth } from '../state/auth';
import { Button, Field, Notice } from '../components/ui';

export function AuthPage({ mode }) {
  const isRegister = mode === 'register';
  const { token, login } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  if (token) return <Navigate to="/" replace />;

  const change = (event) => setValues({ ...values, [event.target.name]: event.target.value });
  async function submit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isRegister) {
        await authApi.register(values);
        const result = await authApi.login({ email: values.email, password: values.password });
        login(result.token, result.user);
      } else {
        const result = await authApi.login({ email: values.email, password: values.password });
        login(result.token, result.user);
      }
      navigate('/', { replace: true });
    } catch (requestError) {
      setError(apiErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  return <main className="auth-layout">
    <section className="auth-story"><Link to="/login" className="brand brand-light"><span className="brand-mark"><Command size={19} /></span><span>raceproof</span></Link><div className="story-copy"><span className="story-kicker"><Sparkles size={15} /> IDEAS MOVE FASTER TOGETHER</span><h1>Find your people.<br /><em>Build what matters.</em></h1><p>A better way to find a team, bring the right skills together, and make hackathon weekends count.</p><div className="story-stat"><span className="stat-avatars"><i>J</i><i>M</i><i>A</i><i>+</i></span><span>Good things happen<br />when teams click.</span></div></div><div className="story-footer">Made for the builders, the curious, and the “what if?” people.</div></section>
    <section className="auth-panel"><div className="auth-mobile-brand"><span className="brand-mark"><Command size={19} /></span> raceproof</div><div className="auth-form-wrap"><span className="eyebrow">{isRegister ? 'YOUR NEXT CHAPTER' : 'WELCOME BACK'}</span><h2>{isRegister ? 'Create your account' : 'Sign in to RaceProof'}</h2><p className="auth-subtitle">{isRegister ? 'Make a profile and start finding your team.' : 'Pick up right where your team left off.'}</p><Notice>{error}</Notice>
      <form className="form-stack" onSubmit={submit}>
        {isRegister ? <Field label="Full name" name="name" autoComplete="name" placeholder="Jordan Lee" value={values.name} onChange={change} minLength={1} maxLength={100} required /> : null}
        <Field label="Email address" type="email" name="email" autoComplete="email" placeholder="you@example.com" value={values.email} onChange={change} required />
        <Field label="Password" type="password" name="password" autoComplete={isRegister ? 'new-password' : 'current-password'} placeholder={isRegister ? 'At least 8 characters' : 'Enter your password'} value={values.password} onChange={change} minLength={isRegister ? 8 : undefined} maxLength={72} required />
        <Button type="submit" loading={loading} className="button-wide">{isRegister ? 'Create account' : 'Sign in'}<ArrowRight size={17} /></Button>
      </form><p className="auth-switch">{isRegister ? 'Already have an account?' : 'New to RaceProof?'} <Link to={isRegister ? '/login' : '/register'}>{isRegister ? 'Sign in' : 'Create an account'}</Link></p><p className="auth-privacy">Your account details stay private and secure.</p>
    </div></section>
  </main>;
}
