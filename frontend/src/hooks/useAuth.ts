import { useState, useEffect, useCallback } from 'react';
import config from '../config';

interface AuthState {
  isAuthenticated: boolean;
  token: string | null;        // id_token — for API Authorization header
  accessToken: string | null;  // access_token — for Socket.IO auth (backend verifies this)
  userName: string | null;
  login: () => void;
  logout: () => void;
  checkAuth: () => boolean;    // returns false and triggers logout if token invalid
}

const isEmbedded = () => window.self !== window.top;
const REDIRECT_URI = window.location.origin + '/';

function isTokenValid(token: string | null): boolean {
  if (!token) return false;
  try {
    const { exp } = JSON.parse(atob(token.split('.')[1]));
    return exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

function getStoredToken(key: string): string | null {
  const t = localStorage.getItem(key);
  if (!isTokenValid(t)) {
    localStorage.removeItem(key);
    return null;
  }
  return t;
}

export function useAuth(): AuthState {
  const [token, setToken] = useState<string | null>(
    () => getStoredToken('id_token')
  );
  const [accessToken, setAccessToken] = useState<string | null>(
    () => getStoredToken('access_token')
  );
  const [userName, setUserName] = useState<string | null>(
    () => localStorage.getItem('user_name')
  );

  const logout = useCallback(() => {
    localStorage.removeItem('id_token');
    localStorage.removeItem('access_token');
    localStorage.removeItem('user_name');
    const { cognitoDomain, cognitoClientId } = config;
    window.location.href =
      `https://${cognitoDomain}/logout` +
      `?client_id=${cognitoClientId}` +
      `&logout_uri=${encodeURIComponent(REDIRECT_URI)}`;
  }, []);

  /** Validates the current token from localStorage. Triggers logout if invalid. */
  const checkAuth = useCallback((): boolean => {
    const current = localStorage.getItem('id_token');
    if (isTokenValid(current)) return true;
    logout();
    return false;
  }, [logout]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) return;

    window.history.replaceState({}, document.title, window.location.pathname);

    // If this page was opened as a popup by an embedded parent, exchange the code
    // and post the tokens back, then close — the parent will receive them via postMessage.
    const isPopup = window.opener && window.opener !== window;

    const { cognitoDomain, cognitoClientId } = config;
    fetch(`https://${cognitoDomain}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: cognitoClientId,
        code,
        redirect_uri: REDIRECT_URI,
      }),
    })
      .then(r => r.json())
      .then(data => {
        const idToken = data.id_token as string;
        const accToken = data.access_token as string;
        if (!idToken) return;

        if (isPopup) {
          // Send tokens to the embedded parent and close the popup
          window.opener.postMessage(
            { type: 'NAT_AUTH_TOKENS', idToken, accessToken: accToken },
            window.location.origin
          );
          window.close();
          return;
        }

        localStorage.setItem('id_token', idToken);
        setToken(idToken);
        if (accToken) {
          localStorage.setItem('access_token', accToken);
          setAccessToken(accToken);
        }
        try {
          const payload = JSON.parse(atob(idToken.split('.')[1]));
          const name = payload.email || payload['cognito:username'] || 'Agent';
          localStorage.setItem('user_name', name);
          setUserName(name);
        } catch {}
      })
      .catch(console.error);
  }, []);

  // Listen for tokens posted back from the auth popup (embedded/iframe mode)
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'NAT_AUTH_TOKENS') return;
      const { idToken, accessToken: accToken } = event.data;
      if (!idToken) return;
      localStorage.setItem('id_token', idToken);
      setToken(idToken);
      if (accToken) {
        localStorage.setItem('access_token', accToken);
        setAccessToken(accToken);
      }
      try {
        const payload = JSON.parse(atob(idToken.split('.')[1]));
        const name = payload.email || payload['cognito:username'] || 'Agent';
        localStorage.setItem('user_name', name);
        setUserName(name);
      } catch {}
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const login = () => {
    const { cognitoDomain, cognitoClientId } = config;
    const authUrl =
      `https://${cognitoDomain}/login` +
      `?client_id=${cognitoClientId}` +
      `&response_type=code` +
      `&scope=email+openid+profile` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

    if (isEmbedded()) {
      // Open Cognito in a popup so the iframe's top-level navigation isn't hijacked
      window.open(authUrl, 'nat-auth', 'width=500,height=700,noopener=0');
    } else {
      window.location.href = authUrl;
    }
  };

  // Schedule logout exactly when the token expires
  useEffect(() => {
    if (!token) return;
    try {
      const { exp } = JSON.parse(atob(token.split('.')[1]));
      const ms = exp * 1000 - Date.now();
      if (ms <= 0) { logout(); return; }
      const timer = setTimeout(logout, ms);
      return () => clearTimeout(timer);
    } catch {
      logout();
    }
  }, [token, logout]);

  return { isAuthenticated: !!token && isTokenValid(token), token, accessToken, userName, login, logout, checkAuth };
}
