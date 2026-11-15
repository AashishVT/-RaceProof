import { AlertCircle, CheckCircle2, LoaderCircle, Search, Users } from 'lucide-react';

export function Button({ variant = 'primary', loading = false, className = '', children, ...props }) {
  return <button className={`button button-${variant} ${className}`} disabled={loading || props.disabled} {...props}>
    {loading ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : null}{children}
  </button>;
}

export function Field({ label, hint, ...props }) {
  return <label className="field"><span>{label}</span><input {...props} />{hint ? <small>{hint}</small> : null}</label>;
}

export function Notice({ kind = 'error', children, onDismiss }) {
  if (!children) return null;
  const Icon = kind === 'success' ? CheckCircle2 : AlertCircle;
  return <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
    <Icon size={18} aria-hidden="true" /><span>{children}</span>
    {onDismiss ? <button className="notice-close" onClick={onDismiss} aria-label="Dismiss message">×</button> : null}
  </div>;
}

export function Card({ className = '', children, ...props }) {
  return <section className={`card ${className}`} {...props}>{children}</section>;
}

export function EmptyState({ title, children, icon: Icon = Users }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={22} /></span><h3>{title}</h3><p>{children}</p></div>;
}

export function SearchField(props) {
  const { 'aria-label': label = 'Search teams', ...inputProps } = props;
  return <div className="search-field"><Search size={17} aria-hidden="true" /><input aria-label={label} placeholder="Search teams" {...inputProps} /></div>;
}

export function Spinner({ label = 'Loading' }) {
  return <div className="spinner-wrap" role="status"><LoaderCircle className="spin" size={24} /><span>{label}</span></div>;
}

export function Avatar({ name = 'Member', size = 'normal' }) {
  return <span className={`avatar avatar-${size}`} aria-label={name}>{name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span>;
}

export function CapacityBar({ count = 0, max = 1 }) {
  const ratio = Math.min(count / Math.max(max, 1), 1);
  return <div className="capacity"><div className="capacity-track"><span style={{ width: `${ratio * 100}%` }} /></div><small>{count} / {max} members</small></div>;
}
