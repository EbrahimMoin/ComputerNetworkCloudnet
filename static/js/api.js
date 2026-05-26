import { getAvatarSeed, normalizeHandle, safeArray, toText } from './utils.js';
import { normalizePost, normalizeUser } from './render.js';

const API_ROOT = '/api';

function getStoredToken() {
  try {
    return localStorage.getItem('cloudnet_token') || '';
  } catch {
    return '';
  }
}

function setStoredToken(token) {
  try {
    if (token) {
      localStorage.setItem('cloudnet_token', token);
    } else {
      localStorage.removeItem('cloudnet_token');
    }
  } catch {
    // Ignore storage failures.
  }
}

export function clearStoredToken() {
  setStoredToken('');
}

export function storeToken(token) {
  setStoredToken(token);
}

export function currentToken() {
  return getStoredToken();
}

function toFormData(payload = {}) {
  const form = new FormData();
  Object.entries(payload).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    form.append(key, value);
  });
  return form;
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text };
  }
}

function extractMessage(payload, fallback = 'Request failed') {
  if (!payload) {
    return fallback;
  }
  if (typeof payload === 'string') {
    return payload;
  }
  return payload.detail || payload.message || payload.error || fallback;
}

function isFallbackStatus(status) {
  return status === 404 || status === 405 || status === 415 || status === 422;
}

async function request(url, init = {}) {
  const response = await fetch(url, init);
  const payload = await safeJson(response);
  if (!response.ok) {
    const error = new Error(extractMessage(payload, response.statusText || 'Request failed'));
    error.status = response.status;
    error.payload = payload;
    error.url = url;
    throw error;
  }
  return payload;
}

async function requestWithFallbacks(attempts) {
  let lastError = null;
  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i];
    try {
      const response = await fetch(attempt.url, attempt.init || {});
      const payload = await safeJson(response);
      if (response.ok) {
        return payload;
      }
      const shouldFallback = attempt.fallback !== false && isFallbackStatus(response.status);
      if (shouldFallback && i < attempts.length - 1) {
        lastError = null;
        continue;
      }
      const error = new Error(extractMessage(payload, response.statusText || 'Request failed'));
      error.status = response.status;
      error.payload = payload;
      error.url = attempt.url;
      throw error;
    } catch (err) {
      if (err && typeof err.status === 'number') {
        lastError = err;
        if (i < attempts.length - 1 && isFallbackStatus(err.status)) {
          continue;
        }
        throw err;
      }
      lastError = err;
      if (i < attempts.length - 1) {
        continue;
      }
    }
  }
  if (lastError) {
    throw lastError;
  }
  throw new Error('Request failed');
}

function authHeaders(token = currentToken()) {
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function mergeHeaders(base = {}, extra = {}) {
  return { ...base, ...extra };
}

function unwrapCollection(payload, preferredKeys = []) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  for (const key of preferredKeys) {
    if (Array.isArray(payload[key])) {
      return payload[key];
    }
  }
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.posts)) return payload.posts;
  if (Array.isArray(payload.users)) return payload.users;
  if (Array.isArray(payload.notifications)) return payload.notifications;
  return [];
}

function normalizeCollection(payload, normalizer) {
  return unwrapCollection(payload).map((item) => normalizer(item));
}

export async function getSession() {
  const token = currentToken();
  if (!token) {
    return null;
  }

  try {
    const payload = await requestWithFallbacks([
      { url: `${API_ROOT}/me`, init: { headers: authHeaders(token) } },
      { url: '/me', init: { headers: authHeaders(token) } },
    ]);
    return normalizeUser(payload);
  } catch (err) {
    if (err && (err.status === 401 || err.status === 403)) {
      clearStoredToken();
    }
    return null;
  }
}

export async function login(credentials) {
  const body = {
    username: toText(credentials.username).trim(),
    password: toText(credentials.password),
  };

  return requestWithFallbacks([
    {
      url: `${API_ROOT}/login`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    },
    {
      url: `${API_ROOT}/login`,
      init: {
        method: 'POST',
        body: toFormData(body),
      },
    },
    {
      url: '/login',
      init: {
        method: 'POST',
        body: toFormData(body),
      },
    },
  ]);
}

export async function signup(payload) {
  const body = {
    username: toText(payload.username).trim(),
    email: toText(payload.email).trim(),
    password: toText(payload.password),
  };

  return requestWithFallbacks([
    {
      url: `${API_ROOT}/signup`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    },
    {
      url: `${API_ROOT}/signup`,
      init: {
        method: 'POST',
        body: toFormData(body),
      },
    },
    {
      url: '/signup',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    },
  ]);
}

