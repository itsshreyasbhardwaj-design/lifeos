import { ImageResponse } from 'next/og';

export const alt = 'LifeOS — Never Forget What Matters';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OG() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 80, background: '#0b1220', color: '#fafaf9' }}>
        <div style={{ fontSize: 34, color: '#3b82f6', fontWeight: 700 }}>LifeOS</div>
        <div style={{ fontSize: 84, fontWeight: 800, marginTop: 20, lineHeight: 1.05 }}>Never forget what matters.</div>
        <div style={{ fontSize: 32, marginTop: 28, color: '#94a3b8' }}>Capture it. Confirm it. Get reminded. Get it done.</div>
      </div>
    ),
    size,
  );
}
