export const API = process.env.NEXT_PUBLIC_API_URL || '';

export function userToken() {
  return typeof window !== 'undefined' ? (localStorage.getItem('deliveryUserToken') || '') : '';
}

export function userAuthFetch(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  const token = userToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}
