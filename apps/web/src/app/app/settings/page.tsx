import { requireSession } from '@/server/session';
import { listSessions, listApiTokens } from '@lifeos/core/auth';
import { PageHeader, Section } from '@/components/ui';
import { ApiButton, ApiForm } from '@/components/api';
import { LOCALES } from '@/i18n/messages';
import { MfaSetup, PushSetup, TokenCreator } from '@/components/settings';
import { fmtDateTime } from '@/lib/format';

export const metadata = { title: 'Settings' };

const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'];

export default async function SettingsPage() {
  const s = await requireSession();
  const u = s.user;
  const [sessions, tokens] = await Promise.all([listSessions(s.ctx.db, u.id), listApiTokens(s.ctx.db, u.id) as Promise<{ id: string; name: string; scopes: string[]; created_at: Date; last_used_at: Date | null }[]>]);
  const tzs = TIMEZONES.includes(u.timezone) ? TIMEZONES : [u.timezone, ...TIMEZONES];
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Profile & region">
          <ApiForm path="/me" method="PATCH" resetOnSuccess={false} success="Saved. Reminders were re-timed if your timezone or default time changed." className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className="label" htmlFor="dn">Name</label><input id="dn" name="displayName" defaultValue={u.display_name} className="field" /></div>
            <div><label className="label" htmlFor="lc">Language</label><select id="lc" name="locale" defaultValue={u.locale} className="field">{LOCALES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></div>
            <div><label className="label" htmlFor="tz">Timezone</label><select id="tz" name="timezone" defaultValue={u.timezone} className="field">{tzs.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
            <div><label className="label" htmlFor="do">Numeric dates like 04/03</label><select id="do" name="dateOrder" defaultValue={u.date_order} className="field"><option value="DMY">Day first (4 March)</option><option value="MDY">Month first (April 3)</option></select></div>
            <div><label className="label" htmlFor="cu">Currency</label><select id="cu" name="currency" defaultValue={u.currency} className="field">{['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'].map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label className="label" htmlFor="rt">Default reminder time</label><input id="rt" name="defaultReminderTime" type="time" defaultValue={u.default_reminder_time} className="field" /><p className="mt-1 text-xs muted">Used when something has a date but no time.</p></div>
            <div className="grid grid-cols-2 gap-2"><div><label className="label" htmlFor="qs">Quiet from</label><input id="qs" name="quietHoursStart" type="time" defaultValue={u.quiet_hours_start ?? ''} className="field" /></div><div><label className="label" htmlFor="qe">until</label><input id="qe" name="quietHoursEnd" type="time" defaultValue={u.quiet_hours_end ?? ''} className="field" /></div></div>
            <div className="sm:col-span-2"><button className="btn btn-primary">Save</button></div>
          </ApiForm>
        </Section>
        <Section title="Notifications">
          <p className="mb-3 text-sm muted">In-app notifications always work. Browser push depends on your browser and device: on iPhone and iPad it needs LifeOS installed to the Home Screen (iOS 16.4+); some Android battery settings delay it. Reminders in quiet hours wait until they end.</p>
          <PushSetup />
        </Section>
        <Section title="Password">
          <ApiForm path="/me/password" success="Password changed. Other devices were signed out." className="space-y-2">
            <input name="current" type="password" autoComplete="current-password" required className="field" placeholder="Current password" aria-label="Current password" />
            <input name="next" type="password" autoComplete="new-password" minLength={10} required className="field" placeholder="New password (10+ characters)" aria-label="New password" />
            <button className="btn btn-sm btn-primary">Change password</button>
          </ApiForm>
        </Section>
        <Section title="Two-step verification">
          {u.mfa_enabled_at ? <p className="text-sm">On since {fmtDateTime(u.mfa_enabled_at, u.timezone)}. You’ll be asked for a code when you sign in.</p> : <MfaSetup />}
        </Section>
        <Section title="Signed-in devices">
          <ul className="space-y-2 text-sm">{sessions.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2"><span className="min-w-0"><span className="block truncate">{x.user_agent?.replace(/\(.*?\)/g, '').slice(0, 60) ?? 'Unknown device'}{x.id === s.sessionId ? ' — this device' : ''}</span><span className="text-xs muted">last active {fmtDateTime(x.last_seen_at, u.timezone)}</span></span>
              {x.id !== s.sessionId && <ApiButton path={`/me/sessions/${x.id}`} method="DELETE" className="btn btn-sm btn-danger">Sign out</ApiButton>}</li>
          ))}</ul>
        </Section>
        <Section title="Browser extension & API tokens">
          <p className="mb-3 text-sm muted">Tokens let the LifeOS browser extension (or your own scripts) save captures. Each token is shown once; revoke it here any time.</p>
          <ul className="mb-3 space-y-1.5 text-sm">{tokens.map((t) => <li key={t.id} className="flex items-center justify-between gap-2"><span>{t.name} <span className="text-xs muted">· {t.scopes.join(', ')} · {t.last_used_at ? `used ${fmtDateTime(t.last_used_at, u.timezone)}` : 'never used'}</span></span><ApiButton path={`/me/tokens/${t.id}`} method="DELETE" className="btn btn-sm btn-danger">Revoke</ApiButton></li>)}</ul>
          <TokenCreator />
        </Section>
        <Section title="Connected services">
          <ul className="space-y-2 text-sm">
            {['Google Calendar', 'Outlook Calendar', 'Gmail forwarding', 'DigiLocker', 'Cloud storage'].map((n) => <li key={n} className="flex justify-between gap-2"><span>{n}</span><span className="chip">Not available in this version</span></li>)}
          </ul>
          <p className="mt-3 text-xs muted">LifeOS never asks for passwords to other services. Use .ics import/export for calendars, and share or forward items into LifeOS yourself.</p>
        </Section>
        <Section title="Feedback">
          <ApiForm path="/feedback" success="Thank you — sent." className="space-y-2">
            <select name="kind" className="field" aria-label="Kind"><option value="bug">Something is broken</option><option value="extraction_failure">A capture was read wrongly</option><option value="notification_problem">A reminder didn’t arrive</option><option value="confusing">Something was confusing</option><option value="feature_request">I’d like…</option></select>
            <textarea name="message" required className="field min-h-20" placeholder="What happened? Please don’t paste private document contents." aria-label="Message" />
            <button className="btn btn-sm">Send</button>
          </ApiForm>
        </Section>
      </div>
    </>
  );
}
