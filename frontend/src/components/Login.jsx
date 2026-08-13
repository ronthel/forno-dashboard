import React, { useState } from 'react';
import axios from 'axios';

const API_BASE = `http://${window.location.hostname}:5000/api`;

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API_BASE}/auth/login`, { username, password });
      onLogin(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erro na conexão com o servidor');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-950 p-4">
      <form onSubmit={handleSubmit} className="bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl w-full max-w-md">
        <h2 className="text-2xl font-bold text-amber-500 mb-6 text-center">Acesso ao Forno Industrial</h2>
        {error && <div className="bg-rose-900/50 border border-rose-500 text-rose-200 text-sm p-3 rounded mb-4">{error}</div>}
        
        <div className="mb-4">
          <label className="block text-slate-400 text-sm mb-1">Usuário</label>
          <input type="text" value={username} onChange={e => setUsername(e.target.value)} required className="w-full bg-slate-800 border border-slate-700 rounded p-2.5 text-slate-100 focus:outline-none focus:border-amber-500" />
        </div>

        <div className="mb-6">
          <label className="block text-slate-400 text-sm mb-1">Senha</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="w-full bg-slate-800 border border-slate-700 rounded p-2.5 text-slate-100 focus:outline-none focus:border-amber-500" />
        </div>

        <button type="submit" className="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold py-3 rounded-lg transition">Entrar no Sistema</button>
      </form>
    </div>
  );
}