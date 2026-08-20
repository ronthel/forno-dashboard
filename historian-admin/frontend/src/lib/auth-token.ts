// Módulo minúsculo, sem React — só o estado bruto do token e um "canal"
// pra forçar logout. Existe separado de auth-store.tsx só pra evitar
// import circular (api-client.ts precisa ler o token em toda chamada;
// auth-store.tsx precisa gravar o token no login) — os dois importam
// daqui, nenhum importa do outro.

let currentToken: string | null = null;

export function getStoredToken(): string | null {
  return currentToken;
}

export function setStoredToken(token: string | null) {
  currentToken = token;
}

let forceLogoutFn: (() => void) | null = null;

export function registerForceLogout(fn: (() => void) | null) {
  forceLogoutFn = fn;
}

export function forceLogout() {
  forceLogoutFn?.();
}
