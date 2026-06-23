import { useState, useEffect } from 'react';
import { connectionsApi } from '../services/api';
import { apiFetch } from '../services/apiClient';
import { 
  Database, Plus, Trash2, Edit, Loader2, 
  Server, TestTube, CheckCircle, XCircle, Info, ArrowLeft
} from 'lucide-react';

interface Connection {
  id: number;
  name: string;
  db_type: string;
  host: string;
  port: number;
  database: string;
  username: string;
  ssl_enabled: boolean;
}

const DB_TYPES = [
  { value: 'mssql', label: 'SQL Server', defaultPort: 1433 },
  { value: 'postgresql', label: 'PostgreSQL', defaultPort: 5432 },
  { value: 'mysql', label: 'MySQL', defaultPort: 3306 }
];

// Stile badge per tipo DB (palette Pulse)
const DB_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  mssql: { label: 'SQL SERVER', color: '#F5A65B', bg: 'rgba(245,166,91,.14)' },
  postgresql: { label: 'POSTGRESQL', color: '#6BD9E8', bg: 'rgba(107,217,232,.14)' },
  mysql: { label: 'MYSQL', color: '#4FE3C1', bg: 'rgba(79,227,193,.14)' },
};

const GRADIENT_BTN = 'linear-gradient(100deg,#7B6CF5,#6A8DF5)';

