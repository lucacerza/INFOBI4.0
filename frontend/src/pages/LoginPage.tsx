import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Loader2, AlertCircle } from 'lucide-react';

const glassInput: React.CSSProperties = {
  width: '100%', padding: '13px 15px', border: '1px solid rgba(255,255,255,.12)',
  borderRadius: 13, fontSize: '14.5px', fontFamily: 'inherit',
  background: 'rgba(255,255,255,.04)', color: '#ECEDF2', outline: 'none',
  transition: 'border-color .15s, box-shadow .15s',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '12.5px', fontWeight: 600, color: '#B8BBC6', marginBottom: 7,
};

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/dashboards');
    } catch (err: any) {
      setError(err?.message || 'Credenziali non valide');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ height: '100vh', width: '100%', overflow: 'hidden', position: 'relative', background: '#07080C', color: '#ECEDF2' }}>
      {/* Aurora atmosphere */}
      <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: -220, left: -120, width: 680, height: 680, borderRadius: '50%', background: 'radial-gradient(circle, rgba(123,108,245,.40), transparent 62%)', filter: 'blur(36px)' }} />
        <div style={{ position: 'absolute', bottom: -260, right: -100, width: 640, height: 640, borderRadius: '50%', background: 'radial-gradient(circle, rgba(79,227,193,.26), transparent 62%)', filter: 'blur(40px)' }} />
        <div style={{ position: 'absolute', top: '30%', right: '24%', width: 360, height: 360, borderRadius: '50%', background: 'radial-gradient(circle, rgba(245,113,176,.16), transparent 60%)', filter: 'blur(44px)' }} />
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(255,255,255,.035) 1px, transparent 1px)', backgroundSize: '26px 26px' }} />
      </div>

      <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <div style={{ width: '100%', maxWidth: 420 }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 30 }}>
            <div style={{ width: 46, height: 46, borderRadius: 14, background: 'linear-gradient(140deg,#7B6CF5,#4FE3C1)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 30px -8px rgba(123,108,245,.7)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /><circle cx="12" cy="12" r="3.2" /></svg>
            </div>
            <div>
              <div className="font-disp" style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1 }}>INFOBI <span style={{ background: 'linear-gradient(90deg,#A99BFF,#4FE3C1)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Pulse</span></div>
              <div style={{ fontSize: 12, color: '#7E8290', fontWeight: 500, marginTop: 3 }}>Intelligence aziendale potenziata dall'AI</div>
            </div>
          </div>

          {/* Card */}
          <form onSubmit={handleSubmit} style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)', borderRadius: 22, padding: 30, backdropFilter: 'blur(20px)', boxShadow: '0 30px 80px -30px rgba(0,0,0,.8)' }}>
            <h1 className="font-disp" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.025em', margin: '0 0 6px' }}>Bentornato</h1>
            <p style={{ color: '#9598A6', margin: '0 0 26px', fontSize: 14 }}>Accedi per parlare con i tuoi dati.</p>

            {error && (
              <div style={{ marginBottom: 18, padding: '11px 14px', background: 'rgba(245,113,176,.1)', border: '1px solid rgba(245,113,176,.3)', borderRadius: 12, color: '#F571B0', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <label style={labelStyle}>Username</label>
            <input
              className="pulse-input" type="text" value={username} onChange={(e) => setUsername(e.target.value)}
              placeholder="Inserisci username" autoFocus required
              style={{ ...glassInput, marginBottom: 16 }}
            />

            <label style={labelStyle}>Password</label>
            <input
              className="pulse-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" required
              style={{ ...glassInput, marginBottom: 22 }}
            />

            <button
              type="submit" disabled={loading}
              style={{ width: '100%', padding: 14, border: 'none', borderRadius: 13, background: 'linear-gradient(100deg,#7B6CF5,#6A8DF5)', color: '#fff', fontSize: 15, fontWeight: 600, fontFamily: 'inherit', cursor: loading ? 'default' : 'pointer', boxShadow: '0 12px 30px -10px rgba(123,108,245,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, opacity: loading ? 0.65 : 1 }}
            >
              {loading ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Accesso in corso...</>
              ) : (
                <>Entra in Pulse <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
