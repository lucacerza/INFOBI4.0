/**
 * UsersPage - Admin User Management
 *
 * Features:
 * - Create/Edit/Delete users
 * - Assign reports and dashboards
 * - Role management (superuser, admin, user)
 *
 * Regole di sicurezza:
 * - infostudio (is_system_account=true) non può essere eliminato da nessuno
 * - Nessun utente può eliminare se stesso
 * - Admin può gestire solo utenti con ruolo 'user'
 */
import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import {
  Users, Plus, Edit, Trash2, Shield, Eye, FileText,
  LayoutDashboard, Search, X, Check, Loader2, UserPlus,
  ShieldAlert, ShieldCheck
} from 'lucide-react';
import { toast } from '../stores/toastStore';

interface User {
  id: number;
  username: string;
  email: string | null;
  full_name: string | null;
  role: 'superuser' | 'admin' | 'user';
  is_active: boolean;
  is_system_account?: boolean;  // true per infostudio
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
  const { user: currentUser } = useAuthStore();
  const [users, setUsers] = useState<User[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Logica permessi
  const isSuperuser = currentUser?.role === 'superuser';
  
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
    role: 'user' as 'superuser' | 'admin' | 'user',
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
      toast.error('Errore caricamento dati');
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
      role: 'user',
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
      toast.error('Errore caricamento assegnazioni');
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

        // Non inviare role e is_active se sono disabilitati (account sistema o se stessi)
        const isRoleDisabled = selectedUser.is_system_account || selectedUser.id === currentUser?.id;
        if (isRoleDisabled) {
          delete updateData.role;
          delete updateData.is_active;
        }

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
      
      toast.success('Salvato con successo');
      setShowModal(false);
      loadData();
    } catch (err) {
      toast.error('Errore nel salvataggio');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (user: User) => {
    if (!confirm(`Eliminare l'utente "${user.username}"?`)) return;

    try {
      const res = await fetch(`${API_BASE}/users/${user.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.detail || 'Errore durante l\'eliminazione');
        return;
      }
      toast.success('Utente eliminato');
      loadData();
    } catch (err) {
      toast.error('Errore durante l\'eliminazione');
    }
  };

  // Determina se l'utente può essere eliminato
  const canDeleteUser = (user: User): boolean => {
    // Account di sistema (infostudio) non può essere eliminato
    if (user.is_system_account) return false;
    // Non puoi eliminare te stesso
    if (user.id === currentUser?.id) return false;
    // Admin può eliminare solo utenti 'user'
    if (currentUser?.role === 'admin' && user.role !== 'user') return false;
    return true;
  };

  // Determina se l'utente può essere modificato
  const canEditUser = (user: User): boolean => {
    // Account di sistema (infostudio) può essere modificato SOLO da se stesso
    if (user.is_system_account) {
      return user.id === currentUser?.id;
    }
    // Admin può modificare solo utenti 'user' o se stesso
    if (currentUser?.role === 'admin' && user.role !== 'user' && user.id !== currentUser?.id) {
      return false;
    }
    return true;
  };

  const filteredUsers = users.filter(u => 
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  const roleColors: Record<string, string> = {
    superuser: 'bg-purple-100 text-purple-700 border-purple-200',
    admin: 'bg-red-100 text-red-700 border-red-200',
    user: 'bg-gray-100 text-gray-700 border-gray-200'
  };

  const roleLabels: Record<string, string> = {
    superuser: 'Superuser',
    admin: 'Amministratore',
    user: 'Utente'
  };

  const roleIcons: Record<string, React.ElementType> = {
    superuser: ShieldAlert,
    admin: ShieldCheck,
    user: Shield
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
                <div className={`px-3 py-1 rounded-full text-sm font-medium border ${roleColors[user.role] || roleColors.user}`}>
                  <div className="flex items-center gap-1.5">
                    {(() => {
                      const RoleIcon = roleIcons[user.role] || Shield;
                      return <RoleIcon className="w-3.5 h-3.5" />;
                    })()}
                    {roleLabels[user.role] || user.role}
                    {user.is_system_account && (
                      <span className="ml-1 text-xs opacity-60">(sistema)</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  {/* Assegna - solo per utenti non-admin/non-superuser */}
                  {user.role === 'user' && (
                    <button
                      onClick={() => openAssignModal(user)}
                      className="p-2 hover:bg-slate-100 rounded-lg transition"
                      title="Assegna Report/Dashboard"
                    >
                      <FileText className="w-4 h-4 text-slate-500" />
                    </button>
                  )}
                  {/* Modifica */}
                  {canEditUser(user) && (
                    <button
                      onClick={() => openEditModal(user)}
                      className="p-2 hover:bg-slate-100 rounded-lg transition"
                      title="Modifica"
                    >
                      <Edit className="w-4 h-4 text-slate-500" />
                    </button>
                  )}
                  {/* Elimina - nascosto per account sistema e per se stessi */}
                  {canDeleteUser(user) && (
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
                  
                  {/* Ruolo - disabilitato per account sistema o se stessi */}
                  <div>
                    <label className="block text-sm font-medium mb-1">Ruolo</label>
                    {(() => {
                      const isRoleDisabled = modalMode === 'edit' && (selectedUser?.is_system_account || selectedUser?.id === currentUser?.id);
                      // In edit mode con campo disabilitato, mostra tutte le opzioni per visualizzare il valore corrente
                      // In create mode o edit con campo abilitato, mostra solo le opzioni che l'utente può selezionare
                      const showAllOptions = isRoleDisabled || isSuperuser;

                      return (
                        <select
                          value={form.role}
                          onChange={(e) => setForm({ ...form, role: e.target.value as any })}
                          disabled={isRoleDisabled}
                          aria-label="Ruolo utente"
                          className="w-full px-3 py-2 border rounded-lg disabled:bg-slate-100 disabled:cursor-not-allowed"
                        >
                          <option value="user">Utente (visualizza dashboard assegnate)</option>
                          {showAllOptions && (
                            <>
                              <option value="admin">Amministratore (gestisce dashboard e utenti)</option>
                              <option value="superuser">Superuser (accesso completo)</option>
                            </>
                          )}
                        </select>
                      );
                    })()}
                    {modalMode === 'edit' && selectedUser?.is_system_account && (
                      <p className="text-xs text-amber-600 mt-1">Il ruolo dell'account di sistema non può essere modificato</p>
                    )}
                    {modalMode === 'edit' && !selectedUser?.is_system_account && selectedUser?.id === currentUser?.id && (
                      <p className="text-xs text-slate-500 mt-1">Non puoi modificare il tuo ruolo</p>
                    )}
                  </div>

                  {/* Utente attivo - disabilitato per account sistema o se stessi */}
                  {modalMode === 'edit' && (
                    <div>
                      <label className={`flex items-center gap-2 ${(selectedUser?.is_system_account || selectedUser?.id === currentUser?.id) ? 'opacity-50 cursor-not-allowed' : ''}`}>
                        <input
                          type="checkbox"
                          checked={form.is_active}
                          onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                          disabled={selectedUser?.is_system_account || selectedUser?.id === currentUser?.id}
                          className="w-4 h-4 rounded disabled:cursor-not-allowed"
                        />
                        <span>Utente attivo</span>
                      </label>
                      {selectedUser?.is_system_account && (
                        <p className="text-xs text-amber-600 mt-1">Lo stato dell'account di sistema non può essere modificato</p>
                      )}
                    </div>
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
