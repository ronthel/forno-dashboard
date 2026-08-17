const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { logAudit } = require('../audit');

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

// Extrai QUALQUER usuário autenticado (não só admin) a partir do token —
// usado nas rotas onde a ação é feita pelo próprio usuário sobre a própria
// conta (ex.: trocar a própria senha), não uma ação de administrador.
const getUserFromRequest = (req) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
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
    let admin = null;

    if (isFirstUser) {
      // Primeiro usuário do sistema: liberado sem login, e sempre criado
      // como administrador (garante que sempre exista pelo menos um admin).
      // A própria pessoa escolheu essa senha agora, então não precisa
      // trocar de novo no primeiro login.
      role = 'administrador';
    } else {
      // A partir do segundo usuário em diante, só um administrador logado
      // pode cadastrar novas contas.
      admin = getAdminFromRequest(req);
      if (!admin) {
        return res.status(403).json({ error: 'Apenas administradores logados podem criar novos usuários.' });
      }
      role = role || 'operador';
    }

    // Usuário criado por um administrador (não é o bootstrap do primeiro
    // usuário): por segurança, é obrigado a trocar a senha no primeiro login,
    // já que quem escolheu a senha inicial foi outra pessoa.
    const mustChangePassword = !isFirstUser;

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password, role, must_change_password) VALUES ($1, $2, $3, $4) RETURNING id, username, role',
      [username, hashedPassword, role, mustChangePassword]
    );

    if (admin) {
      logAudit({
        userId: admin.id,
        username: admin.username,
        role: admin.role,
        action: 'criou usuário',
        details: { novoUsuario: username, perfil: role }
      });
    }

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

    logAudit({
      userId: user.id,
      username: user.username,
      role: user.role,
      action: 'fez login no sistema'
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        mustChangePassword: user.must_change_password
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Troca de senha feita pelo próprio usuário logado — usada principalmente no
// fluxo obrigatório de primeiro login (usuário criado por um administrador),
// mas serve para qualquer troca de senha por iniciativa do próprio dono da conta.
router.put('/change-password', async (req, res) => {
  const requester = getUserFromRequest(req);
  if (!requester) {
    return res.status(401).json({ error: 'Login necessário para esta ação.' });
  }
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'Informe uma nova senha com pelo menos 4 caracteres.' });
  }
  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password = $1, must_change_password = FALSE WHERE id = $2',
      [hashedPassword, requester.id]
    );

    logAudit({
      userId: requester.id,
      username: requester.username,
      role: requester.role,
      action: 'definiu nova senha no primeiro login'
    });

    res.json({ message: 'Senha atualizada com sucesso.' });
  } catch (err) {
    console.error('Erro ao trocar a própria senha:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar a senha.' });
  }
});

// Lista todos os usuários cadastrados — apenas administradores.
// Nunca retorna a senha: ela é salva como hash bcrypt (mão única), então não
// existe "senha em texto" nenhuma para mostrar, nem para nós nem para o banco.
router.get('/users', async (req, res) => {
  const admin = getAdminFromRequest(req);
  if (!admin) {
    return res.status(403).json({ error: 'Apenas administradores podem ver a lista de usuários.' });
  }
  try {
    const result = await pool.query('SELECT id, username, role FROM users ORDER BY username ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao listar usuários:', err.message);
    res.status(500).json({ error: 'Erro ao listar usuários.' });
  }
});

// Redefine a senha de um usuário — apenas administradores.
router.put('/users/:id/password', async (req, res) => {
  const admin = getAdminFromRequest(req);
  if (!admin) {
    return res.status(403).json({ error: 'Apenas administradores podem redefinir senhas.' });
  }
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'Informe uma nova senha com pelo menos 4 caracteres.' });
  }
  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const result = await pool.query(
      'UPDATE users SET password = $1 WHERE id = $2 RETURNING id, username',
      [hashedPassword, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    logAudit({
      userId: admin.id,
      username: admin.username,
      role: admin.role,
      action: 'redefiniu senha de usuário',
      details: { usuarioAlvo: result.rows[0].username }
    });

    res.json({ message: `Senha de "${result.rows[0].username}" redefinida com sucesso.` });
  } catch (err) {
    console.error('Erro ao redefinir senha:', err.message);
    res.status(500).json({ error: 'Erro ao redefinir senha.' });
  }
});

// Altera o perfil (role) de um usuário — apenas administradores.
router.put('/users/:id/role', async (req, res) => {
  const admin = getAdminFromRequest(req);
  if (!admin) {
    return res.status(403).json({ error: 'Apenas administradores podem alterar perfis.' });
  }
  const { role } = req.body;
  const VALID_ROLES = ['operador', 'supervisor', 'administrador'];
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Perfil inválido.' });
  }
  try {
    // Proteção: impede rebaixar o último administrador do sistema — evita
    // travar a gestão de usuários sem nenhum admin restante.
    if (role !== 'administrador') {
      const targetRes = await pool.query('SELECT role FROM users WHERE id = $1', [req.params.id]);
      if (targetRes.rows.length === 0) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }
      if (targetRes.rows[0].role === 'administrador') {
        const countRes = await pool.query("SELECT COUNT(*)::int AS total FROM users WHERE role = 'administrador'");
        if (countRes.rows[0].total <= 1) {
          return res.status(400).json({ error: 'Não é possível remover o último administrador do sistema.' });
        }
      }
    }

    const previousRes = await pool.query('SELECT role FROM users WHERE id = $1', [req.params.id]);
    const previousRole = previousRes.rows[0]?.role;

    const result = await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, username, role',
      [role, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    logAudit({
      userId: admin.id,
      username: admin.username,
      role: admin.role,
      action: 'alterou perfil de usuário',
      details: { usuarioAlvo: result.rows[0].username, perfilAnterior: previousRole, perfilNovo: role }
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao alterar perfil:', err.message);
    res.status(500).json({ error: 'Erro ao alterar perfil.' });
  }
});

// Exclui um usuário — apenas administradores.
router.delete('/users/:id', async (req, res) => {
  const admin = getAdminFromRequest(req);
  if (!admin) {
    return res.status(403).json({ error: 'Apenas administradores podem excluir usuários.' });
  }
  try {
    const targetRes = await pool.query('SELECT username, role FROM users WHERE id = $1', [req.params.id]);
    if (targetRes.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    const target = targetRes.rows[0];

    // Proteção: impede excluir o último administrador do sistema.
    if (target.role === 'administrador') {
      const countRes = await pool.query("SELECT COUNT(*)::int AS total FROM users WHERE role = 'administrador'");
      if (countRes.rows[0].total <= 1) {
        return res.status(400).json({ error: 'Não é possível excluir o último administrador do sistema.' });
      }
    }

    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);

    logAudit({
      userId: admin.id,
      username: admin.username,
      role: admin.role,
      action: 'excluiu usuário',
      details: { usuarioAlvo: target.username, perfil: target.role }
    });

    res.json({ message: `Usuário "${target.username}" excluído com sucesso.` });
  } catch (err) {
    console.error('Erro ao excluir usuário:', err.message);
    res.status(500).json({ error: 'Erro ao excluir usuário.' });
  }
});

module.exports = router;