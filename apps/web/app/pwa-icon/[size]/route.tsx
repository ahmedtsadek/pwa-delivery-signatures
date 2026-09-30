import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size: rawSize } = await params;
  const requested = Number(rawSize);
  const size = [180, 192, 512].includes(requested) ? requested : 192;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: size * 0.22,
          background: 'linear-gradient(135deg,#0B3D91 0%,#087CC4 50%,#00C7D9 100%)',
          overflow: 'hidden'
        }}
      >
        <div style={{
          position: 'absolute', left: '13%', bottom: '24%', width: '76%', height: '10%',
          border: `${Math.max(5, size * 0.035)}px solid #70F2FF`, borderLeft: 0, borderRight: 0,
          borderRadius: 999, transform: 'rotate(-8deg)', opacity: 0.8
        }} />
        <div style={{
          display: 'flex', position: 'relative', width: '48%', height: '48%',
          background: '#FFFFFF', borderRadius: size * 0.07, alignItems: 'center',
          justifyContent: 'center', boxShadow: `0 ${size * 0.04}px ${size * 0.08}px rgba(3,29,79,.35)`
        }}>
          <div style={{
            display: 'flex', width: '48%', height: '48%', background: '#0A7DE8',
            borderRadius: size * 0.04, alignItems: 'center', justifyContent: 'center',
            color: '#FFFFFF', fontSize: size * 0.25, fontWeight: 900, lineHeight: 1
          }}>+</div>
        </div>
        <div style={{
          position: 'absolute', right: '12%', top: '13%', display: 'flex',
          width: '23%', height: '23%', background: '#65F3F8', borderRadius: '50% 50% 50% 8%',
          transform: 'rotate(-45deg)', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 ${size * 0.025}px ${size * 0.05}px rgba(3,29,79,.25)`
        }}>
          <div style={{width:'38%',height:'38%',borderRadius:'50%',background:'#0871C6'}} />
        </div>
      </div>
    ),
    {
      width: size,
      height: size,
      headers: {
        'Cache-Control': 'public, max-age=86400, immutable'
      }
    }
  );
}
