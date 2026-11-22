import { Suspense } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { SignupForm } from '@/components/auth-forms';

export const metadata = { title: 'Create your account', alternates: { canonical: '/signup' } };

export default function SignupPage() {
  return (
    <AuthShell title="Start free" subtitle="Tasks, reminders, calendar and capture are free. No card required.">
      <Suspense><SignupForm /></Suspense>
    </AuthShell>
  );
}
