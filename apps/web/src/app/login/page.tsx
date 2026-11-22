import { Suspense } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { LoginForm } from '@/components/auth-forms';

export const metadata = { title: 'Sign in', alternates: { canonical: '/login' } };

export default function LoginPage() {
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to LifeOS">
      <Suspense><LoginForm /></Suspense>
    </AuthShell>
  );
}
