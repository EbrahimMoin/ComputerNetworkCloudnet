import {
  addComment,
  clearStoredToken,
  createPost,
  currentToken,
  deletePost,
  fetchComments,
  fetchFeed,
  fetchNotifications,
  fetchProfile,
  fetchProfilePosts,
  fetchSuggestions,
  getSession,
  login,
  markNotificationsRead,
  search,
  signup,
  storeToken,
  toggleFollow,
  toggleLike,
} from './api.js';
import {
  formatCount,
  resolveAvatarUrl,
  safeArray,
  debounce,
  toText,
} from './utils.js';
import {
  normalizeComment,
  normalizePost,
  normalizeNotification,
  normalizeUser,
  renderCommentComposer,
  renderCommentItem,
  renderEmptyState,
  renderFeedSkeleton,
  renderFollowCard,
  renderNotificationItem,
  renderPostCard,
  renderSearchPanel,
} from './render.js';

const state = {
  token: currentToken(),
  session: null,
  guest: false,
  view: 'home',
  feedScope: 'for_you',
  notifFilter: 'all',
  profileUsername: '',
  feedCache: new Map(),
  notifications: [],
  suggestions: [],
  commentsByPost: new Map(),
  profileData: null,
  composerImageFile: null,
};

const refs = {};

const FEED_SCOPE_MAP = {
  'for-you': 'for_you',
  for_you: 'for_you',
  following: 'following',
  trending: 'trending',
};

function el(id) {
  return document.getElementById(id);
}

function normalizeFeedScope(scope) {
  const value = toText(scope).trim().toLowerCase();
  return FEED_SCOPE_MAP[value] || 'for_you';
}

function feedScopeToViewId(scope) {
  const normalized = normalizeFeedScope(scope);
  return normalized === 'for_you' ? 'tab-for-you-view' : `tab-${normalized}-view`;
}

function setVisible(node, visible) {
  if (!node) return;
  node.style.display = visible ? '' : 'none';
}

function setDisabled(node, disabled, title = '') {
  if (!node) return;
  node.disabled = disabled;
  node.style.pointerEvents = disabled ? 'none' : '';
  node.style.opacity = disabled ? '0.5' : '';
  if (title) node.title = title;
}

function isGuestMode() {
  return !state.session && state.guest;
}

function viewer() {
  return state.session ? normalizeUser(state.session) : null;
}

function toast(message, kind = 'success') {
  if (!refs.toast || !refs.toastMessage) return;
  refs.toast.className = `toast ${kind}`;
  refs.toastMessage.textContent = message;
  refs.toast.classList.add('show');
  if (refs.toastProgress) {
    refs.toastProgress.style.transition = 'none';
    refs.toastProgress.style.width = '100%';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        refs.toastProgress.style.transition = 'width 3s linear';
        refs.toastProgress.style.width = '0%';
      });
    });
  }
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    refs.toast?.classList.remove('show');
  }, 3000);
}

function setTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  try {
    localStorage.setItem('cloudnet_theme', theme);
  } catch {
    // ignore
  }
  const icon = el('theme-icon');
  if (icon) {
    icon.innerHTML = theme === 'light'
      ? '<path d="M12 2a.75.75 0 01.75.75V5a.75.75 0 01-1.5 0V2.75A.75.75 0 0112 2zm0 17a.75.75 0 01.75.75V22a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 19zm10-7.25H19.75a.75.75 0 010-1.5H22a.75.75 0 010 1.5zM5 12a.75.75 0 01-.75.75H2a.75.75 0 010-1.5h2.25A.75.75 0 015 12zm13.364 6.364a.75.75 0 01-1.06 0l-1.591-1.591a.75.75 0 111.06-1.06l1.591 1.591a.75.75 0 010 1.06zM8.287 8.287a.75.75 0 01-1.06 0L5.636 6.696a.75.75 0 111.06-1.06l1.591 1.591a.75.75 0 010 1.06zm9.424-1.591a.75.75 0 010 1.06l-1.591 1.591a.75.75 0 11-1.06-1.06l1.591-1.591a.75.75 0 011.06 0zM8.287 15.713a.75.75 0 010 1.06L6.696 18.364a.75.75 0 11-1.06-1.06l1.591-1.591a.75.75 0 011.06 0zM12 7a5 5 0 100 10 5 5 0 000-10z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" />'
      : '<path d="M21 12.8A8.5 8.5 0 1111.2 3a6.75 6.75 0 109.8 9.8z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" />';
  }
  if (refs.themeToggle) {
    refs.themeToggle.setAttribute('aria-pressed', String(theme === 'light'));
    refs.themeToggle.setAttribute('title', theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
  }
}

function installThemeToggle() {
  refs.themeToggle?.addEventListener('click', (event) => {
    event.preventDefault();
    const nextTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
  });
}

function hydrateAvatars(scope = document) {
  scope.querySelectorAll('[data-avatar-url]').forEach((node) => {
    const avatar = node.getAttribute('data-avatar-url');
    if (avatar) {
      node.style.backgroundImage = `url("${avatar.replace(/"/g, '%22')}")`;
    }
  });
}

