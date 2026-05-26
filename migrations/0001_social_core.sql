BEGIN;

CREATE TABLE IF NOT EXISTS posts (
    id SERIAL PRIMARY KEY,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    image_url VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS display_name VARCHAR(80),
    ADD COLUMN IF NOT EXISTS bio VARCHAR(280),
    ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500),
    ADD COLUMN IF NOT EXISTS avatar_seed VARCHAR(50);

UPDATE users
SET display_name = COALESCE(NULLIF(display_name, ''), INITCAP(REGEXP_REPLACE(username, '[_\.-]+', ' ', 'g'))),
    avatar_seed = COALESCE(NULLIF(avatar_seed, ''), LOWER(REGEXP_REPLACE(username, '[^A-Za-z0-9]+', '', 'g')));

ALTER TABLE users
    ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS comments (
    id SERIAL PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS post_likes (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS follows (
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (follower_id, following_id),
    CONSTRAINT follows_no_self_follow CHECK (follower_id <> following_id)
);

CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    type VARCHAR(32) NOT NULL,
    post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    excerpt TEXT,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author_created_at ON posts (author_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post_created_at ON comments (post_id, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at ON notifications (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_follows_following_id ON follows (following_id);
CREATE INDEX IF NOT EXISTS idx_follows_follower_id ON follows (follower_id);

INSERT INTO posts (author_id, content, image_url, created_at)
SELECT u.id, t.content, t.image_filename, t.created_at
FROM tweets t
JOIN users u ON LOWER(u.username) = LOWER(t.username)
WHERE NOT EXISTS (
    SELECT 1
    FROM posts p
    WHERE p.author_id = u.id
      AND p.content = t.content
      AND COALESCE(p.image_url, '') = COALESCE(t.image_filename, '')
      AND p.created_at = t.created_at
);

COMMIT;
