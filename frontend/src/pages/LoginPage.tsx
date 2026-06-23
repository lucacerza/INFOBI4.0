import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Loader2, AlertCircle } from 'lucide-react';

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
      navigate('/reports');
    } catch (err: any) {
      setError(err?.message || 'Credenziali non valide');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center text-white text-2xl font-bold">
              I
            </div>
            <span className="text-3xl font-bold text-white">INFOBI</span>
          </div>
          <p className="text-muted">Business Intelligence 4.0</p>
        </div>
        
        {/* Login card */}
        <div className="bg-surface rounded-2xl shadow-2xl p-8">
          <h2 className="text-2xl font-semibold text-ink mb-6">Accedi</h2>
          
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-neg text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 border border-line rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent transition"
                placeholder="Inserisci username"
                required
                autoFocus
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-line rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent transition"
                placeholder="Inserisci password"
                required
              />
            </div>
            
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-accent hover:bg-accent disabled:opacity-50 text-white font-medium rounded-lg transition flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Accesso in corso...
                </>
              ) : (
                'Accedi'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
