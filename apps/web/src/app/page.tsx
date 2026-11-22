import { count } from '@/lib/spike';
export const dynamic = 'force-dynamic';
export default async function Page() {
  return <p>users: {await count()}</p>;
}
