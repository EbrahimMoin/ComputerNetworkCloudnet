import {
  escapeHtml,
  formatCount,
  getAvatarSeed,
  normalizeHandle,
  normalizeTextBlocks,
  resolveAvatarUrl,
  safeArray,
  timeAgo,
  truncate,
} from './utils.js';

function coalesce(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return '';
}

export function normalizeUser(raw = {}) {
  const username = coalesce(raw.username, raw.handle && String(raw.handle).replace(/^@/, ''), raw.name, 'guest');
  const displayName = coalesce(raw.display_name, raw.displayName, raw.name, username);
  const handle = normalizeHandle(coalesce(raw.handle, `@${username}`));
  return {
    ...raw,
    username,
    display_name: displayName,
    handle,
    bio: coalesce(raw.bio, ''),
    avatar_seed: coalesce(raw.avatar_seed, raw.avatarSeed, getAvatarSeed(username, displayName)),
    avatar_url: coalesce(raw.avatar_url, raw.avatarUrl, resolveAvatarUrl({ ...raw, username, display_name: displayName })),
    is_followed: Boolean(raw.is_followed ?? raw.isFollowed ?? raw.viewer_has_followed ?? raw.following),
    follower_count: Number(coalesce(raw.follower_count, raw.followers_count, raw.followers, 0)) || 0,
    following_count: Number(coalesce(raw.following_count, raw.following, 0)) || 0,
    post_count: Number(coalesce(raw.post_count, raw.posts_count, raw.posts, 0)) || 0,
  };
}

export function normalizeComment(raw = {}) {
  const author = normalizeUser(raw.author || raw.user || {});
  const username = coalesce(raw.username, author.username);
  return {
    ...raw,
    id: coalesce(raw.id, raw.comment_id, `${username}-${raw.created_at || Date.now()}`),
    content: coalesce(raw.content, raw.text, ''),
    created_at: coalesce(raw.created_at, raw.timestamp, null),
    author,
  };
}

export function normalizePost(raw = {}) {
  const author = normalizeUser(
    raw.author || raw.user || {
      username: raw.username,
      display_name: raw.display_name || raw.name || raw.username,
      avatar_seed: raw.avatar_seed,
      avatar_url: raw.avatar_url,
      bio: raw.bio,
      is_followed: raw.is_followed,
    },
  );

  const imageUrl = coalesce(raw.image_url, raw.imageUrl, raw.image, raw.image_filename, raw.media_url);
  const comments = safeArray(raw.comments).map(normalizeComment);

  return {
    ...raw,
    id: coalesce(raw.id, raw.post_id, raw.tweet_id, `${author.username}-${raw.created_at || Date.now()}`),
    content: coalesce(raw.content, raw.text, raw.message, ''),
    created_at: coalesce(raw.created_at, raw.createdAt, raw.timestamp, null),
    image_url: imageUrl || '',
    author,
    like_count: Number(coalesce(raw.like_count, raw.likes, raw.upvotes, 0)) || 0,
    comment_count: Number(coalesce(raw.comment_count, raw.comments_count, comments.length, 0)) || 0,
    viewer_has_liked: Boolean(raw.viewer_has_liked ?? raw.liked ?? raw.liked_by_viewer),
    viewer_has_commented: Boolean(raw.viewer_has_commented ?? raw.commented_by_viewer),
    comments,
    unread: Boolean(raw.unread),
    type: coalesce(raw.type, raw.notification_type, ''),
    excerpt: coalesce(raw.excerpt, raw.summary, ''),
    read_at: coalesce(raw.read_at, raw.readAt, null),
    post_id: coalesce(raw.post_id, raw.postId, raw.post, null),
    comment_id: coalesce(raw.comment_id, raw.commentId, null),
  };
}

export function normalizeNotification(raw = {}) {
  const item = normalizePost(raw);
  item.type = coalesce(raw.type, raw.notification_type, item.type, 'mention');
  item.actor = normalizeUser(raw.actor || raw.from_user || raw.user || item.author);
  item.read_at = coalesce(raw.read_at, raw.readAt, null);
  item.post_id = coalesce(raw.post_id, raw.postId, null);
  item.comment_id = coalesce(raw.comment_id, raw.commentId, null);
  item.excerpt = coalesce(raw.excerpt, raw.summary, truncate(item.content || '', 110));
  item.unread = Boolean(raw.unread ?? raw.read_at == null);
  return item;
}