function observeReveals(scope = document) {
  const nodes = scope.querySelectorAll('.reveal:not(.visible)');
  if (!('IntersectionObserver' in window)) {
    nodes.forEach((node) => node.classList.add('visible'));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });
  nodes.forEach((node) => observer.observe(node));
}

function showView(name) {
  state.view = name;
  setVisible(refs.homeView, name === 'home');
  setVisible(refs.notificationsView, name === 'notifications');
  setVisible(refs.profileView, name === 'profile');
  document.querySelectorAll('.nav-link, .mobile-nav-btn').forEach((node) => {
    const nav = node.dataset.nav || node.id?.replace(/^nav-/, '');
    node.classList.toggle('active', nav === name || (name === 'home' && nav === 'home'));
  });
}

function pickColor(seed) {
  const colors = ['#2997ff', '#bf5af2', '#30d158', '#ff9f0a', '#ff453a', '#64d2ff'];
  let hash = 0;
  const text = toText(seed);
  for (let i = 0; i < text.length; i += 1) {
    hash = text.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

function renderFeed(items, scope = state.feedScope) {
  if (!refs.postsContainer) return;
  if (!items.length) {
    refs.postsContainer.innerHTML = scope === 'following'
      ? renderEmptyState('Nothing from people you follow yet', isGuestMode() ? 'Sign in to follow people and unlock this feed.' : 'Follow a few accounts to see their posts here.', isGuestMode() ? '<button class="btn-primary" type="button" data-open-auth="true">Sign in</button>' : '')
      : scope === 'trending'
        ? renderEmptyState('Trending is warming up', 'Check back soon for the most active posts across the network.')
        : renderEmptyState('No posts yet', isGuestMode() ? 'Sign in to post and follow people, or browse as a guest.' : 'Be the first to start the conversation.', isGuestMode() ? '<button class="btn-primary" type="button" data-open-auth="true">Sign in</button>' : '');
    hydrateAvatars(refs.postsContainer);
    observeReveals(refs.postsContainer);
    return;
  }
  refs.postsContainer.innerHTML = items.map((post) => renderPostCard(post, { viewer: viewer(), isGuest: isGuestMode() })).join('');
  hydrateAvatars(refs.postsContainer);
  observeReveals(refs.postsContainer);
}

function renderNotifications(items) {
  if (!refs.notificationList) return;
  if (!items.length) {
    refs.notificationList.innerHTML = renderEmptyState('No notifications yet', 'Notifications will appear here when people interact with your posts or mention you.');
    observeReveals(refs.notificationList);
    return;
  }
  refs.notificationList.innerHTML = items.map((item) => renderNotificationItem(item)).join('');
  hydrateAvatars(refs.notificationList);
  observeReveals(refs.notificationList);
}

function renderSuggestions(items) {
  if (!refs.followList) return;
  refs.followList.innerHTML = items.length
    ? items.slice(0, 5).map((item) => renderFollowCard(item, { viewer: viewer() })).join('')
    : renderEmptyState('No suggestions', 'Search for people or check back later.');
  hydrateAvatars(refs.followList);
}

function renderProfile(profile) {
  const user = normalizeUser(profile);
  state.profileData = user;
  refs.profileTitle.textContent = user.display_name || user.username;
  refs.profileSubtitle.textContent = user.bio || `@${user.username}`;
  refs.profileDisplayName.textContent = user.display_name || user.username;
  refs.profileHandle.textContent = user.handle;
  refs.profileBio.textContent = user.bio || 'This member has not added a bio yet.';
  refs.profilePostCount.textContent = formatCount(user.post_count || 0);
  refs.profileFollowerCount.textContent = formatCount(user.follower_count || 0);
  refs.profileFollowingCount.textContent = formatCount(user.following_count || 0);
  const avatar = resolveAvatarUrl(user);
  refs.profileAvatar.setAttribute('data-avatar-url', avatar);
  refs.profileAvatar.style.backgroundImage = `url("${avatar.replace(/"/g, '%22')}")`;
  refs.profileBanner.style.background = `linear-gradient(135deg, ${pickColor(user.username)} 0%, ${pickColor(`${user.username}-2`)} 100%)`;
  refs.profileFollowBtn.hidden = !user.username || (viewer() && viewer().username === user.username);
  refs.profileFollowBtn.textContent = user.is_followed ? 'Following' : 'Follow';
  refs.profileFollowBtn.dataset.username = user.username;
  refs.profileFollowBtn.dataset.following = String(Boolean(user.is_followed));
  refs.profileFollowBtn.disabled = isGuestMode();
}

function renderCommentSection(postId) {
  const comments = state.commentsByPost.get(String(postId)) || [];
  return `
    <div style="display:grid;gap:12px;">
      <div style="display:grid;gap:12px;">
        ${comments.length ? comments.map((comment) => renderCommentItem(comment)).join('') : '<div style="color:var(--text-secondary);font-size:.9rem;">Be the first to reply.</div>'}
      </div>
      ${renderCommentComposer(postId, isGuestMode())}
    </div>
  `;
}

function escapeSelector(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(String(value));
  }
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

async function loadFeed(scope = state.feedScope, force = false) {
  const normalizedScope = normalizeFeedScope(scope);
  state.feedScope = normalizedScope;
  if (refs.homeHeaderTitle) {
    refs.homeHeaderTitle.textContent = normalizedScope === 'following' ? 'Following' : normalizedScope === 'trending' ? 'Trending' : 'Home';
  }
  document.querySelectorAll('#home-view .feed-tabs .tab').forEach((tab) => {
    const active = tab.dataset.view === feedScopeToViewId(normalizedScope);
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  if (!force && state.feedCache.has(normalizedScope)) {
    renderFeed(state.feedCache.get(normalizedScope), normalizedScope);
    return;
  }
  refs.postsContainer.innerHTML = renderFeedSkeleton(3);
  try {
    const raw = await fetchFeed(normalizedScope, state.token);
    const items = safeArray(raw).map((item) => normalizePost(item));
    state.feedCache.set(normalizedScope, items);
    renderFeed(items, normalizedScope);
  } catch (err) {
    refs.postsContainer.innerHTML = renderEmptyState('Unable to load posts', err && err.message ? err.message : 'Please try again in a moment.', '<button class="btn-primary" type="button" data-action="retry-feed">Retry</button>');
  }
}

async function loadNotifications(filter = state.notifFilter, force = false) {
  state.notifFilter = filter;
  showView('notifications');
  document.querySelectorAll('#notifications-view .feed-tabs .tab').forEach((tab) => {
    const active = tab.dataset.notifFilter === filter;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  if (!force && state.notifications.length) {
    renderNotifications(filter === 'mentions' ? state.notifications.filter((item) => item.type === 'mention') : state.notifications);
    return;
  }
  refs.notificationList.innerHTML = renderFeedSkeleton(2);
  try {
    const raw = await fetchNotifications(filter, state.token);
    const items = safeArray(raw).map((item) => normalizeNotification(item));
    state.notifications = items;
    renderNotifications(filter === 'mentions' ? items.filter((item) => item.type === 'mention') : items);
    updateNotificationBadge(items.filter((item) => item.unread).length);
  } catch (err) {
    refs.notificationList.innerHTML = renderEmptyState('Notifications unavailable', err && err.message ? err.message : 'Please try again later.');
  }
}

function updateNotificationBadge(count) {
  const value = Number(count || 0);
  const badge = el('notif-badge');
  const mobileBadge = document.querySelector('.mobile-badge');
  if (badge) {
    badge.textContent = value > 99 ? '99+' : String(value);
    badge.style.display = value > 0 ? '' : 'none';
  }
  if (mobileBadge) {
    mobileBadge.textContent = value > 99 ? '99+' : String(value);
    mobileBadge.style.display = value > 0 ? '' : 'none';
  }
}

async function loadSuggestions(force = false) {
  if (!force && state.suggestions.length) {
    renderSuggestions(state.suggestions);
    return;
  }
  try {
    const items = await fetchSuggestions(state.token);
    state.suggestions = items;
    renderSuggestions(items);
  } catch {
    renderSuggestions([]);
  }
}

async function loadProfile(username, force = false) {
  const handle = toText(username).replace(/^@/, '').trim();
  if (!handle) return;
  state.profileUsername = handle;
  showView('profile');
  refs.profilePosts.innerHTML = renderFeedSkeleton(2);
  try {
    const [profile, posts] = await Promise.all([
      fetchProfile(handle, state.token).catch(() => ({
        username: handle,
        display_name: handle,
        handle: `@${handle}`,
        bio: '',
        post_count: 0,
        follower_count: 0,
        following_count: 0,
        is_followed: false,
      })),
      fetchProfilePosts(handle, state.token).catch(() => []),
    ]);
    renderProfile(profile);
    const items = safeArray(posts).map((post) => normalizePost(post));
    refs.profilePosts.innerHTML = items.length
      ? items.map((post) => renderPostCard(post, { viewer: viewer(), isGuest: isGuestMode() })).join('')
      : renderEmptyState('No posts yet', 'This profile has not shared anything yet.');
    hydrateAvatars(refs.profilePosts);
    observeReveals(refs.profilePosts);
  } catch (err) {
    refs.profilePosts.innerHTML = renderEmptyState('Profile unavailable', err && err.message ? err.message : 'Please try again later.');
  }
}

async function openPostById(postId) {
  showView('home');
  await loadFeed('for_you', false);
  let node = refs.postsContainer?.querySelector(`[data-post-id="${escapeSelector(postId)}"]`);
  if (!node) {
    await loadFeed('for_you', true);
    node = refs.postsContainer?.querySelector(`[data-post-id="${escapeSelector(postId)}"]`);
  }
  if (node) {
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.style.outline = '2px solid var(--accent-blue)';
    node.style.outlineOffset = '4px';
    window.setTimeout(() => {
      node.style.outline = '';
      node.style.outlineOffset = '';
    }, 1800);
  }
}

function setComposerState() {
  const guest = isGuestMode();
  if (refs.composerInput) {
    refs.composerInput.contentEditable = String(!guest);
    refs.composerInput.setAttribute('aria-disabled', String(guest));
  }
  setDisabled(refs.btnPost, guest, guest ? 'Sign in to post' : '');
  setDisabled(refs.btnMedia, guest, guest ? 'Sign in to add media' : '');
  setDisabled(refs.btnEmoji, guest, guest ? 'Sign in to use emoji' : '');
  setDisabled(refs.btnPoll, true, 'Polls are not available yet');
  setDisabled(refs.btnAddThread, true, 'Threads are not available yet');
  if (refs.modalUsername) {
    refs.modalUsername.value = state.session?.display_name || state.session?.username || '';
    refs.modalUsername.disabled = guest;
  }
  const avatar = resolveAvatarUrl(state.session || { username: 'cloudnet' });
  if (refs.composerAvatar) {
    refs.composerAvatar.setAttribute('data-avatar-url', avatar);
    refs.composerAvatar.style.backgroundImage = `url("${avatar.replace(/"/g, '%22')}")`;
  }
  if (refs.sidebarAvatar) {
    refs.sidebarAvatar.setAttribute('data-avatar-url', avatar);
    refs.sidebarAvatar.style.backgroundImage = `url("${avatar.replace(/"/g, '%22')}")`;
  }
  if (guest && refs.composer && !refs.guestCta) {
    const banner = document.createElement('div');
    banner.id = 'guest-cta';
    banner.style.cssText = 'margin-bottom:14px;padding:12px 14px;border:1px solid var(--border);border-radius:16px;background:var(--bg-tertiary);display:flex;align-items:center;justify-content:space-between;gap:12px;';
    banner.innerHTML = '<div><div style="font-weight:700;color:var(--text-primary);">Browse-only mode</div><div style="font-size:.9rem;color:var(--text-secondary);">Sign in to post, like, comment, and follow.</div></div><button class="btn-primary" type="button" data-open-auth="true" style="padding:10px 16px;">Sign in</button>';
    refs.composer.prepend(banner);
    refs.guestCta = banner;
  }
  if (!guest && refs.guestCta) {
    refs.guestCta.remove();
    refs.guestCta = null;
  }
}

function syncChrome() {
  const session = state.session ? normalizeUser(state.session) : null;
  if (refs.sidebarUserCard) {
    refs.sidebarUserCard.style.display = session ? 'flex' : 'none';
  }
  if (session) {
    refs.sidebarName.textContent = session.display_name;
    refs.sidebarHandle.textContent = session.handle;
  }
  setComposerState();
  updateNotificationBadge(state.notifications.filter((item) => item.unread).length);
}

function openAuth() {
  if (refs.authOverlay) {
    refs.authOverlay.style.display = 'flex';
    refs.authOverlay.style.opacity = '1';
  }
  setAuthMode('login');
}

function closeAuth() {
  if (refs.authOverlay) {
    refs.authOverlay.style.display = 'none';
  }
}

function setAuthMode(mode) {
  const loginActive = mode === 'login';
  if (refs.tabLogin) {
    refs.tabLogin.style.background = loginActive ? 'var(--bg-elevated)' : 'transparent';
    refs.tabLogin.style.color = loginActive ? 'var(--text-primary)' : 'var(--text-secondary)';
  }
  if (refs.tabSignup) {
    refs.tabSignup.style.background = loginActive ? 'transparent' : 'var(--bg-elevated)';
    refs.tabSignup.style.color = loginActive ? 'var(--text-secondary)' : 'var(--text-primary)';
  }
  setVisible(refs.formLogin, loginActive);
  setVisible(refs.formSignup, !loginActive);
}

function enableGuestMode() {
  state.guest = true;
  state.session = null;
  closeAuth();
  syncChrome();
  loadFeed(state.feedScope, true);
  loadSuggestions(true);
}

async function applySession(user, token) {
  state.session = normalizeUser(user);
  state.guest = false;
  if (token) {
    state.token = token;
    storeToken(token);
  }
  closeAuth();
  syncChrome();
  await Promise.all([loadFeed(state.feedScope, true), loadSuggestions(true)]);
  if (state.session.username) {
    await loadProfile(state.session.username, true);
    showView('home');
  }
}

function clearComposerImage() {
  state.composerImageFile = null;
  if (refs.composerFileInput) refs.composerFileInput.value = '';
  if (refs.composerPreview) refs.composerPreview.classList.remove('active');
  if (refs.composerPreviewImg) refs.composerPreviewImg.removeAttribute('src');
}

function updateComposerImage(file) {
  state.composerImageFile = file || null;
  if (!file) {
    clearComposerImage();
    return;
  }
  const url = URL.createObjectURL(file);
  if (refs.composerPreviewImg) refs.composerPreviewImg.src = url;
  if (refs.composerPreview) refs.composerPreview.classList.add('active');
}

async function submitComposer() {
  const content = toText(refs.composerInput?.innerText || refs.composerInput?.textContent || '').trim();
  if (!content && !state.composerImageFile) {
    toast('Write something before posting.', 'error');
    return;
  }
  if (isGuestMode()) {
    openAuth();
    return;
  }
  setDisabled(refs.btnPost, true);
  try {
    await createPost({ content, imageFile: state.composerImageFile, token: state.token });
    refs.composerInput.innerHTML = '';
    clearComposerImage();
    toast('Post published.');
    await loadFeed(state.feedScope, true);
  } catch (err) {
    toast(err && err.message ? err.message : 'Could not post right now.', 'error');
  } finally {
    setComposerState();
  }
}

async function loadComments(postId) {
  const raw = await fetchComments(postId, state.token).catch(() => []);
  const items = safeArray(raw).map((item) => normalizeComment(item));
  state.commentsByPost.set(String(postId), items);
  return items;
}

async function toggleComments(postId) {
  const section = refs.postsContainer?.querySelector(`[data-comments-for="${escapeSelector(postId)}"]`);
  if (!section) return;
  if (section.hidden) {
    section.hidden = false;
    if (!state.commentsByPost.has(String(postId))) {
      await loadComments(postId);
    }
    section.innerHTML = renderCommentSection(postId);
    hydrateAvatars(section);
  } else {
    section.hidden = true;
  }
}

async function submitComment(postId, form) {
  if (isGuestMode()) {
    openAuth();
    return;
  }
  const input = form.querySelector('.comment-input');
  const value = toText(input?.value || '').trim();
  if (!value) {
    toast('Write a reply first.', 'error');
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  setDisabled(button, true);
  try {
    await addComment(postId, value, state.token);
    await loadComments(postId);
    const section = form.closest('[data-comments-for]');
    if (section) {
      section.innerHTML = renderCommentSection(postId);
      hydrateAvatars(section);
    }
    mutatePost(postId, (post) => {
      post.comment_count = (post.comment_count || 0) + 1;
    });
    rerenderPosts();
    toast('Reply posted.');
  } catch (err) {
    toast(err && err.message ? err.message : 'Could not add comment.', 'error');
  } finally {
    setDisabled(button, false);
  }
}

function mutatePost(postId, updater) {
  const id = String(postId);
  state.feedCache.forEach((posts, scope) => {
    state.feedCache.set(scope, posts.map((post) => {
      if (String(post.id) !== id) return post;
      const next = { ...post };
      updater(next);
      return next;
    }));
  });
}

function mutateAuthor(username, updater) {
  const handle = String(username).replace(/^@/, '');
  state.feedCache.forEach((posts, scope) => {
    state.feedCache.set(scope, posts.map((post) => {
      if (!post.author || post.author.username !== handle) return post;
      const next = { ...post, author: { ...post.author } };
      updater(next.author);
      return next;
    }));
  });
}

function rerenderPosts() {
  renderFeed(state.feedCache.get(state.feedScope) || [], state.feedScope);
}

async function toggleLikeAction(postId) {
  if (isGuestMode()) {
    openAuth();
    return;
  }
  const current = (state.feedCache.get(state.feedScope) || []).find((post) => String(post.id) === String(postId));
  const liked = Boolean(current && current.viewer_has_liked);
  try {
    await toggleLike(postId, liked, state.token);
    mutatePost(postId, (post) => {
      post.viewer_has_liked = !liked;
      post.like_count = Math.max(0, (post.like_count || 0) + (liked ? -1 : 1));
    });
    rerenderPosts();
  } catch (err) {
    toast(err && err.message ? err.message : 'Could not update like.', 'error');
  }
}

async function toggleFollowAction(username) {
  if (isGuestMode()) {
    openAuth();
    return;
  }
  const handle = String(username).replace(/^@/, '');
  const currentProfile = state.profileData && state.profileData.username === handle ? { ...state.profileData } : null;
  const following = Boolean(currentProfile && currentProfile.is_followed);
  try {
    await toggleFollow(handle, following, state.token);
    if (currentProfile) {
      currentProfile.is_followed = !following;
      currentProfile.follower_count = Math.max(0, Number(currentProfile.follower_count || 0) + (following ? -1 : 1));
      renderProfile(currentProfile);
    }
    state.suggestions = state.suggestions.map((item) => (item.username === handle ? { ...item, is_followed: !following } : item));
    renderSuggestions(state.suggestions);
    mutateAuthor(handle, (author) => {
      author.is_followed = !following;
    });
    rerenderPosts();
  } catch (err) {
    toast(err && err.message ? err.message : 'Could not update follow.', 'error');
  }
}

async function deleteSinglePost(postId) {
  if (isGuestMode()) {
    openAuth();
    return;
  }
  try {
    await deletePost(postId, state.token);
    for (const [scope, posts] of state.feedCache.entries()) {
      state.feedCache.set(scope, posts.filter((post) => String(post.id) !== String(postId)));
    }
    rerenderPosts();
    toast('Post deleted.');
  } catch (err) {
    toast(err && err.message ? err.message : 'Could not delete post.', 'error');
  }
}

function openLightbox(src) {
  if (!refs.imageLightbox || !refs.lightboxImg || !src) return;
  refs.lightboxImg.src = src;
  refs.lightboxImg.style.transform = 'scale(1)';
  refs.lightboxScale = 1;
  refs.imageLightbox.classList.add('active');
}

function closeLightbox() {
  refs.imageLightbox?.classList.remove('active');
}

function changeLightbox(delta) {
  refs.lightboxScale = Math.min(3, Math.max(0.5, (refs.lightboxScale || 1) + delta));
  if (refs.lightboxImg) {
    refs.lightboxImg.style.transform = `scale(${refs.lightboxScale})`;
  }
}

async function runSearch(query) {
  const text = toText(query).trim();
  if (!refs.searchResults) return;
  if (!text) {
    refs.searchResults.innerHTML = '';
    refs.searchResults.style.display = 'none';
    return;
  }
  refs.searchResults.style.display = '';
  refs.searchResults.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><div class="loading-text">Searching</div></div>';
  try {
    const results = await search(text, state.token);
    refs.searchResults.innerHTML = renderSearchPanel(results, text);
    hydrateAvatars(refs.searchResults);
  } catch (err) {
    refs.searchResults.innerHTML = renderEmptyState('Search unavailable', err && err.message ? err.message : 'Please try again later.');
  }
}

function installDelegates() {
  document.addEventListener('click', async (event) => {
    const openAuth = event.target.closest('[data-open-auth="true"]');
    if (openAuth) {
      event.preventDefault();
      openAuthDialog();
      return;
    }
    const tab = event.target.closest('.feed-tabs .tab');
    if (tab) {
      event.preventDefault();
      if (tab.dataset.view) {
        const scope = normalizeFeedScope(tab.dataset.tab || tab.dataset.view.replace(/^tab-/, '').replace(/-view$/, ''));
        showView('home');
        await loadFeed(scope, true);
      } else if (tab.dataset.notifFilter) {
        await loadNotifications(tab.dataset.notifFilter, true);
      }
      return;
    }
    const nav = event.target.closest('.nav-link, .mobile-nav-btn');
    if (nav) {
      event.preventDefault();
      const target = nav.dataset.nav || nav.id?.replace(/^nav-/, '');
      if (target === 'home') {
        showView('home');
        await loadFeed(state.feedScope, false);
      } else if (target === 'explore') {
        showView('home');
        await loadFeed('trending', true);
      } else if (target === 'notifications') {
        await loadNotifications(state.notifFilter, true);
      } else if (target === 'profile') {
        if (state.session && !state.guest) {
          await loadProfile(state.session.username, true);
          showView('profile');
        } else if (state.profileUsername) {
          await loadProfile(state.profileUsername, true);
          showView('profile');
        } else {
          showView('profile');
          refs.profileTitle.textContent = 'Profile';
          refs.profileSubtitle.textContent = 'Sign in to view your account profile.';
          refs.profileDisplayName.textContent = 'Sign in to continue';
          refs.profileHandle.textContent = '@guest';
          refs.profileBio.textContent = 'Browse as a guest or sign in to access your profile.';
          refs.profileFollowBtn.hidden = true;
          refs.profilePosts.innerHTML = renderEmptyState('Profile unavailable', 'Sign in to view your account profile.');
        }
      }
      return;
    }
    const action = event.target.closest('[data-action]');
    if (action) {
      event.preventDefault();
      const type = action.dataset.action;
      const postId = action.dataset.postId || action.closest('[data-post-id]')?.dataset.postId;
      if (type === 'like' && postId) {
        await toggleLikeAction(postId);
      } else if (type === 'comment' && postId) {
        await toggleComments(postId);
      } else if (type === 'follow' && action.dataset.username) {
        await toggleFollowAction(action.dataset.username);
      } else if (type === 'delete' && postId) {
        await deleteSinglePost(postId);
      } else if (type === 'retry-feed') {
        await loadFeed(state.feedScope, true);
      }
      return;
    }
    const profile = event.target.closest('[data-open-profile]');
    if (profile) {
      event.preventDefault();
      await loadProfile(profile.dataset.openProfile, true);
      showView('profile');
      return;
    }
    const postLink = event.target.closest('[data-open-post]');
    if (postLink) {
      event.preventDefault();
      await openPostById(postLink.dataset.openPost);
      return;
    }
    const image = event.target.closest('[data-lightbox-src]');
    if (image) {
      event.preventDefault();
      openLightbox(image.dataset.lightboxSrc);
    }
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('.comment-form');
    if (!form) return;
    event.preventDefault();
    const postId = form.dataset.commentForm;
    if (postId) {
      await submitComment(postId, form);
    }
  });
}

function installAuth() {
  refs.tabLogin?.addEventListener('click', () => setAuthMode('login'));
  refs.tabSignup?.addEventListener('click', () => setAuthMode('signup'));
  refs.btnGuestLogin?.addEventListener('click', (event) => {
    event.preventDefault();
    enableGuestMode();
  });
  refs.btnLogout?.addEventListener('click', (event) => {
    event.preventDefault();
    clearStoredToken();
    state.token = '';
    state.session = null;
    state.guest = false;
    state.feedCache.clear();
    state.notifications = [];
    showAuthDialog();
    syncChrome();
  });
  refs.formLogin?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = refs.formLogin.querySelector('button[type="submit"]');
    setDisabled(button, true);
    refs.authError.textContent = '';
    try {
      const payload = await login({ username: refs.loginUsername.value, password: refs.loginPassword.value });
      const token = payload.access_token || payload.token || payload.accessToken;
      if (!token) throw new Error('Login succeeded but no token was returned.');
      state.token = token;
      storeToken(token);
      const user = await getSession();
      if (!user) throw new Error('Unable to load account details.');
      await applySession(user, token);
    } catch (err) {
      refs.authError.textContent = err && err.message ? err.message : 'Login failed.';
    } finally {
      setDisabled(button, false);
    }
  });
  refs.formSignup?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = refs.formSignup.querySelector('button[type="submit"]');
    setDisabled(button, true);
    refs.authError.textContent = '';
    try {
      await signup({
        username: refs.signupUsername.value,
        email: refs.signupEmail.value,
        password: refs.signupPassword.value,
      });
      refs.loginUsername.value = refs.signupUsername.value.trim();
      refs.loginPassword.value = '';
      refs.authError.textContent = 'Account created. Please log in.';
      setAuthMode('login');
    } catch (err) {
      refs.authError.textContent = err && err.message ? err.message : 'Sign up failed.';
    } finally {
      setDisabled(button, false);
    }
  });

  refs.notifMarkRead?.addEventListener('click', async (event) => {
    event.preventDefault();
    try {
      await markNotificationsRead(state.token);
      state.notifications = state.notifications.map((item) => ({ ...item, unread: false }));
      renderNotifications(state.notifFilter === 'mentions' ? state.notifications.filter((item) => item.type === 'mention') : state.notifications);
      updateNotificationBadge(0);
      toast('Notifications marked as read.');
    } catch (err) {
      toast(err && err.message ? err.message : 'Could not update notifications.', 'error');
    }
  });
}

function installComposer() {
  refs.btnComposeSidebar?.addEventListener('click', (event) => {
    event.preventDefault();
    if (isGuestMode()) {
      openAuthDialog();
      return;
    }
    refs.composer?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  refs.mobileComposeBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    if (isGuestMode()) {
      openAuthDialog();
      return;
    }
    refs.composer?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  refs.btnPost?.addEventListener('click', async (event) => {
    event.preventDefault();
    await submitComposer();
  });
  refs.btnMedia?.addEventListener('click', (event) => {
    event.preventDefault();
    if (isGuestMode()) {
      openAuthDialog();
      return;
    }
    refs.composerFileInput?.click();
  });
  refs.composerFileInput?.addEventListener('change', () => {
    updateComposerImage(refs.composerFileInput.files?.[0] || null);
  });
  refs.composerPreviewRemove?.addEventListener('click', (event) => {
    event.preventDefault();
    clearComposerImage();
  });
  refs.btnThreadToggle?.addEventListener('click', (event) => {
    event.preventDefault();
    const pressed = refs.btnThreadToggle.getAttribute('aria-pressed') === 'true';
    refs.btnThreadToggle.setAttribute('aria-pressed', String(!pressed));
    refs.threadIndicator.hidden = pressed;
  });
  refs.btnAddThread?.addEventListener('click', (event) => {
    event.preventDefault();
    toast('Threads are not connected yet.', 'error');
  });
  refs.btnEmoji?.addEventListener('click', (event) => {
    event.preventDefault();
    toast('Emoji picker will be wired later.', 'error');
  });
  refs.btnPoll?.addEventListener('click', (event) => {
    event.preventDefault();
    toast('Polls are not available yet.', 'error');
  });
  refs.composerInput?.addEventListener('input', () => {
    const hasText = toText(refs.composerInput.innerText || refs.composerInput.textContent).trim().length > 0;
    setDisabled(refs.btnPost, !hasText && !state.composerImageFile, isGuestMode() ? 'Sign in to post' : '');
  });
}

function installSearch() {
  const debounced = debounce((value) => runSearch(value), 220);
  refs.searchInput?.addEventListener('input', () => debounced(refs.searchInput.value));
}

function installLightbox() {
  refs.imageLightbox?.addEventListener('click', (event) => {
    if (event.target === refs.imageLightbox || event.target === refs.lightboxClose) {
      closeLightbox();
    }
  });
  refs.lightboxClose?.addEventListener('click', closeLightbox);
  refs.lightboxZoomIn?.addEventListener('click', (event) => {
    event.preventDefault();
    changeLightbox(0.15);
  });
  refs.lightboxZoomOut?.addEventListener('click', (event) => {
    event.preventDefault();
    changeLightbox(-0.15);
  });
  refs.lightboxZoomReset?.addEventListener('click', (event) => {
    event.preventDefault();
    refs.lightboxScale = 1;
    if (refs.lightboxImg) refs.lightboxImg.style.transform = 'scale(1)';
  });
}

function installScrollTools() {
  window.addEventListener('scroll', () => {
    if (refs.scrollToTop) {
      refs.scrollToTop.style.display = window.scrollY > 400 ? 'flex' : 'none';
    }
  });
  refs.scrollToTop?.addEventListener('click', (event) => {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

function installProfile() {
  refs.profileBackBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    showView('home');
  });
  refs.profileFollowBtn?.addEventListener('click', async (event) => {
    event.preventDefault();
    const username = refs.profileFollowBtn.dataset.username;
    if (username) {
      await toggleFollowAction(username);
    }
  });
}

function showAuthDialog() {
  openAuth();
}

function openAuthDialog() {
  openAuth();
}

async function bootstrap() {
  refs.authOverlay = el('auth-overlay');
  refs.tabLogin = el('tab-btn-login');
  refs.tabSignup = el('tab-btn-signup');
  refs.formLogin = el('form-login');
  refs.formSignup = el('form-signup');
  refs.authError = el('auth-error');
  refs.btnGuestLogin = el('btn-guest-login');
  refs.btnLogout = el('btn-logout');
  refs.sidebarUserCard = el('sidebar-user-card');
  refs.sidebarAvatar = el('sidebar-avatar');
  refs.sidebarName = el('sidebar-name');
  refs.sidebarHandle = el('sidebar-handle');
  refs.homeView = el('home-view');
  refs.notificationsView = el('notifications-view');
  refs.profileView = el('profile-view');
  refs.homeHeaderTitle = el('feed-header')?.querySelector('.feed-title');
  refs.postsContainer = el('posts-container');
  refs.notificationList = el('notification-page-list');
  refs.followList = el('follow-list');
  refs.searchInput = el('search-input');
  refs.searchResults = el('search-results-panel');
  refs.themeToggle = el('theme-toggle');
  refs.btnComposeSidebar = el('btn-compose-sidebar');
  refs.mobileComposeBtn = el('mobile-compose-btn');
  refs.btnPost = el('btn-post');
  refs.btnMedia = el('btn-media');
  refs.btnEmoji = el('btn-emoji');
  refs.btnPoll = el('btn-poll');
  refs.btnThreadToggle = el('btn-thread-toggle');
  refs.btnAddThread = el('btn-add-thread');
  refs.composer = el('composer');
  refs.composerInput = document.querySelector('.composer-input');
  refs.composerAvatar = el('composer-avatar');
  refs.composerFileInput = el('composer-file-input');
  refs.composerPreview = el('composer-preview');
  refs.composerPreviewImg = el('composer-preview-img');
  refs.composerPreviewRemove = el('composer-preview-remove');
  refs.threadIndicator = el('thread-indicator');
  refs.imageLightbox = el('imageLightbox');
  refs.lightboxImg = el('lightboxImg');
  refs.lightboxClose = el('lightboxClose');
  refs.lightboxZoomOut = el('lightbox-zoom-out');
  refs.lightboxZoomReset = el('lightbox-zoom-reset');
  refs.lightboxZoomIn = el('lightbox-zoom-in');
  refs.toast = el('toast');
  refs.toastMessage = el('toastMessage');
  refs.toastProgress = el('toast-progress');
  refs.scrollToTop = el('scroll-to-top');
  refs.profileTitle = el('profile-page-title');
  refs.profileSubtitle = el('profile-page-subtitle');
  refs.profileBanner = el('profile-banner');
  refs.profileAvatar = el('profile-avatar');
  refs.profileDisplayName = el('profile-display-name');
  refs.profileHandle = el('profile-handle');
  refs.profileBio = el('profile-bio');
  refs.profileFollowBtn = el('profile-follow-btn');
  refs.profilePostCount = el('profile-post-count');
  refs.profileFollowerCount = el('profile-follower-count');
  refs.profileFollowingCount = el('profile-following-count');
  refs.profilePosts = el('profile-posts');
  refs.notifMarkRead = el('notif-mark-read');
  refs.loginUsername = el('login-username');
  refs.loginPassword = el('login-password');
  refs.signupUsername = el('signup-username');
  refs.signupEmail = el('signup-email');
  refs.signupPassword = el('signup-password');

  if (!refs.searchResults && refs.searchInput) {
    refs.searchResults = document.createElement('div');
    refs.searchResults.id = 'search-results-panel';
    refs.searchResults.style.marginTop = '12px';
    refs.searchResults.style.display = 'none';
    refs.searchInput.parentElement?.after(refs.searchResults);
  }

  try {
    setTheme(localStorage.getItem('cloudnet_theme') || 'dark');
  } catch {
    setTheme('dark');
  }
  syncChrome();
  installDelegates();
  installAuth();
  installComposer();
  installSearch();
  installThemeToggle();
  installLightbox();
  installScrollTools();
  installProfile();

  showView('home');
  refs.postsContainer.innerHTML = renderFeedSkeleton(3);
  refs.notificationList.innerHTML = renderFeedSkeleton(2);
  refs.profilePosts.innerHTML = renderFeedSkeleton(2);
  observeReveals(document);

  const user = await getSession().catch(() => null);
  if (user) {
    await applySession(user, state.token);
  } else {
    openAuth();
  }
  await loadSuggestions(true);
  hydrateAvatars(document);
}

async function openProfileForUsername(username) {
  await loadProfile(username, true);
  showView('profile');
}

function updateNotificationCount() {
  updateNotificationBadge(state.notifications.filter((item) => item.unread).length);
}

function start() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      bootstrap().catch((err) => {
        console.error(err);
        toast(err && err.message ? err.message : 'CloudNet failed to start.', 'error');
      });
    }, { once: true });
  } else {
    bootstrap().catch((err) => {
      console.error(err);
      toast(err && err.message ? err.message : 'CloudNet failed to start.', 'error');
    });
  }
}

start();