type ViewMode = 'list' | 'create' | 'edit';

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingForm, setTestingForm] = useState(false);
  
  const [form, setForm] = useState({
    name: '',
    db_type: 'mssql',
    host: '',
    port: 1433,
    database: '',
    username: '',
    password: '',
    ssl_enabled: false
  });
  
  useEffect(() => {
    loadConnections();
  }, []);
  
  const loadConnections = async () => {
    try {
      const data = await connectionsApi.list();
      setConnections(data);
    } finally {
      setLoading(false);
    }
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingId) {
        await connectionsApi.update(editingId, form);
      } else {
        await connectionsApi.create(form);
      }
      await loadConnections();
      backToList();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Errore nel salvataggio');
    } finally {
      setSaving(false);
    }
  };
  
  const handleEdit = (conn: Connection) => {
    setForm({
      name: conn.name,
      db_type: conn.db_type,
      host: conn.host,
      port: conn.port,
      database: conn.database,
      username: conn.username,
      password: '',
      ssl_enabled: conn.ssl_enabled
    });
    setEditingId(conn.id);
    setTestResult(null);
    setViewMode('edit');
  };
  
  const handleCreate = () => {
    resetForm();
    setViewMode('create');
  };
  
  const handleDelete = async (id: number) => {
    if (!confirm('Eliminare questa connessione?\nI report associati non funzioneranno più.')) return;
    try {
      await connectionsApi.delete(id);
      loadConnections();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Errore nella cancellazione');
    }
  };
  
  // Test connessione esistente (dalla lista)
  const handleTestExisting = async (id: number) => {
    setTesting(id);
    try {
      const result = await connectionsApi.test(id);
      alert(result.success ? '✅ Connessione riuscita!' : `❌ Errore: ${result.message}`);
    } catch (err: any) {
      alert(`❌ Errore: ${err.response?.data?.detail || 'Connessione fallita'}`);
    } finally {
      setTesting(null);
    }
  };
  
  // Test connessione dal form (PRIMA di salvare)
  const handleTestForm = async () => {
    if (!form.host || !form.database || !form.username || !form.password) {
      alert('Compila tutti i campi obbligatori prima di testare');
      return;
    }
    
    setTestingForm(true);
    setTestResult(null);
    
    try {
      const response = await apiFetch('/api/connections/test-new', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setTestResult({ success: true, message: 'Connessione riuscita!' });
      } else {
        setTestResult({ success: false, message: data.detail || 'Connessione fallita' });
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || 'Errore di rete' });
    } finally {
      setTestingForm(false);
    }
  };
  
  const resetForm = () => {
    setForm({
      name: '',
      db_type: 'mssql',
      host: '',
      port: 1433,
      database: '',
      username: '',
      password: '',
      ssl_enabled: false
    });
    setEditingId(null);
    setTestResult(null);
  };
  
  const backToList = () => {
    resetForm();
    setViewMode('list');
  };
  
  const handleDbTypeChange = (type: string) => {
    const dbType = DB_TYPES.find(t => t.value === type);
    setForm({ 
      ...form, 
      db_type: type,
      port: dbType?.defaultPort || 1433
    });
  };
  
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }
  
  // === VISTA LISTA ===
  if (viewMode === 'list') {
    return (
      <div className="p-6 lg:p-8 max-w-5xl mx-auto">
        <div className="flex items-end justify-between gap-4 mb-6">
          <div>
            <h1 className="font-disp text-[26px] font-bold tracking-tight">Sorgenti dati</h1>
            <p className="text-muted text-sm mt-1">
              {connections.length} {connections.length === 1 ? 'sorgente connessa' : 'sorgenti connesse'}
            </p>
          </div>
          {connections.length > 0 && (
            <button onClick={handleCreate}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm font-semibold transition hover:brightness-110"
              style={{ background: GRADIENT_BTN }}>
              <Plus className="w-4 h-4" /> Nuova connessione
            </button>
          )}
        </div>

        {connections.length === 0 ? (
          <div className="rounded-2xl border border-line bg-surface py-16 text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(123,108,245,.14)', color: '#A99BFF' }}>
              <Database className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Nessuna sorgente</h3>
            <p className="text-muted text-sm mb-6">Collega il tuo primo database per iniziare.</p>
            <button onClick={handleCreate}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold hover:brightness-110"
              style={{ background: GRADIENT_BTN }}>
              <Plus className="w-4 h-4" /> Nuova connessione
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {connections.map(conn => {
              const s = DB_STYLE[conn.db_type] || DB_STYLE.mssql;
              return (
                <div key={conn.id} className="bg-surface border border-line rounded-2xl p-4 flex items-center gap-4 transition hover:border-accent">
                  <div className="w-[46px] h-[46px] flex-none rounded-xl flex items-center justify-center" style={{ background: s.bg, color: s.color }}>
                    <Database className="w-[22px] h-[22px]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h3 className="font-semibold text-ink">{conn.name}</h3>
                      <span className="text-[10px] font-bold tracking-wide rounded px-2 py-0.5" style={{ color: s.color, background: s.bg }}>{s.label}</span>
                      {conn.ssl_enabled && <span className="text-[11px] font-semibold text-pos">SSL</span>}
                    </div>
                    <p className="num text-xs text-muted mt-1 truncate">{conn.host}:{conn.port} → {conn.database}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-none">
                    <button onClick={() => handleTestExisting(conn.id)} disabled={testing === conn.id}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-accent-strong border border-line hover:bg-accent-soft transition disabled:opacity-50" title="Test connessione">
                      {testing === conn.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TestTube className="w-3.5 h-3.5" />}
                      <span className="hidden sm:inline">Test</span>
                    </button>
                    <button onClick={() => handleEdit(conn)} className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:bg-ground hover:text-ink transition" title="Modifica"><Edit className="w-4 h-4" /></button>
                    <button onClick={() => handleDelete(conn.id)} className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-neg hover:bg-ground transition" title="Elimina"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }
  
  // === VISTA FORM (CREATE / EDIT) ===
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={backToList}
          className="p-2 hover:bg-ground rounded-lg transition"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold">
          {viewMode === 'create' ? 'Nuova Connessione' : 'Modifica Connessione'}
        </h1>
      </div>
      
      <form onSubmit={handleSubmit} className="bg-surface rounded-xl p-6 border space-y-5">
        {/* Nome e Tipo */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Nome connessione *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-accent focus:border-accent"
              placeholder="Es: Produzione SQL Server"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Tipo Database *</label>
            <select
              value={form.db_type}
              onChange={e => handleDbTypeChange(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-accent"
            >
              {DB_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>
        
        {/* Host e Porta */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Host / IP *</label>
            <input
              type="text"
              value={form.host}
              onChange={e => setForm({ ...form, host: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-accent"
              placeholder="192.168.1.100 o host.docker.internal"
              required
            />
            <p className="text-xs text-muted mt-1">
              Per SQL Server locale: <code className="bg-ground px-1 rounded">host.docker.internal</code>
            </p>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Porta *</label>
            <input
              type="number"
              value={form.port}
              onChange={e => setForm({ ...form, port: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-accent"
              required
            />
          </div>
        </div>
        
        {/* Database e Username */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Nome Database *</label>
            <input
              type="text"
              value={form.database}
              onChange={e => setForm({ ...form, database: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-accent"
              placeholder="nome_database"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Username *</label>
            <input
              type="text"
              value={form.username}
              onChange={e => setForm({ ...form, username: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-accent"
              placeholder="sa"
              required
            />
          </div>
        </div>
        
        {/* Password e SSL */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Password *
            </label>
            <input
              type="password"
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-accent"
              required
            />
          </div>
          
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={form.ssl_enabled}
                onChange={e => setForm({ ...form, ssl_enabled: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-accent focus:ring-accent"
              />
              <span className="text-sm">Abilita SSL/TLS</span>
              <div className="relative">
                <Info className="w-4 h-4 text-muted" />
                <div className="absolute left-6 bottom-0 w-56 p-2 bg-gray-800 text-white text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition z-10">
                  Attiva per connessioni sicure (Azure SQL, cloud, ecc.)
                </div>
              </div>
            </label>
          </div>
        </div>
        
        {/* Test Result */}
        {testResult && (
          <div className={`p-3 rounded-lg flex items-center gap-2 ${
            testResult.success 
              ? 'bg-green-50 text-pos border border-green-200' 
              : 'bg-red-50 text-neg border border-red-200'
          }`}>
            {testResult.success ? (
              <CheckCircle className="w-5 h-5 flex-shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 flex-shrink-0" />
            )}
            <span>{testResult.message}</span>
          </div>
        )}
        
        {/* Buttons */}
        <div className="flex flex-col sm:flex-row justify-between gap-3 pt-4 border-t">
          <button
            type="button"
            onClick={handleTestForm}
            disabled={testingForm || !form.host || !form.database || !form.username || !form.password}
            className="flex items-center justify-center gap-2 px-4 py-2 border border-accent text-accent hover:bg-accent-soft rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testingForm ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <TestTube className="w-4 h-4" />
            )}
            Testa Connessione
          </button>
          
          <div className="flex gap-2">
            <button
              type="button"
              onClick={backToList}
              className="px-4 py-2 text-muted hover:bg-ground rounded-lg transition"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2 bg-accent hover:bg-accent disabled:opacity-50 text-white rounded-lg transition"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {viewMode === 'create' ? 'Crea Connessione' : 'Salva Modifiche'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