export function normalizeSearchResults(raw = {}) {
  const users = safeArray(raw.users || raw.people || raw.accounts || raw.results?.users || []);
  const posts = safeArray(raw.posts || raw.results?.posts || raw.items || []);

  if (Array.isArray(raw)) {
    return {
      users: raw.filter((item) => item.kind === 'user' || item.type === 'user').map(normalizeUser),
      posts: raw.filter((item) => item.kind === 'post' || item.type === 'post').map(normalizePost),
    };
  }

  return {
    users: users.map(normalizeUser),
    posts: posts.map(normalizePost),
  };
}

function iconLike() {
  return `<svg viewBox="0 0 24 24"><path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" stroke="currentColor" stroke-width="1.8" fill="currentColor" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
}

function iconComment() {
  return `<svg viewBox="0 0 24 24"><path d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
}

function iconShare() {
  return `<svg viewBox="0 0 24 24"><path d="M4 12v6a2 2 0 002 2h12a2 2 0 002-2v-6M16 6l-4-4m0 0L8 6m4-4v14" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
}

function iconDelete() {
  return `<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m-8 0h8m-8 0l1 14h6l1-14" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
}

function iconFollow() {
  return `<svg viewBox="0 0 24 24"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
}

function iconNotification(type) {
  if (type === 'follow') {
    return iconFollow();
  }
  if (type === 'comment') {
    return iconComment();
  }
  if (type === 'mention') {
    return `<svg viewBox="0 0 24 24"><path d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" /></svg>`;
  }
  return iconLike();
}

export function renderEmptyState(title, body, actionHtml = '') {
  return `
    <div class="empty-feed reveal visible">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(body)}</p>
      ${actionHtml ? `<div style="margin-top:16px;">${actionHtml}</div>` : ''}
    </div>
  `;
}

export function renderPostCard(rawPost, options = {}) {
  const post = normalizePost(rawPost);
  const viewer = options.viewer || null;
  const isAuthor = Boolean(viewer && viewer.username && post.author.username === viewer.username);
  const canFollow = Boolean(
    options.allowFollow !== false &&
      viewer &&
      viewer.username &&
      post.author.username &&
      post.author.username !== viewer.username,
  );
  const likedClass = post.viewer_has_liked ? ' active' : '';
  const followText = post.author.is_followed ? 'Following' : 'Follow';
  const imageMarkup = post.image_url
    ? `
      <div class="post-media">
        <img
          src="${escapeHtml(post.image_url)}"
          alt=""
          data-lightbox-src="${escapeHtml(post.image_url)}"
          style="width:100%;max-height:420px;object-fit:cover;border-radius:18px;cursor:zoom-in;border:1px solid var(--border);"
        />
      </div>
    `
    : '';

  const actionAttrs = options.isGuest ? ' disabled aria-disabled="true" title="Sign in to interact"' : '';

  return `
    <article class="post-card reveal" data-post-id="${escapeHtml(post.id)}" data-post-author="${escapeHtml(post.author.username)}">
      <div class="post-card-inner">
        <button
          class="avatar avatar--md post-avatar-link"
          type="button"
          aria-label="Open ${escapeHtml(post.author.display_name)} profile"
          data-open-profile="${escapeHtml(post.author.username)}"
          data-avatar-url="${escapeHtml(resolveAvatarUrl(post.author))}"
        ></button>
        <div class="post-body">
          <div class="post-meta">
            <button class="display-name post-author-link" type="button" data-open-profile="${escapeHtml(post.author.username)}">
              ${escapeHtml(post.author.display_name)}
            </button>
            <span class="handle">${escapeHtml(post.author.handle)}</span>
            <span class="dot">·</span>
            <span class="timestamp">${escapeHtml(timeAgo(post.created_at))}</span>
            ${canFollow ? `
              <button class="action-btn action-follow" type="button" data-action="follow" data-username="${escapeHtml(post.author.username)}"${actionAttrs}>
                ${iconFollow()}<span>${escapeHtml(followText)}</span>
              </button>
            ` : ''}
            ${isAuthor ? `
              <button class="action-btn action-delete" type="button" data-action="delete" data-post-id="${escapeHtml(post.id)}">
                ${iconDelete()}<span>Delete</span>
              </button>
            ` : ''}
          </div>
          <div class="post-text">${normalizeTextBlocks(post.content || '')}</div>
          ${imageMarkup}
          <div class="post-actions">
            <button class="action-btn action-like${likedClass}" type="button" data-action="like" data-post-id="${escapeHtml(post.id)}"${actionAttrs}>
              ${iconLike()}<span>${escapeHtml(formatCount(post.like_count))}</span>
            </button>
            <button class="action-btn action-comment" type="button" data-action="comment" data-post-id="${escapeHtml(post.id)}"${actionAttrs}>
              ${iconComment()}<span>${escapeHtml(formatCount(post.comment_count))}</span>
            </button>
            <button class="action-btn action-repost" type="button" data-action="share" data-post-id="${escapeHtml(post.id)}">
              ${iconShare()}<span>Share</span>
            </button>
          </div>
          <div class="post-comments" data-comments-for="${escapeHtml(post.id)}" hidden
               style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border-subtle);display:grid;gap:12px;"></div>
        </div>
      </div>
    </article>
  `;
}

