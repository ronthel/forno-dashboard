const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');

if (!process.env.JWT_SECRET) {
  console.warn('[Aviso] JWT_SECRET não definido no .env — o login vai falhar até isso ser configurado.');
}

// Extrai e valida o usuário administrador a partir do token enviado no
// cabeçalho Authorization: Bearer <token>. Retorna o payload decodificado
// se for um admin válido, ou null caso contrário.
const getAdminFromRequest = (req) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.role === 'administrador' ? decoded : null;
  } catch (err) {
    return null;
  }
};

// Informa ao frontend se já existe algum usuário cadastrado — usado para
// decidir se a criação de usuário está em modo "primeiro acesso" (livre)
// ou se já exige um administrador logado.
router.get('/status', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*)::int AS total FROM users');
    res.json({ hasUsers: result.rows[0].total > 0 });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao consultar status de usuários.' });
  }
});

// Registro de Usuário
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  let { role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
  }

  try {
    const countResult = await pool.query('SELECT COUNT(*)::int AS total FROM users');
    const isFirstUser = countResult.rows[0].total === 0;

    if (isFirstUser) {
      // Primeiro usuário do sistema: liberado sem login, e sempre criado
      // como administrador (garante que sempre exista pelo menos um admin).
      role = 'administrador';
    } else {
      // A partir do segundo usuário em diante, só um administrador logado
      // pode cadastrar novas contas.
      const admin = getAdminFromRequest(req);
      if (!admin) {
        return res.status(403).json({ error: 'Apenas administradores logados podem criar novos usuários.' });
      }
      role = role || 'operador';
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role',
      [username, hashedPassword, role]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: 'Usuário já existe ou erro nos dados.' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
  }
  try {
    const userRes = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (userRes.rows.length === 0) return res.status(400).json({ error: 'Usuário não encontrado' });

    const user = userRes.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: 'Senha incorreta' });

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

module.exports = router;