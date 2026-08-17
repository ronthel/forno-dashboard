import React, { useState } from 'react';
import api, { isOk } from './api';
import { KeyRound, ShieldAlert, AlertCircle, LogOut } from 'lucide-react';

// Tela obrigatória exibida quando o usuário logado precisa trocar a senha
// antes de continuar — hoje isso acontece só para contas criadas por um
// administrador (a senha inicial foi escolhida por outra pessoa). Não tem
// como "pular" essa tela a não ser trocando a senha ou saindo (Logout).
export default function ForceChangePasswordView({ currentUser, onPasswordChanged, onLogout }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 4) {
      setError('A senha precisa ter pelo menos 4 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('As senhas digitadas não são iguais.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.put('/api/auth/change-password', { newPassword });
      if (!isOk(res)) {
        setError(res.data?.error || 'Não foi possível atualizar a senha.');
        return;
      }
      onPasswordChanged();
    } catch (err) {
      setError('Erro de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 p-8 rounded-xl shadow-2xl w-full max-w-md">
        <div className="text-center mb-6">
          <ShieldAlert className="mx-auto text-amber-500 mb-2" size={32} />
          <h1 className="text-xl font-bold text-amber-500">Defina uma nova senha</h1>
          <p className="text-slate-400 text-xs mt-1">
            Olá, <span className="text-slate-200 font-semibold">{currentUser}</span>. Por segurança, sua conta foi criada por um administrador — antes de continuar, defina uma senha só sua.
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-300 text-xs p-2.5 rounded mb-4">
            <AlertCircle size={14} className="shrink-0" /> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Nova senha</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Confirmar nova senha</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white font-medium py-2 rounded transition flex items-center justify-center gap-2 text-sm mt-2"
          >
            <KeyRound size={16} /> {loading ? 'Salvando...' : 'Salvar nova senha e continuar'}
          </button>

          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-1.5 text-slate-400 hover:text-slate-200 text-xs py-1 transition"
          >
            <LogOut size={13} /> Sair e entrar com outra conta
          </button>
        </form>
      </div>
    </div>
  );
}
