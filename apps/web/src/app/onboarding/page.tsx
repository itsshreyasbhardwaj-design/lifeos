import { requireSession } from '@/server/session';
import { OnboardingFlow } from '@/components/onboarding';
import { ToastProvider } from '@/components/api';

export const metadata = { title: 'Get started' };
export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const s = await requireSession();
  return (
    <ToastProvider>
      <main className="mx-auto max-w-2xl px-4 py-10">
        <OnboardingFlow name={s.user.display_name.split(' ')[0]!} />
      </main>
    </ToastProvider>
  );
}
