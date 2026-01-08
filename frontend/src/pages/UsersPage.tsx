/**
 * UsersPage - Admin User Management
 * 
 * Features:
 * - Create/Edit/Delete users
 * - Assign reports and dashboards
 * - Role management (admin, editor, viewer)
 */
import { useState, useEffect } from 'react';
import { 
  Users, Plus, Edit, Trash2, Shield, Eye, FileText, 
  LayoutDashboard, Search, X, Check, Loader2, UserPlus 
} from 'lucide-react';

interface User {
  id: number;
  username: string;
  email: string | null;
  full_name: string | null;
  role: 'admin' | 'editor' | 'viewer';
  is_active: boolean;
  report_ids?: number[];
  dashboard_ids?: number[];
}

interface Report {
  id: number;
  name: string;
}

interface Dashboard {
  id: number;
  name: string;
}

const API_BASE = '/api';

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit' | 'assign'>('create');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);
  
  // Form state
  const [form, setForm] = useState({
    username: '',
    email: '',
    full_name: '',
    password: '',
    role: 'viewer' as 'admin' | 'editor' | 'viewer',
    is_active: true
  });
  
  // Assignment state
  const [assignedReports, setAssignedReports] = useState<number[]>([]);
  const [assignedDashboards, setAssignedDashboards] = useState<number[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const getToken = () => localStorage.getItem('token');

  const loadData = async () => {
    try {
      const headers = { 'Authorization': `Bearer ${getToken()}` };
      
      const [usersRes, reportsRes, dashboardsRes] = await Promise.all([
        fetch(`${API_BASE}/users`, { headers }),
        fetch(`${API_BASE}/reports`, { headers }),
        fetch(`${API_BASE}/dashboards`, { headers })
      ]);
      
      if (usersRes.ok) setUsers(await usersRes.json());
      if (reportsRes.ok) setReports(await reportsRes.json());
      if (dashboardsRes.ok) setDashboards(await dashboardsRes.json());
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setForm({
      username: '',
      email: '',
      full_name: '',
      password: '',
      role: 'viewer',
      is_active: true
    });
    setModalMode('create');
    setShowModal(true);
  };

  const openEditModal = async (user: User) => {
    setSelectedUser(user);
    setForm({
      username: user.username,
      email: user.email || '',
      full_name: user.full_name || '',
      password: '',
      role: user.role,
      is_active: user.is_active
    });
    setModalMode('edit');
    setShowModal(true);
  };

  const openAssignModal = async (user: User) => {
    setSelectedUser(user);
    
    // Load user's current assignments
    try {
      const res = await fetch(`${API_BASE}/users/${user.id}`, {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAssignedReports(data.report_ids || []);
        setAssignedDashboards(data.dashboard_ids || []);
      }
    } catch (err) {
      console.error(err);
    }
    
    setModalMode('assign');
    setShowModal(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const headers = {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      };
      
      if (modalMode === 'create') {
        const res = await fetch(`${API_BASE}/users`, {
          method: 'POST',
          headers,
          body: JSON.stringify(form)
        });
        if (!res.ok) {
          const err = await res.json();
          alert(err.detail || 'Errore nella creazione');
          return;
        }
      } else if (modalMode === 'edit' && selectedUser) {
        const updateData: any = { ...form };
        if (!updateData.password) delete updateData.password;
        delete updateData.username; // Can't change username
        
        const res = await fetch(`${API_BASE}/users/${selectedUser.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(updateData)
        });
        if (!res.ok) {
          const err = await res.json();
          alert(err.detail || 'Errore nella modifica');
          return;
        }
      } else if (modalMode === 'assign' && selectedUser) {
        // Save report assignments
        await fetch(`${API_BASE}/users/${selectedUser.id}/reports`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ report_ids: assignedReports, can_edit: false })
        });
        
        // Save dashboard assignments
        await fetch(`${API_BASE}/users/${selectedUser.id}/dashboards`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ dashboard_ids: assignedDashboards, can_edit: false })
        });
      }
      
      setShowModal(false);
      loadData();
    } catch (err) {
      console.error(err);
      alert('Errore nel salvataggio');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (user: User) => {
    if (!confirm(`Eliminare l'utente "${user.username}"?`)) return;
    
    try {
      await fetch(`${API_BASE}/users/${user.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const filteredUsers = users.filter(u => 
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  const roleColors = {
    admin: 'bg-red-100 text-red-700 border-red-200',
    editor: 'bg-blue-100 text-blue-700 border-blue-200',
    viewer: 'bg-gray-100 text-gray-700 border-gray-200'
  };

  const roleLabels = {
    admin: 'Amministratore',
    editor: 'Editor',
    viewer: 'Visualizzatore'
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Gestione Utenti</h1>
              <p className="text-sm text-slate-500">{users.length} utenti registrati</p>
            </div>
          </div>
          
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition shadow-sm"
          >
            <UserPlus className="w-4 h-4" />
            Nuovo Utente
          </button>
        </div>
        
        {/* Search */}
        <div className="mt-4 relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca utenti..."
            className="w-full pl-10 pr-4 py-2 border rounded-lg bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 transition"
          />
        </div>
      </div>
      
      {/* Users List */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-3">
          {filteredUsers.map(user => (
            <div 
              key={user.id}
              className="bg-white rounded-xl border p-4 hover:shadow-md transition"
            >
              <div className="flex items-center gap-4">
                {/* Avatar */}
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold text-lg">
                  {user.username.charAt(0).toUpperCase()}
                </div>
                
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-800">{user.username}</h3>
                    {!user.is_active && (
                      <span className="px-2 py-0.5 text-xs bg-red-100 text-red-600 rounded">
                        Disattivato
                      </span>
                    )}
                  </div>
                  {user.full_name && (
                    <p className="text-sm text-slate-600">{user.full_name}</p>
                  )}
                  {user.email && (
                    <p className="text-sm text-slate-400">{user.email}</p>
                  )}
                </div>
                
                {/* Role Badge */}
                <div className={`px-3 py-1 rounded-full text-sm font-medium border ${roleColors[user.role]}`}>
                  <div className="flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5" />
                    {roleLabels[user.role]}
                  </div>
                </div>
                
                {/* Actions */}
                <div className="flex items-center gap-1">
                  {user.role !== 'admin' && (
                    <button
                      onClick={() => openAssignModal(user)}
                      className="p-2 hover:bg-slate-100 rounded-lg transition"
                      title="Assegna Report/Dashboard"
                    >
                      <FileText className="w-4 h-4 text-slate-500" />
                    </button>
                  )}
                  <button
                    onClick={() => openEditModal(user)}
                    className="p-2 hover:bg-slate-100 rounded-lg transition"
                    title="Modifica"
                  >
                    <Edit className="w-4 h-4 text-slate-500" />
                  </button>
                  {user.username !== 'admin' && (
                    <button
                      onClick={() => handleDelete(user)}
                      className="p-2 hover:bg-red-50 rounded-lg transition"
                      title="Elimina"
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          
          {filteredUsers.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Nessun utente trovato</p>
            </div>
          )}
        </div>
      </div>
      
      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-semibold">
                {modalMode === 'create' && 'Nuovo Utente'}
                {modalMode === 'edit' && 'Modifica Utente'}
                {modalMode === 'assign' && `Assegnazioni - ${selectedUser?.username}`}
              </h2>
              <button 
                onClick={() => setShowModal(false)}
                className="p-2 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Modal Content */}
            <div className="p-6">
              {(modalMode === 'create' || modalMode === 'edit') && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Username *</label>
                    <input
                      type="text"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      disabled={modalMode === 'edit'}
                      className="w-full px-3 py-2 border rounded-lg disabled:bg-slate-100"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1">Nome Completo</label>
                    <input
                      type="text"
                      value={form.full_name}
                      onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1">Email</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Password {modalMode === 'edit' && '(lascia vuoto per non modificare)'}
                    </label>
                    <input
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                      required={modalMode === 'create'}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1">Ruolo</label>
                    <select
                      value={form.role}
                      onChange={(e) => setForm({ ...form, role: e.target.value as any })}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      <option value="viewer">Visualizzatore (solo lettura)</option>
                      <option value="editor">Editor (può modificare)</option>
                      <option value="admin">Amministratore (accesso completo)</option>
                    </select>
                  </div>
                  
                  {modalMode === 'edit' && (
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.is_active}
                        onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                        className="w-4 h-4 rounded"
                      />
                      <span>Utente attivo</span>
                    </label>
                  )}
                </div>
              )}
              
              {modalMode === 'assign' && (
                <div className="space-y-6">
                  {/* Reports */}
                  <div>
                    <h3 className="font-medium flex items-center gap-2 mb-3">
                      <FileText className="w-4 h-4 text-blue-500" />
                      Report Assegnati
                    </h3>
                    <div className="space-y-2 max-h-48 overflow-auto">
                      {reports.map(report => (
                        <label 
                          key={report.id}
                          className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition ${
                            assignedReports.includes(report.id)
                              ? 'bg-blue-50 border border-blue-200'
                              : 'bg-slate-50 hover:bg-slate-100'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={assignedReports.includes(report.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setAssignedReports([...assignedReports, report.id]);
                              } else {
                                setAssignedReports(assignedReports.filter(id => id !== report.id));
                              }
                            }}
                            className="w-4 h-4 rounded"
                          />
                          <span>{report.name}</span>
                        </label>
                      ))}
                      {reports.length === 0 && (
                        <p className="text-slate-400 text-sm">Nessun report disponibile</p>
                      )}
                    </div>
                  </div>
                  
                  {/* Dashboards */}
                  <div>
                    <h3 className="font-medium flex items-center gap-2 mb-3">
                      <LayoutDashboard className="w-4 h-4 text-purple-500" />
                      Dashboard Assegnate
                    </h3>
                    <div className="space-y-2 max-h-48 overflow-auto">
                      {dashboards.map(dashboard => (
                        <label 
                          key={dashboard.id}
                          className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition ${
                            assignedDashboards.includes(dashboard.id)
                              ? 'bg-purple-50 border border-purple-200'
                              : 'bg-slate-50 hover:bg-slate-100'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={assignedDashboards.includes(dashboard.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setAssignedDashboards([...assignedDashboards, dashboard.id]);
                              } else {
                                setAssignedDashboards(assignedDashboards.filter(id => id !== dashboard.id));
                              }
                            }}
                            className="w-4 h-4 rounded"
                          />
                          <span>{dashboard.name}</span>
                        </label>
                      ))}
                      {dashboards.length === 0 && (
                        <p className="text-slate-400 text-sm">Nessuna dashboard disponibile</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            {/* Modal Footer */}
            <div className="flex justify-end gap-3 p-6 border-t bg-slate-50">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg transition"
              >
                Annulla
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Salva
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
