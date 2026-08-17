import React, { useState, useEffect } from 'react';
import api, { isOk } from './api';
import { ServerOff, LogIn, RefreshCw, AlertCircle, UserPlus, ShieldCheck } from 'lucide-react';

export default function Login({ onLoginSuccess, isServerDown }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  // Enquanto não existir NENHUM usuário cadastrado no banco, a criação do
  // primeiro usuário (que vira administrador automaticamente) fica liberada
  // aqui na tela de login. A partir do 2º usuário em diante, essa aba some
  // e a criação de conta passa a exigir um administrador logado.
  const [hasUsers, setHasUsers] = useState(true);
  const [statusChecked, setStatusChecked] = useState(false);

  useEffect(() => {
    if (isServerDown) return;
    api.get('/api/auth/status')
      .then((res) => setHasUsers(Boolean(res.data?.hasUsers)))
      .catch(() => setHasUsers(true))
      .finally(() => setStatusChecked(true));
  }, [isServerDown]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/api/auth/login', { username, password });
      const data = res.data;
      if (!isOk(res)) {
        setError(data.error || 'Não foi possível entrar.');
        return;
      }
      onLoginSuccess(data.user.username, data.token, data.user.role, data.user.mustChangePassword);
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
      const res = await api.post('/api/auth/register', { username, password });
      const data = res.data;
      if (!isOk(res)) {
        setError(data.error || 'Não foi possível criar o usuário.');
        return;
      }
      setInfo('Usuário administrador criado com sucesso! Agora você já pode entrar.');
      setHasUsers(true);
      setMode('login');
      setPassword('');
    } catch (err) {
      setError('Erro de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (newMode) => {
    setMode(newMode);
    setError('');
    setInfo('');
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 p-8 rounded-xl shadow-2xl w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-amber-500">Forno Industrial</h1>
          <p className="text-slate-400 text-xs mt-1">Sistema de Monitoramento e Histórico</p>
        </div>

        {/* Banner de Aviso caso o Backend esteja offline */}
        {isServerDown ? (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-center mb-6">
            <ServerOff className="mx-auto text-red-400 mb-2" size={32} />
            <h3 className="text-red-400 font-semibold text-sm">Backend Indisponível</h3>
            <p className="text-slate-400 text-xs mt-1">
              Não foi possível conectar ao servidor. Verifique se o serviço Node.js está rodando.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 inline-flex items-center gap-1.5 bg-red-600/80 hover:bg-red-600 text-white text-xs px-3 py-1.5 rounded font-medium transition"
            >
              <RefreshCw size={12} /> Tentar Reconectar
            </button>
          </div>
        ) : (
          <>
            {statusChecked && !hasUsers && (
              <div className="flex gap-1 bg-slate-800/70 border border-slate-700 rounded-lg p-1 mb-5">
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-semibold transition ${
                    mode === 'login' ? 'bg-amber-600 text-white' : 'text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <LogIn size={13} /> Entrar
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('register')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-semibold transition ${
                    mode === 'register' ? 'bg-amber-600 text-white' : 'text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <UserPlus size={13} /> Criar usuário
                </button>
              </div>
            )}

            {statusChecked && !hasUsers && mode === 'register' && (
              <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs p-2.5 rounded mb-4">
                <ShieldCheck size={14} className="shrink-0" />
                Primeiro acesso: este usuário será criado como Administrador do sistema.
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

            {mode === 'login' ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Usuário / Operador</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Ex: operador01"
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
                  className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white font-medium py-2 rounded transition flex items-center justify-center gap-2 text-sm mt-2"
                >
                  <LogIn size={16} /> {loading ? 'Entrando...' : 'Entrar no Sistema'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Novo usuário</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Ex: operador02"
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
                  className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white font-medium py-2 rounded transition flex items-center justify-center gap-2 text-sm mt-2"
                >
                  <UserPlus size={16} /> {loading ? 'Criando...' : 'Criar Administrador'}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
