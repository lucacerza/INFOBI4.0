import { useState, useEffect } from 'react';
import { connectionsApi } from '../services/api';
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
      const response = await fetch('/api/connections/test-new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
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
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }
  
  // === VISTA LISTA ===
  if (viewMode === 'list') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Connessioni Database</h1>
            <p className="text-gray-500">{connections.length} connessioni configurate</p>
          </div>
          {connections.length > 0 && (
            <button
              onClick={handleCreate}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition"
            >
              <Plus className="w-5 h-5" />
              Nuova Connessione
            </button>
          )}
        </div>
        
        {connections.length === 0 ? (
          <div className="text-center py-16">
            <Server className="w-20 h-20 mx-auto mb-4 text-gray-200" />
            <h3 className="text-xl font-medium text-gray-600 mb-2">Nessuna connessione</h3>
            <p className="text-gray-400 mb-6">Configura la tua prima connessione al database</p>
            <button
              onClick={handleCreate}
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition"
            >
              <Plus className="w-5 h-5" />
              Nuova Connessione
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {connections.map(conn => (
              <div key={conn.id} className="bg-white rounded-xl p-4 border flex items-center gap-4 hover:shadow-md transition">
                <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <Database className="w-6 h-6 text-slate-600" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-gray-900">{conn.name}</h3>
                  <p className="text-sm text-gray-500 truncate">
                    <span className="inline-flex items-center px-1.5 py-0.5 bg-gray-100 rounded text-xs font-medium mr-2">
                      {conn.db_type.toUpperCase()}
                    </span>
                    {conn.host}:{conn.port} → {conn.database}
                    {conn.ssl_enabled && <span className="ml-2 text-green-600">🔒</span>}
                  </p>
                </div>
                
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleTestExisting(conn.id)}
                    disabled={testing === conn.id}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm hover:bg-blue-50 rounded-lg text-blue-600 transition disabled:opacity-50"
                    title="Test connessione"
                  >
                    {testing === conn.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <TestTube className="w-4 h-4" />
                    )}
                    <span className="hidden sm:inline">Test</span>
                  </button>
                  
                  <button
                    onClick={() => handleEdit(conn)}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm hover:bg-gray-100 rounded-lg text-gray-600 transition"
                    title="Modifica"
                  >
                    <Edit className="w-4 h-4" />
                    <span className="hidden sm:inline">Modifica</span>
                  </button>
                  
                  <button
                    onClick={() => handleDelete(conn.id)}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm hover:bg-red-50 rounded-lg text-red-500 transition"
                    title="Elimina"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span className="hidden sm:inline">Elimina</span>
                  </button>
                </div>
              </div>
            ))}
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
          className="p-2 hover:bg-gray-100 rounded-lg transition"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold">
          {viewMode === 'create' ? 'Nuova Connessione' : 'Modifica Connessione'}
        </h1>
      </div>
      
      <form onSubmit={handleSubmit} className="bg-white rounded-xl p-6 border space-y-5">
        {/* Nome e Tipo */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Nome connessione *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Es: Produzione SQL Server"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Tipo Database *</label>
            <select
              value={form.db_type}
              onChange={e => handleDbTypeChange(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
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
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="192.168.1.100 o host.docker.internal"
              required
            />
            <p className="text-xs text-gray-400 mt-1">
              Per SQL Server locale: <code className="bg-gray-100 px-1 rounded">host.docker.internal</code>
            </p>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Porta *</label>
            <input
              type="number"
              value={form.port}
              onChange={e => setForm({ ...form, port: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
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
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
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
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
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
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={form.ssl_enabled}
                onChange={e => setForm({ ...form, ssl_enabled: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
              />
              <span className="text-sm">Abilita SSL/TLS</span>
              <div className="relative">
                <Info className="w-4 h-4 text-gray-400" />
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
              ? 'bg-green-50 text-green-700 border border-green-200' 
              : 'bg-red-50 text-red-700 border border-red-200'
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
            className="flex items-center justify-center gap-2 px-4 py-2 border border-blue-500 text-blue-500 hover:bg-blue-50 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
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
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white rounded-lg transition"
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