export function renderCommentItem(rawComment) {
  const comment = normalizeComment(rawComment);
  return `
    <div class="comment-item" style="display:flex;gap:10px;align-items:flex-start;">
      <div class="avatar avatar--sm" data-avatar-url="${escapeHtml(resolveAvatarUrl(comment.author))}"></div>
      <div style="min-width:0;flex:1;">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <strong style="font-size:.88rem;">${escapeHtml(comment.author.display_name)}</strong>
          <span class="handle">${escapeHtml(comment.author.handle)}</span>
          <span class="timestamp">${escapeHtml(timeAgo(comment.created_at))}</span>
        </div>
        <div style="margin-top:4px;color:var(--text-primary);font-size:.9rem;line-height:1.5;">${normalizeTextBlocks(comment.content || '')}</div>
      </div>
    </div>
  `;
}

export function renderCommentComposer(postId, isGuest = false) {
  if (isGuest) {
    return `
      <div style="padding:12px 14px;border:1px solid var(--border);border-radius:16px;background:var(--bg-tertiary);color:var(--text-secondary);font-size:.9rem;">
        Sign in to reply to this post.
      </div>
    `;
  }

  return `
    <form class="comment-form" data-comment-form="${escapeHtml(postId)}" style="display:grid;gap:10px;">
      <textarea
        class="comment-input"
        name="content"
        rows="3"
        maxlength="500"
        placeholder="Write a reply..."
        style="width:100%;resize:vertical;padding:12px 14px;border-radius:14px;background:var(--bg-tertiary);border:1px solid var(--border);color:var(--text-primary);font:inherit;line-height:1.5;outline:none;"
      ></textarea>
      <div style="display:flex;justify-content:flex-end;">
        <button class="btn-primary" type="submit" style="padding:10px 18px;">Reply</button>
      </div>
    </form>
  `;
}

export function renderNotificationItem(rawItem) {
  const item = normalizeNotification(rawItem);
  const unreadClass = item.unread ? ' unread' : '';
  const type = item.type || 'mention';
  const actorName = item.actor.display_name || item.actor.username;
  const text = item.excerpt
    ? escapeHtml(item.excerpt)
    : type === 'follow'
      ? `${escapeHtml(actorName)} followed you`
      : type === 'comment'
        ? `${escapeHtml(actorName)} commented on your post`
        : type === 'like'
          ? `${escapeHtml(actorName)} liked your post`
          : `${escapeHtml(actorName)} mentioned you`;

  return `
    <div class="notification-item${unreadClass}" data-notification-id="${escapeHtml(item.id)}"
         data-open-profile="${escapeHtml(item.actor.username)}"
         ${item.post_id ? `data-open-post="${escapeHtml(item.post_id)}"` : ''}>
      <div class="notification-icon ${escapeHtml(type)}">
        ${iconNotification(type)}
      </div>
      <div class="notification-content">
        <div class="notification-text">
          <strong>${escapeHtml(actorName)}</strong>
          ${type === 'follow' ? ' followed you' : type === 'like' ? ' liked your post' : type === 'comment' ? ' commented on your post' : ' mentioned you'}
          ${item.excerpt ? ` · ${text}` : ''}
        </div>
        <div class="notification-time">${escapeHtml(timeAgo(item.created_at))}</div>
      </div>
    </div>
  `;
}

