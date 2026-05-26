const FALLBACK_AVATARS = [
  'cloudnet',
  'maya',
  'devops_dan',
  'priya',
  'jordan',
  'sarah_ops',
  'alex',
  'sam',
  'robin',
  'taylor',
  'morgan',
];

export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function toText(value) {
  return String(value == null ? '' : value);
}

export function slugify(value) {
  return toText(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeHandle(handle) {
  const value = toText(handle).trim();
  if (!value) {
    return '';
  }
  return value.startsWith('@') ? value : `@${value}`;
}

export function getAvatarSeed(...parts) {
  const joined = parts.filter(Boolean).map(toText).join('|').trim() || 'cloudnet';
  let hash = 0;
  for (let i = 0; i < joined.length; i += 1) {
    hash = joined.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return FALLBACK_AVATARS[Math.abs(hash) % FALLBACK_AVATARS.length];
}

export function avatarUrl(seed, size = 96) {
  const value = encodeURIComponent(seed || 'cloudnet');
  return `https://api.dicebear.com/7.x/notionists/svg?seed=${value}&size=${size}`;
}

export function resolveAvatarUrl(user = {}) {
  if (user.avatar_url) {
    return toText(user.avatar_url);
  }
  if (user.avatarUrl) {
    return toText(user.avatarUrl);
  }
  const seed = user.avatar_seed || user.avatarSeed || getAvatarSeed(user.username, user.display_name, user.name);
  return avatarUrl(seed);
}

export function timeAgo(value) {
  if (!value) {
    return '';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  const seconds = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 1000));
  if (seconds < 10) return 'Just now';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatCount(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) {
    return '0';
  }
  if (number < 1000) {
    return String(Math.round(number));
  }
  if (number < 1000000) {
    const compact = (number / 1000).toFixed(1).replace(/\.0$/, '');
    return `${compact}k`;
  }
  const compact = (number / 1000000).toFixed(1).replace(/\.0$/, '');
  return `${compact}m`;
}

export function truncate(value, maxLength = 120) {
  const text = toText(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function debounce(fn, delay = 250) {
  let timer = null;
  return (...args) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function cssImageUrl(url) {
  return toText(url).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function normalizeTextBlocks(text) {
  return escapeHtml(toText(text))
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, '<br />')}</p>`)
    .join('');
}
