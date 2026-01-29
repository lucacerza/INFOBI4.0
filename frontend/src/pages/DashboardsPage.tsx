import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { dashboardsApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { LayoutDashboard, Plus, Loader2, Trash2 } from 'lucide-react';
import { toast } from '../stores/toastStore';

export default function DashboardsPage() {
  const [dashboards, setDashboards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'superuser';
  
  useEffect(() => {
    loadDashboards();
  }, []);
  
  const loadDashboards = async () => {
    try {
      const data = await dashboardsApi.list();
      setDashboards(data);
    } finally {
      setLoading(false);
    }
  };
  
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await dashboardsApi.create({ name });
      toast.success('Dashboard creata');
      setName('');
      setShowForm(false);
      loadDashboards();
    } catch (err) {
      toast.error('Errore creazione dashboard');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Eliminare questa dashboard?')) return;
    try {
      await dashboardsApi.delete(id);
      toast.success('Dashboard eliminata');
      loadDashboards();
    } catch (err) {
      toast.error('Errore eliminazione dashboard');
    }
  };
  
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }
  
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-gray-500">{dashboards.length} dashboard</p>
        </div>
        
        {isAdmin && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg"
          >
            <Plus className="w-5 h-5" />
            Nuova Dashboard
          </button>
        )}
      </div>
      
      {showForm && (
        <div className="bg-white rounded-xl p-6 border mb-6">
          <form onSubmit={handleCreate} className="flex gap-4">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Nome dashboard"
              className="flex-1 px-3 py-2 border rounded-lg"
              required
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              Annulla
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg"
            >
              Crea
            </button>
          </form>
        </div>
      )}
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {dashboards.map(d => (
          <div key={d.id} className="bg-white rounded-xl border p-5 group">
            <Link to={`/dashboards/${d.id}`} className="block">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center">
                  <LayoutDashboard className="w-5 h-5" />
                </div>
                <h3 className="font-semibold group-hover:text-blue-600 transition">
                  {d.name}
                </h3>
              </div>
              <p className="text-sm text-gray-500">
                {d.widgets?.length || 0} widget
              </p>
            </Link>
            
            {isAdmin && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  handleDelete(d.id);
                }}
                className="mt-3 text-sm text-red-500 hover:text-red-600 flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Elimina
              </button>
            )}
          </div>
        ))}
        
        {dashboards.length === 0 && (
          <div className="col-span-full text-center py-12 text-gray-500">
            <LayoutDashboard className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>Nessuna dashboard</p>
          </div>
        )}
      </div>
    </div>
  );
}
