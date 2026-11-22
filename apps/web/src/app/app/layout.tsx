import { Shell } from '@/components/shell';
import { requireSession } from '@/server/session';
import { messages } from '@/i18n/messages';
import { billingState, plans } from '@lifeos/core/billing';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const plan = plans()[(await billingState(s.ctx.db, s.user.id)).plan].name;
  return (
    <div lang={s.user.locale.split('-')[0]}>
      <Shell userName={s.user.display_name} plan={plan} spaces={s.spaces} activeId={s.active.workspaceId} tr={messages(s.user.locale)}>
        {children}
      </Shell>
    </div>
  );
}
