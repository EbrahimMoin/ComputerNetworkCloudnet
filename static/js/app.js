/* ================================================
   PULSE — Application JavaScript
   ================================================ */

// ---- DOM Elements ----
const postForm = document.getElementById('postForm');
const usernameInput = document.getElementById('usernameInput');
const contentInput = document.getElementById('contentInput');
const imageInput = document.getElementById('imageInput');
const imagePreviewContainer = document.getElementById('imagePreviewContainer');
const imagePreview = document.getElementById('imagePreview');
const removeImageBtn = document.getElementById('removeImageBtn');
const charCounter = document.getElementById('charCounter');
const submitBtn = document.getElementById('submitBtn');
const feedContainer = document.getElementById('feedContainer');
const imageModal = document.getElementById('imageModal');
const modalImage = document.getElementById('modalImage');
const modalClose = document.getElementById('modalClose');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');
const composerAvatar = document.getElementById('composerAvatar');
const imageAttachBtn = document.getElementById('imageAttachBtn');
const navbar = document.querySelector('.navbar');
const scrollProgress = document.getElementById('scrollProgress');
const postCountEl = document.getElementById('postCount');
const emojiBtn = document.getElementById('emojiBtn');
const emojiPicker = document.getElementById('emojiPicker');

// ---- Scroll Effects ----
let lastScroll = 0;
window.addEventListener('scroll', () => {
    // Navbar shadow on scroll
    if (window.scrollY > 10) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }

    // Scroll progress bar
    const scrollTop = document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
    scrollProgress.style.width = progress + '%';

    lastScroll = window.scrollY;
}, { passive: true });

// ---- Auto-resize Textarea ----
contentInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 300) + 'px';
    updateCharCounter();
});

// ---- Character Counter ----
function updateCharCounter() {
    const length = contentInput.value.length;
    const max = 500;
    charCounter.textContent = `${length} / ${max}`;
    charCounter.classList.remove('warning', 'danger');
    if (length > 450) charCounter.classList.add('danger');
    else if (length > 400) charCounter.classList.add('warning');
}

// ---- Avatar Initial from Username ----
usernameInput.addEventListener('input', function () {
    const name = this.value.trim();
    if (name) {
        composerAvatar.textContent = name.charAt(0).toUpperCase();
    } else {
        composerAvatar.innerHTML = '<i class="fas fa-user"></i>';
    }
});

// ---- Persist Username ----
(function restoreUsername() {
    const saved = localStorage.getItem('pulse_username');
    if (saved) {
        usernameInput.value = saved;
        composerAvatar.textContent = saved.charAt(0).toUpperCase();
    }
})();

usernameInput.addEventListener('change', function () {
    const name = this.value.trim();
    if (name) localStorage.setItem('pulse_username', name);
});

// ---- Image Preview ----
imageInput.addEventListener('change', function () {
    const file = this.files[0];
    if (file) {
        if (file.size > 10 * 1024 * 1024) {
            showToast('Image must be under 10 MB', 'error');
            this.value = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = function (e) {
            imagePreview.src = e.target.result;
            imagePreviewContainer.classList.add('active');
            imageAttachBtn.classList.add('has-file');
        };
        reader.readAsDataURL(file);
    }
});

removeImageBtn.addEventListener('click', function () {
    imageInput.value = '';
    imagePreviewContainer.classList.remove('active');
    imageAttachBtn.classList.remove('has-file');
});

// ---- Emoji Picker ----
const emojis = ['😀', '😂', '😍', '🤔', '👍', '🔥', '❤️', '🎉', '✨', '💯', '🙌', '😎', '🥳', '🤝', '💪', '🚀', '⭐', '💡'];

// Build emoji grid
emojis.forEach(emoji => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = emoji;
    btn.addEventListener('click', () => {
        contentInput.value += emoji;
        contentInput.focus();
        updateCharCounter();
        emojiPicker.classList.remove('active');
    });
    emojiPicker.appendChild(btn);
});

emojiBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    emojiPicker.classList.toggle('active');
});

document.addEventListener('click', function (e) {
    if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
        emojiPicker.classList.remove('active');
    }
});

