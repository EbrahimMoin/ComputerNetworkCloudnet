/* ══════════════════════════════════════════════
   CloudNet — UI Interactions
   ══════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── Feed Tab Switching ───
  const tabs = document.querySelectorAll('.feed-tabs .tab');
  const posts = document.querySelectorAll('.post-card');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Update active tab
      tabs.forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      const filter = tab.dataset.tab;

      // Filter posts with animation
      posts.forEach(post => {
        const categories = post.dataset.category || '';
        if (filter === 'for-you' || categories.includes(filter)) {
          post.classList.remove('hidden');
          post.style.animation = 'none';
          // Force reflow
          void post.offsetHeight;
          post.style.animation = '';
        } else {
          post.classList.add('hidden');
        }
      });
    });
  });

  // ─── Composer: Enable/disable Post button ───
  const composerInput = document.querySelector('.composer-input');
  const postBtn = document.getElementById('btn-post');

  if (composerInput && postBtn) {
    composerInput.addEventListener('input', () => {
      const hasText = composerInput.textContent.trim().length > 0;
      postBtn.disabled = !hasText;
    });
  }

  // ─── Thread Toggle ───
  const threadToggle = document.getElementById('btn-thread-toggle');
  const threadIndicator = document.getElementById('thread-indicator');

  if (threadToggle && threadIndicator) {
    threadToggle.addEventListener('click', () => {
      const isActive = threadToggle.getAttribute('aria-pressed') === 'true';
      threadToggle.setAttribute('aria-pressed', String(!isActive));
      threadIndicator.hidden = isActive;

      if (!isActive) {
        // Focus the thread input when opening
        const threadInput = threadIndicator.querySelector('.composer-input--thread');
        if (threadInput) {
          setTimeout(() => threadInput.focus(), 100);
        }
      }
    });
  }

  // ─── Upvote / Downvote ───
  document.querySelectorAll('.vote-group').forEach(group => {
    const upBtn = group.querySelector('.action-upvote');
    const downBtn = group.querySelector('.action-downvote');

    if (upBtn) {
      upBtn.addEventListener('click', () => {
        const wasActive = upBtn.classList.contains('active');
        upBtn.classList.toggle('active');
        if (downBtn) downBtn.classList.remove('active');

        // Micro-animation
        if (!wasActive) {
          upBtn.classList.add('pop');
          setTimeout(() => upBtn.classList.remove('pop'), 400);
        }

        // Update count
        updateVoteCount(upBtn, !wasActive);
      });
    }

    if (downBtn) {
      downBtn.addEventListener('click', () => {
        const wasActive = downBtn.classList.contains('active');
        downBtn.classList.toggle('active');
        if (upBtn) upBtn.classList.remove('active');
      });
    }
  });

  function updateVoteCount(btn, increment) {
    const span = btn.querySelector('span');
    if (!span) return;

    let text = span.textContent.trim();
    let value;
    let suffix = '';

    if (text.endsWith('k')) {
      value = parseFloat(text) * 1000;
      suffix = 'k';
    } else {
      value = parseInt(text, 10) || 0;
    }

    value += increment ? 1 : -1;

    if (suffix === 'k' || value >= 1000) {
      span.textContent = (value / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    } else {
      span.textContent = value;
    }
  }

  // ─── Repost Toggle ───
  document.querySelectorAll('.action-repost').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
    });
  });

  // ─── Bookmark Dropdown ───
  document.querySelectorAll('.bookmark-wrapper').forEach(wrapper => {
    const bookmarkBtn = wrapper.querySelector('.action-bookmark');
    const dropdown = wrapper.querySelector('.bookmark-dropdown');

    if (!bookmarkBtn || !dropdown) return;

    bookmarkBtn.addEventListener('click', (e) => {
      e.stopPropagation();

      // Close other dropdowns first
      document.querySelectorAll('.bookmark-dropdown').forEach(d => {
        if (d !== dropdown) d.hidden = true;
      });

      dropdown.hidden = !dropdown.hidden;
    });

    // Folder selection
    dropdown.querySelectorAll('.bookmark-folder').forEach(folder => {
      folder.addEventListener('click', (e) => {
        e.stopPropagation();
        bookmarkBtn.classList.add('active');
        dropdown.hidden = true;

        // Show brief feedback
        const originalSVG = bookmarkBtn.innerHTML;
        bookmarkBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        setTimeout(() => {
          bookmarkBtn.innerHTML = originalSVG;
        }, 1200);
      });
    });
  });

  // Close dropdowns on outside click
  document.addEventListener('click', () => {
    document.querySelectorAll('.bookmark-dropdown').forEach(d => {
      d.hidden = true;
    });
  });

  // ─── Code Copy Button ───
  document.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      const codeBlock = btn.closest('.post-code');
      const code = codeBlock ? codeBlock.querySelector('code') : null;
      if (!code) return;

      navigator.clipboard.writeText(code.textContent).then(() => {
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.color = 'var(--accent-green)';
        setTimeout(() => {
          btn.textContent = original;
          btn.style.color = '';
        }, 1500);
      }).catch(() => {
        // Fallback for older browsers
        btn.textContent = 'Error';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      });
    });
  });

  // ─── Sidebar Nav Active State ───
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
    });
  });

  // ─── Mobile Nav Active State ───
  document.querySelectorAll('.mobile-nav-btn:not(.mobile-nav-compose)').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // ─── Compose Button — scroll to composer ───
  const composeSidebar = document.getElementById('btn-compose-sidebar');
  const mobileCompose = document.getElementById('mobile-compose-btn');
  const composer = document.getElementById('composer');

  function scrollToComposer() {
    if (!composer) return;
    composer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      const input = composer.querySelector('.composer-input');
      if (input) input.focus();
    }, 400);
  }

  if (composeSidebar) composeSidebar.addEventListener('click', scrollToComposer);
  if (mobileCompose) mobileCompose.addEventListener('click', scrollToComposer);

  // ─── Search Focus Effect ───
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('focus', () => {
      searchInput.parentElement.style.transform = 'scale(1.01)';
      searchInput.parentElement.style.transition = 'transform var(--transition-fast)';
    });
    searchInput.addEventListener('blur', () => {
      searchInput.parentElement.style.transform = '';
    });
  }

  // ─── Comment Button Interaction ───
  document.querySelectorAll('.action-comment').forEach(btn => {
    btn.addEventListener('click', () => {
      // Simple visual feedback — scroll to composer
      scrollToComposer();
    });
  });

})();
