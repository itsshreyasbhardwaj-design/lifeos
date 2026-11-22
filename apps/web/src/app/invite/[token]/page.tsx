import Link from 'next/link';
import { getDb } from '@/server/runtime';
import { readSession } from '@/server/session';
import { invitationInfo } from '@lifeos/core/family';
import { AuthShell } from '@/components/auth-shell';
import { ApiButton, ToastProvider } from '@/components/api';

export const metadata = { title: 'Invitation', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await invitationInfo(await getDb(), token);
  const s = await readSession();
  if (!info || info.revoked_at) return <AuthShell title="Invitation not found" subtitle="It may have been revoked. Ask for a new link."><Link href="/" className="btn w-full">Go home</Link></AuthShell>;
  const expired = new Date(info.expires_at).getTime() < Date.now();
  return (
    <ToastProvider>
      <AuthShell title={`Join ${info.workspace_name}`} subtitle={`${info.inviter ?? 'Someone'} invited you as ${info.role === 'limited' ? 'a limited member' : `${info.role === 'adult' ? 'an adult' : 'a member'}`}.`}>
        {info.accepted_at ? <p className="text-center text-sm">This invitation was already used.</p> : expired ? <p className="text-center text-sm">This invitation has expired. Ask for a new one.</p> : s ? (
          <div className="space-y-3">
            <p className="text-sm muted">Signed in as {s.user.email}. Joining gives you access to what is in this family space. Your personal records stay private.</p>
            <ApiButton path="/invites/accept" body={{ token }} className="btn btn-primary w-full" redirectTo="/app/family">Join</ApiButton>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm muted">Sign in or create an account with the email address the invitation was sent to.</p>
            <Link href={`/signup?next=${encodeURIComponent(`/invite/${token}`)}`} className="btn btn-primary w-full">Create account</Link>
            <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className="btn w-full">Sign in</Link>
          </div>
        )}
      </AuthShell>
    </ToastProvider>
  );
}