// ---- Time Ago ----
function timeAgo(dateString) {
    if (!dateString.endsWith('Z') && !dateString.includes('+')) {
        dateString += 'Z';
    }
    const date = new Date(dateString);
    const now = new Date();
    const s = Math.floor((now - date) / 1000);

    if (s < 10) return 'Just now';
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---- Avatar Color Generator ----
const avatarColors = [
    'linear-gradient(135deg, #e85d04 0%, #f48c06 100%)',
    'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
    'linear-gradient(135deg, #059669 0%, #34d399 100%)',
    'linear-gradient(135deg, #dc2626 0%, #f87171 100%)',
    'linear-gradient(135deg, #2563eb 0%, #60a5fa 100%)',
    'linear-gradient(135deg, #db2777 0%, #f472b6 100%)',
    'linear-gradient(135deg, #0891b2 0%, #22d3ee 100%)',
    'linear-gradient(135deg, #854d0e 0%, #facc15 100%)',
];

function getAvatarColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return avatarColors[Math.abs(hash) % avatarColors.length];
}

// ---- Escape HTML (XSS prevention) ----
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ---- Linkify URLs in text ----
function linkifyText(text) {
    const urlRegex = /(https?:\/\/[^\s<]+)/g;
    return text.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener" style="color:var(--accent-secondary);text-decoration:none;border-bottom:1px solid var(--accent-secondary);">$1</a>');
}

// ---- Skeleton Loading HTML ----
function getSkeletonHTML(count = 3) {
    let html = '';
    for (let i = 0; i < count; i++) {
        html += `
            <div class="skeleton-card" style="animation-delay: ${i * 0.1}s">
                <div class="skeleton-header">
                    <div class="skeleton-avatar"></div>
                    <div class="skeleton-lines">
                        <div class="skeleton-line"></div>
                        <div class="skeleton-line"></div>
                    </div>
                </div>
                <div class="skeleton-body">
                    <div class="skeleton-line"></div>
                    <div class="skeleton-line"></div>
                    <div class="skeleton-line"></div>
                </div>
            </div>`;
    }
    return html;
}