export async function fetchFeed(scope = 'for_you', token = currentToken(), options = {}) {
  const query = new URLSearchParams({ scope });
  const limit = Number(options?.limit);
  const offset = Number(options?.offset);
  if (Number.isFinite(limit) && limit > 0) {
    query.set('limit', String(Math.floor(limit)));
  }
  if (Number.isFinite(offset) && offset >= 0) {
    query.set('offset', String(Math.floor(offset)));
  }
  const payload = await requestWithFallbacks([
    { url: `${API_ROOT}/feed?${query.toString()}`, init: { headers: authHeaders(token) } },
    { url: '/tweets', init: { headers: authHeaders(token) } },
  ]);
  return unwrapCollection(payload, ['items', 'posts', 'tweets']);
}

export async function updateProfile(payload, token = currentToken()) {
  const body = {};
  if (Object.prototype.hasOwnProperty.call(payload || {}, 'display_name')) {
    body.display_name = toText(payload.display_name);
  } else if (Object.prototype.hasOwnProperty.call(payload || {}, 'displayName')) {
    body.display_name = toText(payload.displayName);
  }

  if (Object.prototype.hasOwnProperty.call(payload || {}, 'bio')) {
    body.bio = toText(payload.bio);
  }

  return requestWithFallbacks([
    {
      url: `${API_ROOT}/me`,
      init: {
        method: 'PATCH',
        headers: mergeHeaders(authHeaders(token), { 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      },
    },
    {
      url: '/me',
      init: {
        method: 'PATCH',
        headers: mergeHeaders(authHeaders(token), { 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      },
    },
  ]);
}

export async function updateAvatar(imageFile, token = currentToken()) {
  const body = new FormData();
  if (imageFile) {
    body.append('image', imageFile);
  }

  return requestWithFallbacks([
    {
      url: `${API_ROOT}/me/avatar`,
      init: {
        method: 'POST',
        headers: authHeaders(token),
        body,
      },
    },
    {
      url: '/me/avatar',
      init: {
        method: 'POST',
        headers: authHeaders(token),
        body,
      },
    },
  ]);
}

export async function fetchPost(postId, token = currentToken()) {
  return requestWithFallbacks([
    { url: `${API_ROOT}/posts/${encodeURIComponent(postId)}`, init: { headers: authHeaders(token) } },
  ]);
}

export async function fetchComments(postId, token = currentToken()) {
  const payload = await requestWithFallbacks([
    { url: `${API_ROOT}/posts/${encodeURIComponent(postId)}/comments`, init: { headers: authHeaders(token) } },
  ]);
  return unwrapCollection(payload, ['items', 'comments']);
}

export async function createPost({ content, imageFile, token = currentToken() }) {
  const body = new FormData();
  body.append('content', toText(content));
  if (imageFile) {
    body.append('image', imageFile);
  }

  return requestWithFallbacks([
    {
      url: `${API_ROOT}/posts`,
      init: {
        method: 'POST',
        headers: authHeaders(token),
        body,
      },
    },
    {
      url: '/tweet',
      init: {
        method: 'POST',
        headers: authHeaders(token),
        body,
      },
    },
  ]);
}

export async function deletePost(postId, token = currentToken()) {
  return requestWithFallbacks([
    {
      url: `${API_ROOT}/posts/${encodeURIComponent(postId)}`,
      init: {
        method: 'DELETE',
        headers: authHeaders(token),
      },
    },
    {
      url: `/tweet/${encodeURIComponent(postId)}`,
      init: {
        method: 'DELETE',
        headers: authHeaders(token),
      },
    },
  ]);
}

export async function toggleLike(postId, liked, token = currentToken()) {
  const method = liked ? 'DELETE' : 'POST';
  return requestWithFallbacks([
    {
      url: `${API_ROOT}/posts/${encodeURIComponent(postId)}/like`,
      init: { method, headers: authHeaders(token) },
    },
  ]);
}

export async function addComment(postId, content, token = currentToken()) {
  return requestWithFallbacks([
    {
      url: `${API_ROOT}/posts/${encodeURIComponent(postId)}/comments`,
      init: {
        method: 'POST',
        headers: mergeHeaders(authHeaders(token), { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ content: toText(content) }),
      },
    },
  ]);
}

export async function toggleFollow(username, following, token = currentToken()) {
  const method = following ? 'DELETE' : 'POST';
  return requestWithFallbacks([
    {
      url: `${API_ROOT}/users/${encodeURIComponent(username)}/follow`,
      init: { method, headers: authHeaders(token) },
    },
  ]);
}

export async function fetchProfile(username, token = currentToken()) {
  const payload = await requestWithFallbacks([
    { url: `${API_ROOT}/users/${encodeURIComponent(username)}`, init: { headers: authHeaders(token) } },
  ]);
  return normalizeUser(payload);
}

export async function fetchProfilePosts(username, token = currentToken()) {
  const payload = await requestWithFallbacks([
    { url: `${API_ROOT}/users/${encodeURIComponent(username)}/posts`, init: { headers: authHeaders(token) } },
    { url: '/tweets', init: { headers: authHeaders(token) } },
  ]);
  const posts = unwrapCollection(payload, ['items', 'posts', 'tweets']);
  return posts
    .map((item) => normalizePost(item))
    .filter((post) => !username || post.author.username === username || post.author.handle === normalizeHandle(username));
}

export async function fetchNotifications(filter = 'all', token = currentToken()) {
  const query = new URLSearchParams({ filter });
  const payload = await requestWithFallbacks([
    { url: `${API_ROOT}/notifications?${query.toString()}`, init: { headers: authHeaders(token) } },
  ]);
  return unwrapCollection(payload, ['items', 'notifications']).map((item) => item);
}

export async function markNotificationsRead(token = currentToken()) {
  return requestWithFallbacks([
    {
      url: `${API_ROOT}/notifications/read-all`,
      init: {
        method: 'POST',
        headers: authHeaders(token),
      },
    },
  ]);
}

export async function search(query, token = currentToken()) {
  const q = toText(query).trim();
  if (!q) {
    return { users: [], posts: [] };
  }

  try {
    const payload = await requestWithFallbacks([
      { url: `${API_ROOT}/search?q=${encodeURIComponent(q)}`, init: { headers: authHeaders(token) } },
    ]);
    const users = unwrapCollection(payload, ['users']).map(normalizeUser);
    const posts = unwrapCollection(payload, ['posts']).map(normalizePost);
    if (users.length || posts.length) {
      return { users, posts };
    }
  } catch (err) {
    if (err && err.status && err.status !== 404 && err.status !== 405 && err.status !== 422) {
      throw err;
    }
  }

  const [suggestionsPayload, feedPayload] = await Promise.all([
    requestWithFallbacks([{ url: '/suggestions', init: { headers: authHeaders(token) } }]).catch(() => []),
    fetchFeed('for_you', token).catch(() => []),
  ]);

  const suggestions = safeArray(Array.isArray(suggestionsPayload) ? suggestionsPayload : suggestionsPayload.items || suggestionsPayload);
  const users = suggestions
    .map((item) => normalizeUser({
      username: item.handle ? String(item.handle).replace(/^@/, '') : item.name,
      display_name: item.name,
      handle: item.handle,
      bio: item.bio,
      avatar_seed: item.avatar_seed || getAvatarSeed(item.name, item.handle),
    }))
    .filter((user) => {
      const needle = q.toLowerCase();
      return user.display_name.toLowerCase().includes(needle) || user.handle.toLowerCase().includes(needle) || user.username.toLowerCase().includes(needle);
    });

  const posts = feedPayload
    .map((item) => normalizePost(item))
    .filter((post) => {
      const needle = q.toLowerCase();
      return post.content.toLowerCase().includes(needle) || post.author.display_name.toLowerCase().includes(needle) || post.author.username.toLowerCase().includes(needle);
    });

  return { users, posts };
}

export async function fetchSuggestions(token = currentToken()) {
  const payload = await requestWithFallbacks([
    { url: '/suggestions', init: { headers: authHeaders(token) } },
    { url: `${API_ROOT}/suggestions`, init: { headers: authHeaders(token) } },
  ]).catch(() => []);

  const items = safeArray(Array.isArray(payload) ? payload : payload.items || payload);
  return items.map((item) => normalizeUser({
    username: item.handle ? String(item.handle).replace(/^@/, '') : item.name,
    display_name: item.name,
    handle: item.handle,
    bio: item.bio,
    avatar_seed: item.avatar_seed,
    avatar_url: item.avatar_url,
  }));
}

export async function legacyFeedSearch(username) {
  const posts = await fetchFeed('for_you').catch(() => []);
  const needle = toText(username).trim().toLowerCase();
  return posts.map((item) => normalizePost(item)).filter((post) => post.author.username.toLowerCase() === needle);
}
