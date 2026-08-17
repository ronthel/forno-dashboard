import React, { useState } from 'react';
import api, { isOk } from './api';
import { X, LogIn, LogOut, UserPlus, AlertCircle } from 'lucide-react';

export default function UserSwitchModal({ isOpen, onClose, onSwitchUser, onLogout, currentUser, currentUserRole }) {
  const isAdmin = currentUserRole === 'administrador';
  const [mode, setMode] = useState('switch'); // 'switch' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('operador');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const resetAndClose = () => {
    setUsername('');
    setPassword('');
    setError('');
    setInfo('');
    setMode('switch');
    onClose();
  };

  const handleSwitchUser = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/api/auth/login', { username, password });
      const data = res.data;
      if (!isOk(res)) {
        setError(data.error || 'Não foi possível entrar com esse usuário.');
        return;
      }
      onSwitchUser(data.user.username, data.token, data.user.role, data.user.mustChangePassword);
      resetAndClose();
    } catch (err) {
      setError('Erro de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const res = await api.post('/api/auth/register', { username, password, role });
      const data = res.data;
      if (!isOk(res)) {
        setError(data.error || 'Não foi possível criar o usuário.');
        return;
      }
      setInfo('Usuário criado com sucesso! Agora você pode entrar com ele.');
      setMode('switch');
      setPassword('');
    } catch (err) {
      setError('Erro de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  };

  const switchTab = (newMode) => {
    setMode(newMode);
    setError('');
    setInfo('');
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="flex justify-between items-center px-5 py-4 border-b border-slate-800 bg-slate-950/50">
          <div>
            <h2 className="text-sm font-bold text-slate-100">Conta</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Logado como <span className="text-amber-400 font-semibold">{currentUser}</span>
            </p>
          </div>
          <button onClick={resetAndClose} className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition">
            <X size={16} />
          </button>
        </div>

        <div className="p-5">
          {isAdmin && (
            <div className="flex gap-1 bg-slate-800/70 border border-slate-700 rounded-lg p-1 mb-4">
              <button
                type="button"
                onClick={() => switchTab('switch')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-semibold transition ${
                  mode === 'switch' ? 'bg-amber-600 text-white' : 'text-slate-300 hover:bg-slate-700'
                }`}
              >
                <LogIn size={13} /> Trocar usuário
              </button>
              <button
                type="button"
                onClick={() => switchTab('register')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-semibold transition ${
                  mode === 'register' ? 'bg-amber-600 text-white' : 'text-slate-300 hover:bg-slate-700'
                }`}
              >
                <UserPlus size={13} /> Criar usuário
              </button>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-300 text-xs p-2.5 rounded mb-4">
              <AlertCircle size={14} className="shrink-0" /> {error}
            </div>
          )}
          {info && (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs p-2.5 rounded mb-4">
              {info}
            </div>
          )}

          {mode === 'switch' ? (
            <form onSubmit={handleSwitchUser} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Usuário</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Ex: supervisor01"
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Senha</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white font-medium py-2 rounded transition flex items-center justify-center gap-2 text-sm"
              >
                <LogIn size={15} /> {loading ? 'Entrando...' : 'Entrar com este usuário'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Novo usuário</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Ex: operador03"
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Senha</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Perfil</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                >
                  <option value="operador">Operador</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="administrador">Administrador</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white font-medium py-2 rounded transition flex items-center justify-center gap-2 text-sm"
              >
                <UserPlus size={15} /> {loading ? 'Criando...' : 'Criar Usuário'}
              </button>
            </form>
          )}

          <div className="flex gap-2 pt-4 mt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={() => { onLogout(); resetAndClose(); }}
              className="flex-1 flex items-center justify-center gap-1.5 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white border border-red-500/30 px-3 py-2 rounded text-xs font-semibold transition"
            >
              <LogOut size={14} /> Sair (Deslogar)
            </button>
            <button
              type="button"
              onClick={resetAndClose}
              className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-3 py-2 rounded text-xs font-semibold transition"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
