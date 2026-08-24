import React, { useState, useEffect, useCallback } from 'react';
import api, { isOk } from './api';
import { Home, Users, KeyRound, ShieldCheck, Check, AlertCircle, Loader2, UserPlus, Trash2, X, Eye, EyeOff } from 'lucide-react';

const ROLE_LABELS = {
  operador: 'Operador',
  supervisor: 'Supervisor',
  administrador: 'Administrador'
};

const ROLE_OPTIONS = ['operador', 'supervisor', 'administrador'];

const NEW_USER_DEFAULT = { username: '', password: '', confirmPassword: '', role: 'operador' };

// Tela restrita a administradores: lista todos os usuários cadastrados no
// PostgreSQL, permite criar e excluir usuários, redefinir a senha de
// qualquer um (nunca "ver" a senha existente — ela é salva como hash
// bcrypt, irreversível por design) e alterar o perfil de acesso de cada
// usuário.
export default function UserManagementView({ onBack, currentUser }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Perfil selecionado (ainda não salvo) por usuário, enquanto o usuário mexe no <select>.
  const [pendingRoles, setPendingRoles] = useState({});
  const [savingRoleId, setSavingRoleId] = useState(null);

  // Controle do formulário de redefinição de senha (um usuário por vez).
  const [resetOpenId, setResetOpenId] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Controle da exclusão (pede uma segunda confirmação antes de excluir de verdade).
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // Controle do formulário de criação de novo usuário.
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newUser, setNewUser] = useState(NEW_USER_DEFAULT);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [showCreateConfirm, setShowCreateConfirm] = useState(false);

  // Mensagem de sucesso/erro por linha (some sozinha depois de alguns segundos).
  const [rowMessages, setRowMessages] = useState({});

  const showRowMessage = (userId, type, text) => {
    setRowMessages((prev) => ({ ...prev, [userId]: { type, text } }));
    setTimeout(() => {
      setRowMessages((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    }, 4000);
  };

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await api.get('/api/auth/users');
      if (isOk(res)) {
        setUsers(Array.isArray(res.data) ? res.data : []);
      } else {
        setLoadError(res.data?.error || 'Não foi possível carregar a lista de usuários.');
      }
    } catch (err) {
      setLoadError('Erro de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleRoleChange = (userId, role) => {
    setPendingRoles((prev) => ({ ...prev, [userId]: role }));
  };

  const handleSaveRole = async (user) => {
    const newRole = pendingRoles[user.id];
    if (!newRole || newRole === user.role) return;
    setSavingRoleId(user.id);
    try {
      const res = await api.put(`/api/auth/users/${user.id}/role`, { role: newRole });
      if (isOk(res)) {
        setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, role: res.data.role } : u)));
        setPendingRoles((prev) => {
          const next = { ...prev };
          delete next[user.id];
          return next;
        });
        showRowMessage(user.id, 'success', 'Perfil atualizado!');
      } else {
        showRowMessage(user.id, 'error', res.data?.error || 'Não foi possível alterar o perfil.');
      }
    } catch (err) {
      showRowMessage(user.id, 'error', 'Erro de conexão com o servidor.');
    } finally {
      setSavingRoleId(null);
    }
  };

  const openResetPassword = (userId) => {
    setResetOpenId(userId);
    setNewPassword('');
    setConfirmPassword('');
    setShowResetPassword(false);
    setShowResetConfirm(false);
  };

  const closeResetPassword = () => {
    setResetOpenId(null);
    setNewPassword('');
    setConfirmPassword('');
    setShowResetPassword(false);
    setShowResetConfirm(false);
  };

  const handleResetPassword = async (user) => {
    if (newPassword.length < 4) {
      showRowMessage(user.id, 'error', 'A senha precisa ter pelo menos 4 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      showRowMessage(user.id, 'error', 'As senhas digitadas não são iguais.');
      return;
    }
    setSavingPassword(true);
    try {
      const res = await api.put(`/api/auth/users/${user.id}/password`, { newPassword });
      if (isOk(res)) {
        showRowMessage(user.id, 'success', 'Senha redefinida com sucesso!');
        closeResetPassword();
      } else {
        showRowMessage(user.id, 'error', res.data?.error || 'Não foi possível redefinir a senha.');
      }
    } catch (err) {
      showRowMessage(user.id, 'error', 'Erro de conexão com o servidor.');
    } finally {
      setSavingPassword(false);
    }
  };

  const handleDeleteUser = async (user) => {
    if (deleteConfirmId !== user.id) {
      // Primeiro clique só abre a confirmação — evita exclusão acidental.
      setDeleteConfirmId(user.id);
      return;
    }
    setDeletingId(user.id);
    try {
      const res = await api.delete(`/api/auth/users/${user.id}`);
      if (isOk(res)) {
        setUsers((prev) => prev.filter((u) => u.id !== user.id));
      } else {
        showRowMessage(user.id, 'error', res.data?.error || 'Não foi possível excluir o usuário.');
      }
    } catch (err) {
      showRowMessage(user.id, 'error', 'Erro de conexão com o servidor.');
    } finally {
      setDeletingId(null);
      setDeleteConfirmId(null);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setCreateError('');
    setCreateSuccess('');

    if (!newUser.username || !newUser.password) {
      setCreateError('Informe usuário e senha.');
      return;
    }
    if (newUser.password.length < 4) {
      setCreateError('A senha precisa ter pelo menos 4 caracteres.');
      return;
    }
    if (newUser.password !== newUser.confirmPassword) {
      setCreateError('As senhas digitadas não são iguais.');
      return;
    }

    setCreating(true);
    try {
      const res = await api.post('/api/auth/register', {
        username: newUser.username,
        password: newUser.password,
        role: newUser.role
      });
      if (isOk(res)) {
        setCreateSuccess(`Usuário "${newUser.username}" criado! Ele vai precisar trocar a senha no primeiro login.`);
        setNewUser(NEW_USER_DEFAULT);
        fetchUsers();
      } else {
        setCreateError(res.data?.error || 'Não foi possível criar o usuário.');
      }
    } catch (err) {
      setCreateError('Erro de conexão com o servidor.');
    } finally {
      setCreating(false);
    }
  };

  const toggleCreateForm = () => {
    setIsCreateOpen((prev) => !prev);
    setNewUser(NEW_USER_DEFAULT);
    setCreateError('');
    setCreateSuccess('');
    setShowCreatePassword(false);
    setShowCreateConfirm(false);
  };

  return (
    <div className="h-full w-full bg-slate-900 text-slate-100 p-6 flex flex-col overflow-hidden">
      <div className="flex justify-between items-center border-b border-slate-800 pb-4">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-bold text-amber-500 flex items-center gap-2">
              <Users size={22} /> Gerenciamento de Usuários
            </h1>
            <p className="text-slate-400 text-xs">
              Área restrita a administradores — crie, exclua, redefina senhas e altere perfis de acesso
            </p>
          </div>
        </div>

        <button
          onClick={toggleCreateForm}
          className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow"
        >
          {isCreateOpen ? <X size={14} /> : <UserPlus size={14} />}
          {isCreateOpen ? 'Cancelar' : 'Novo usuário'}
        </button>
      </div>

      <div className="max-w-4xl mx-auto w-full my-6 flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs p-3 rounded mb-5">
          <ShieldCheck size={16} className="shrink-0" />
          Por segurança, as senhas são armazenadas como hash e não podem ser visualizadas — apenas redefinidas. Usuários criados por um administrador precisam trocar a senha no primeiro login.
        </div>

        {isCreateOpen && (
          <form
            onSubmit={handleCreateUser}
            className="bg-slate-800/90 border border-slate-700 rounded-xl p-4 shadow-lg mb-5 flex flex-col gap-3"
          >
            <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <UserPlus size={16} className="text-amber-400" /> Criar novo usuário
            </h2>

            {createError && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-300 text-xs p-2.5 rounded">
                <AlertCircle size={13} className="shrink-0" /> {createError}
              </div>
            )}
            {createSuccess && (
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs p-2.5 rounded">
                <Check size={13} className="shrink-0" /> {createSuccess}
              </div>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-slate-400 font-semibold">Usuário</label>
                <input
                  type="text"
                  value={newUser.username}
                  onChange={(e) => setNewUser((prev) => ({ ...prev, username: e.target.value }))}
                  placeholder="Ex: operador03"
                  className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-slate-400 font-semibold">Senha inicial</label>
                <div className="relative">
                  <input
                    type={showCreatePassword ? 'text' : 'password'}
                    value={newUser.password}
                    onChange={(e) => setNewUser((prev) => ({ ...prev, password: e.target.value }))}
                    placeholder="••••••••"
                    className="bg-slate-900 border border-slate-700 rounded pl-2.5 pr-8 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500 w-full"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowCreatePassword((prev) => !prev)}
                    tabIndex={-1}
                    title={showCreatePassword ? 'Ocultar senha' : 'Mostrar senha'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-amber-400"
                  >
                    {showCreatePassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-slate-400 font-semibold">Confirmar senha</label>
                <div className="relative">
                  <input
                    type={showCreateConfirm ? 'text' : 'password'}
                    value={newUser.confirmPassword}
                    onChange={(e) => setNewUser((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                    placeholder="••••••••"
                    className="bg-slate-900 border border-slate-700 rounded pl-2.5 pr-8 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500 w-full"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowCreateConfirm((prev) => !prev)}
                    tabIndex={-1}
                    title={showCreateConfirm ? 'Ocultar senha' : 'Mostrar senha'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-amber-400"
                  >
                    {showCreateConfirm ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-slate-400 font-semibold">Perfil</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser((prev) => ({ ...prev, role: e.target.value }))}
                  className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={creating}
                className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-3 py-1.5 rounded text-xs font-semibold transition"
              >
                {creating ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
                Criar usuário
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-400 text-sm gap-2">
            <Loader2 size={18} className="animate-spin" /> Carregando usuários...
          </div>
        ) : loadError ? (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-300 text-xs p-3 rounded">
            <AlertCircle size={14} className="shrink-0" /> {loadError}
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm">Nenhum usuário cadastrado.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {users.map((user) => {
              const pendingRole = pendingRoles[user.id] ?? user.role;
              const roleChanged = pendingRole !== user.role;
              const rowMsg = rowMessages[user.id];
              const isResetOpen = resetOpenId === user.id;
              const isSelf = user.username === currentUser;
              const isDeleteConfirming = deleteConfirmId === user.id;

              return (
                <div
                  key={user.id}
                  className="bg-slate-800/90 border border-slate-700 rounded-xl p-4 shadow-lg"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-mono font-semibold text-sm text-slate-100">
                        {user.username} {isSelf && <span className="text-[10px] text-amber-400 font-sans">(você)</span>}
                      </p>
                      <p className="text-[11px] text-slate-500">Perfil atual: {ROLE_LABELS[user.role] || user.role}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={pendingRole}
                        onChange={(e) => handleRoleChange(user.id, e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                      >
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                        ))}
                      </select>

                      <button
                        onClick={() => handleSaveRole(user)}
                        disabled={!roleChanged || savingRoleId === user.id}
                        className="flex items-center gap-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-2.5 py-1.5 rounded text-xs font-semibold transition"
                      >
                        {savingRoleId === user.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                        Salvar perfil
                      </button>

                      <button
                        onClick={() => (isResetOpen ? closeResetPassword() : openResetPassword(user.id))}
                        className="flex items-center gap-1 bg-slate-900 hover:bg-slate-700 border border-slate-700 text-slate-200 px-2.5 py-1.5 rounded text-xs font-semibold transition"
                      >
                        <KeyRound size={13} className="text-amber-400" /> Redefinir senha
                      </button>

                      {isSelf ? (
                        <span
                          title="Você não pode excluir a própria conta que está logada agora."
                          className="flex items-center gap-1 text-slate-600 border border-slate-800 px-2.5 py-1.5 rounded text-xs font-semibold cursor-not-allowed"
                        >
                          <Trash2 size={13} /> Excluir
                        </span>
                      ) : (
                        <button
                          onClick={() => handleDeleteUser(user)}
                          disabled={deletingId === user.id}
                          className={`flex items-center gap-1 border px-2.5 py-1.5 rounded text-xs font-semibold transition disabled:opacity-50 ${
                            isDeleteConfirming
                              ? 'bg-red-600 hover:bg-red-500 text-white border-red-500'
                              : 'bg-slate-900 hover:bg-red-600/20 border-slate-700 text-red-400 hover:border-red-500/40'
                          }`}
                        >
                          {deletingId === user.id ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Trash2 size={13} />
                          )}
                          {isDeleteConfirming ? 'Confirmar exclusão?' : 'Excluir'}
                        </button>
                      )}
                      {isDeleteConfirming && (
                        <button
                          onClick={() => setDeleteConfirmId(null)}
                          className="bg-slate-900 hover:bg-slate-700 border border-slate-700 text-slate-300 px-2.5 py-1.5 rounded text-xs font-semibold transition"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </div>

                  {rowMsg && (
                    <div
                      className={`flex items-center gap-2 text-xs p-2 rounded mt-3 ${
                        rowMsg.type === 'success'
                          ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                          : 'bg-red-500/10 border border-red-500/30 text-red-300'
                      }`}
                    >
                      {rowMsg.type === 'success' ? <Check size={13} /> : <AlertCircle size={13} />}
                      {rowMsg.text}
                    </div>
                  )}

                  {isResetOpen && (
                    <div className="mt-3 pt-3 border-t border-slate-700 flex flex-wrap items-end gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] text-slate-400 font-semibold">Nova senha</label>
                        <div className="relative">
                          <input
                            type={showResetPassword ? 'text' : 'password'}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="••••••••"
                            className="bg-slate-900 border border-slate-700 rounded pl-2.5 pr-8 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500 w-full"
                          />
                          <button
                            type="button"
                            onClick={() => setShowResetPassword((prev) => !prev)}
                            tabIndex={-1}
                            title={showResetPassword ? 'Ocultar senha' : 'Mostrar senha'}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-amber-400"
                          >
                            {showResetPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] text-slate-400 font-semibold">Confirmar senha</label>
                        <div className="relative">
                          <input
                            type={showResetConfirm ? 'text' : 'password'}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="••••••••"
                            className="bg-slate-900 border border-slate-700 rounded pl-2.5 pr-8 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500 w-full"
                          />
                          <button
                            type="button"
                            onClick={() => setShowResetConfirm((prev) => !prev)}
                            tabIndex={-1}
                            title={showResetConfirm ? 'Ocultar senha' : 'Mostrar senha'}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-amber-400"
                          >
                            {showResetConfirm ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>
                      </div>
                      <button
                        onClick={() => handleResetPassword(user)}
                        disabled={savingPassword}
                        className="flex items-center gap-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-3 py-1.5 rounded text-xs font-semibold transition"
                      >
                        {savingPassword ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
                        Confirmar
                      </button>
                      <button
                        onClick={closeResetPassword}
                        className="bg-slate-900 hover:bg-slate-700 border border-slate-700 text-slate-300 px-3 py-1.5 rounded text-xs font-semibold transition"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="text-center text-slate-500 text-xs pb-2">
        Forno Industrial Dashboard — Gerenciamento de Usuários v1.0
      </div>
    </div>
  );
}
