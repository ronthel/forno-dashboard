import React, { useState } from 'react';
import { ServerOff, LogIn, RefreshCw } from 'lucide-react';

export default function Login({ onLoginSuccess, isServerDown }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (username && password) {
      onLoginSuccess();
    }
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
          <form onSubmit={handleSubmit} className="space-y-4">
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
              className="w-full bg-amber-600 hover:bg-amber-500 text-white font-medium py-2 rounded transition flex items-center justify-center gap-2 text-sm mt-2"
            >
              <LogIn size={16} /> Entrar no Sistema
            </button>
          </form>
        )}
      </div>
    </div>
  );
}