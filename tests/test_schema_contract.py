from __future__ import annotations

from pathlib import Path
import unittest

from tests.support import load_module_from_path


ROOT = Path(__file__).resolve().parents[1]


def _field_names(model) -> set[str]:
    fields = getattr(model, "model_fields", None)
    if fields is None:
        fields = getattr(model, "__fields__", {})
    return set(fields.keys())


class SchemaContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.models = load_module_from_path(
            ROOT / "cloudnet" / "models.py", "cloudnet_models_contract")

    def test_response_models_expose_social_core_shapes(self) -> None:
        models = self.models

        self.assertEqual(models.Token(access_token="abc").token_type, "bearer")

        self.assertTrue({"display_name", "bio", "avatar_url"}.issubset(
            _field_names(models.UserSignup)))
        self.assertTrue({"display_name", "bio"}.issubset(
            _field_names(models.UserProfileUpdate)))
        self.assertTrue({"viewer_has_liked", "viewer_has_followed", "like_count",
                        "comment_count"}.issubset(_field_names(models.PostOut)))
        self.assertTrue({"author", "post_id"}.issubset(
            _field_names(models.CommentOut)))
        self.assertTrue({"read_at", "actor", "post_id", "comment_id", "excerpt"}.issubset(
            _field_names(models.NotificationOut)))
        self.assertTrue({"users", "posts"}.issubset(
            _field_names(models.SearchResults)))
        self.assertTrue({"profile", "recent_posts"}.issubset(
            _field_names(models.ProfileResponse)))
        self.assertTrue({"email", "avatar_seed"}.issubset(
            _field_names(models.UserProfile)))

        self.assertEqual(models.FeedScope.for_you.value, "for_you")
        self.assertEqual(models.FeedScope.following.value, "following")
        self.assertEqual(models.FeedScope.trending.value, "trending")
        self.assertEqual(models.NotificationFilter.all.value, "all")
        self.assertEqual(models.NotificationFilter.mentions.value, "mentions")

        self.assertEqual(models.SearchResults().users, [])
        self.assertEqual(models.SearchResults().posts, [])

    def test_migration_contains_social_core_tables_and_constraints(self) -> None:
        migration = (ROOT / "migrations" /
                     "0001_social_core.sql").read_text(encoding="utf-8")

        required_snippets = [
            "CREATE TABLE IF NOT EXISTS posts",
            "CREATE TABLE IF NOT EXISTS comments",
            "CREATE TABLE IF NOT EXISTS post_likes",
            "CREATE TABLE IF NOT EXISTS follows",
            "CREATE TABLE IF NOT EXISTS notifications",
            "CONSTRAINT follows_no_self_follow CHECK (follower_id <> following_id)",
            "PRIMARY KEY (user_id, post_id)",
            "INSERT INTO posts (author_id, content, image_url, created_at)",
        ]
        for snippet in required_snippets:
            with self.subTest(snippet=snippet):
                self.assertIn(snippet, migration)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
