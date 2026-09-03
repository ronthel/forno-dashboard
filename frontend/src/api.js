import axios from 'axios';

// Client HTTP único e centralizado para todo o frontend.
//
// - Base URL vem de VITE_API_URL (arquivo frontend/.env), em vez de estar
//   escrita à mão em cada componente. Se a variável não existir, cai no
//   mesmo IP que já era usado como padrão.
// - O token de autenticação é injetado automaticamente em toda requisição
//   (quando existir um em localStorage), então os componentes não precisam
//   mais montar o header "Authorization: Bearer ..." manualmente.
// - validateStatus sempre retorna true para que respostas de erro HTTP
//   (400, 401, 403, 500...) cheguem normalmente em `response`, preservando
//   o mesmo comportamento que o código já tinha com fetch + "res.ok" — em
//   vez do axios cair automaticamente no catch() para qualquer status
//   diferente de 2xx.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://192.168.15.108:5000',
  validateStatus: () => true,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('authToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Sessão inválida ou expirada (o token JWT dura 12h — ver backend/routes/
// auth.js) sempre volta 401 do backend, tanto pra "sem token" quanto pra
// "token expirado". Sem esse interceptor, esse 401 só fazia a chamada
// específica falhar em silêncio (por causa do validateStatus acima) — o
// localStorage continuava dizendo "logado", a tela pulava a tela de login
// de novo, mas nenhuma chamada emplacava: dashboards, gráficos, nada
// carregava, sem nenhum aviso, e só um logout manual resolvia (foi
// exatamente o que aconteceu na Fase 5: token expirou durante a noite, o
// sistema "subiu logado" no dia seguinte mas sem os dashboards salvos).
// Agora qualquer 401 já limpa a sessão salva e recarrega a página sozinho,
// caindo de volta na tela de login sem precisar de nenhum passo manual.
api.interceptors.response.use((response) => {
  if (response.status === 401 && localStorage.getItem('isLoggedIn') === 'true') {
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('currentUserRole');
    localStorage.removeItem('mustChangePassword');
    localStorage.removeItem('authToken');
    window.location.reload();
  }
  return response;
});

// Equivalente ao "res.ok" do fetch, para quem checava isso antes.
export const isOk = (response) => response.status >= 200 && response.status < 300;

export default api;