export function renderFollowCard(rawUser, options = {}) {
  const user = normalizeUser(rawUser);
  const isSelf = Boolean(options.viewer && options.viewer.username === user.username);
  const actionLabel = user.is_followed ? 'Following' : 'Follow';
  return `
    <div class="follow-item" data-username="${escapeHtml(user.username)}" style="display:flex;gap:10px;align-items:center;padding:10px 0;">
      <button class="avatar avatar--md" type="button" data-open-profile="${escapeHtml(user.username)}" data-avatar-url="${escapeHtml(resolveAvatarUrl(user))}"></button>
      <div style="min-width:0;flex:1;">
        <button type="button" class="display-name" data-open-profile="${escapeHtml(user.username)}" style="display:block;text-align:left;font-weight:700;">
          ${escapeHtml(user.display_name)}
        </button>
        <div class="handle">${escapeHtml(user.handle)}</div>
        ${user.bio ? `<div style="margin-top:4px;color:var(--text-secondary);font-size:.85rem;line-height:1.4;">${escapeHtml(user.bio)}</div>` : ''}
      </div>
      ${!isSelf ? `
        <button class="btn-primary" type="button" data-action="follow" data-username="${escapeHtml(user.username)}" style="padding:8px 14px;min-width:92px;">
          ${escapeHtml(actionLabel)}
        </button>
      ` : ''}
    </div>
  `;
}

export function renderSearchPanel(results = {}, query = '') {
  const users = safeArray(results.users).map(normalizeUser);
  const posts = safeArray(results.posts).map(normalizePost);

  if (!query.trim()) {
    return '';
  }

  if (!users.length && !posts.length) {
    return `
      <div class="search-results-empty" style="padding:14px;border:1px solid var(--border);border-radius:18px;background:var(--bg-secondary);box-shadow:var(--shadow-md);">
        <div style="font-weight:700;margin-bottom:4px;">No results</div>
        <div style="color:var(--text-secondary);font-size:.9rem;">Try a different search term.</div>
      </div>
    `;
  }

  const userMarkup = users
    .map((user) => `
      <button type="button" class="search-result-item" data-open-profile="${escapeHtml(user.username)}"
              style="display:flex;gap:10px;align-items:center;width:100%;text-align:left;padding:10px 0;border-bottom:1px solid var(--border-subtle);">
        <div class="avatar avatar--sm" data-avatar-url="${escapeHtml(resolveAvatarUrl(user))}"></div>
        <div style="min-width:0;flex:1;">
          <div style="font-weight:700;">${escapeHtml(user.display_name)}</div>
          <div class="handle">${escapeHtml(user.handle)}</div>
        </div>
      </button>
    `)
    .join('');

  const postMarkup = posts
    .map((post) => `
      <button type="button" class="search-result-item" data-open-post="${escapeHtml(post.id)}"
              style="display:block;width:100%;text-align:left;padding:10px 0;border-bottom:1px solid var(--border-subtle);">
        <div style="font-size:.82rem;color:var(--text-tertiary);margin-bottom:3px;">Post by ${escapeHtml(post.author.display_name)} · ${escapeHtml(timeAgo(post.created_at))}</div>
        <div style="font-size:.9rem;line-height:1.45;color:var(--text-primary);">${escapeHtml(truncate(post.content, 120))}</div>
      </button>
    `)
    .join('');

  return `
    <div class="search-results-panel" style="margin-top:12px;padding:14px;border:1px solid var(--border);border-radius:18px;background:var(--bg-secondary);box-shadow:var(--shadow-md);display:grid;gap:12px;">
      ${users.length ? `<div><div style="font-size:.75rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:8px;">People</div>${userMarkup}</div>` : ''}
      ${posts.length ? `<div><div style="font-size:.75rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:8px;">Posts</div>${postMarkup}</div>` : ''}
    </div>
  `;
}

export function renderFeedSkeleton(count = 3) {
  return Array.from({ length: count }).map(() => `
    <div class="skeleton-card">
      <div class="skeleton-avatar"></div>
      <div class="skeleton-body">
        <div class="skeleton-line skeleton-line--name"></div>
        <div class="skeleton-line skeleton-line--text1"></div>
        <div class="skeleton-line skeleton-line--text2"></div>
        <div class="skeleton-line skeleton-line--actions"></div>
      </div>
    </div>
  `).join('');
}