// ---- Load Posts ----
async function loadData() {
    try {
        feedContainer.innerHTML = getSkeletonHTML(4);

        const res = await fetch('/tweets');
        const data = await res.json();

        // Update post count in banner
        if (postCountEl) {
            postCountEl.textContent = data.length;
        }

        if (data.length === 0) {
            feedContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon"><i class="fas fa-feather"></i></div>
                    <h3 class="empty-title">No posts yet</h3>
                    <p class="empty-text">Be the first to share something with the community!</p>
                </div>`;
            return;
        }

        feedContainer.innerHTML = '';
        data.forEach((post, index) => {
            const user = post.username || 'Anonymous';
            const initial = user.charAt(0).toUpperCase();
            const avatarStyle = `background: ${getAvatarColor(user)};`;

            let imageHtml = '';
            if (post.image_filename) {
                const src = post.image_filename.startsWith('http')
                    ? post.image_filename
                    : '/static/images/' + post.image_filename;
                imageHtml = `
                    <div class="post-image">
                        <img src="${src}" alt="Post image" loading="lazy" onclick="openImageModal('${src}')">
                        <div class="img-overlay"></div>
                    </div>`;
            }

            const card = document.createElement('div');
            card.className = 'post-card';
            card.style.animationDelay = `${index * 0.08}s`;

            const escapedContent = escapeHtml(post.content);
            const linkedContent = linkifyText(escapedContent);

            card.innerHTML = `
                <div class="post-header">
                    <div class="post-avatar" style="${avatarStyle}">${initial}</div>
                    <div class="post-meta">
                        <div class="post-author-row">
                            <span class="post-author">${escapeHtml(user)}</span>
                            <span class="post-dot">·</span>
                            <span class="post-time">${timeAgo(post.created_at)}</span>
                        </div>
                    </div>
                    <button class="post-menu-btn" title="More options">
                        <i class="fas fa-ellipsis"></i>
                    </button>
                </div>
                <div class="post-content">
                    <p class="post-text">${linkedContent}</p>
                    ${imageHtml}
                </div>
                <div class="post-actions">
                    <button class="action-btn like" onclick="toggleLike(this)">
                        <i class="far fa-heart"></i>
                        <span class="action-count">${randomCount()}</span>
                    </button>
                    <button class="action-btn comment">
                        <i class="far fa-comment"></i>
                        <span class="action-count">${randomCount(0, 12)}</span>
                    </button>
                    <button class="action-btn share">
                        <i class="fas fa-arrow-up-from-bracket"></i>
                        <span class="action-count">${randomCount(0, 8)}</span>
                    </button>
                    <button class="action-btn bookmark" onclick="toggleBookmark(this)">
                        <i class="far fa-bookmark"></i>
                    </button>
                </div>`;

            feedContainer.appendChild(card);
        });

    } catch (error) {
        console.error('Error loading feed:', error);
        feedContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon"><i class="fas fa-exclamation-triangle"></i></div>
                <h3 class="empty-title">Couldn't load posts</h3>
                <p class="empty-text">Something went wrong. Check your connection and try again.</p>
            </div>`;
    }
}

// ---- Random placeholder counts for likes/comments ----
function randomCount(min = 0, max = 42) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ---- Toggle Like ----
function toggleLike(btn) {
    btn.classList.toggle('liked');
    const icon = btn.querySelector('i');
    const count = btn.querySelector('.action-count');
    let n = parseInt(count.textContent);

    if (btn.classList.contains('liked')) {
        icon.classList.replace('far', 'fas');
        count.textContent = n + 1;
    } else {
        icon.classList.replace('fas', 'far');
        count.textContent = Math.max(0, n - 1);
    }
}

// ---- Toggle Bookmark ----
function toggleBookmark(btn) {
    btn.classList.toggle('saved');
    const icon = btn.querySelector('i');
    if (btn.classList.contains('saved')) {
        icon.classList.replace('far', 'fas');
        showToast('Saved to bookmarks', 'success');
    } else {
        icon.classList.replace('fas', 'far');
        showToast('Removed from bookmarks', 'success');
    }
}

// ---- Toast Notification ----
let toastTimeout;
function showToast(message, type = 'success') {
    clearTimeout(toastTimeout);
    toastMessage.textContent = message;
    toast.className = `toast ${type}`;
    const icon = toast.querySelector('i');
    icon.className = type === 'success' ? 'fas fa-check-circle' : 'fas fa-exclamation-circle';
    toast.classList.add('show');
    toastTimeout = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ---- Form Submission ----
postForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    const content = contentInput.value.trim();
    if (!content) {
        showToast('Write something first!', 'error');
        return;
    }

    const savedName = usernameInput.value;

    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    try {
        const formData = new FormData(this);
        const res = await fetch('/tweet', {
            method: 'POST',
            body: formData
        });

        if (res.ok) {
            showToast('Posted successfully!', 'success');

            // Reset form
            postForm.reset();
            contentInput.style.height = 'auto';
            imagePreviewContainer.classList.remove('active');
            imageAttachBtn.classList.remove('has-file');
            updateCharCounter();

            // Restore username
            usernameInput.value = savedName;
            if (savedName) {
                composerAvatar.textContent = savedName.charAt(0).toUpperCase();
            }

            // Reload feed with smooth transition
            loadData();
        } else {
            showToast('Failed to post. Please try again.', 'error');
        }
    } catch (error) {
        console.error('Post error:', error);
        showToast('Connection error. Please try again.', 'error');
    }

    submitBtn.classList.remove('loading');
    submitBtn.disabled = false;
});

// ---- Image Modal ----
function openImageModal(src) {
    modalImage.src = src;
    imageModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeImageModal() {
    imageModal.classList.remove('active');
    document.body.style.overflow = '';
}

imageModal.addEventListener('click', function (e) {
    if (e.target === imageModal) closeImageModal();
});

modalClose.addEventListener('click', closeImageModal);

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        if (imageModal.classList.contains('active')) closeImageModal();
        if (emojiPicker.classList.contains('active')) emojiPicker.classList.remove('active');
    }
});

// ---- Feed Tab Switching ----
document.querySelectorAll('.feed-tab').forEach(tab => {
    tab.addEventListener('click', function () {
        document.querySelectorAll('.feed-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        // In a real app this would filter posts – for now just reload
        loadData();
    });
});

// ---- Initialize ----
window.addEventListener('DOMContentLoaded', loadData);
