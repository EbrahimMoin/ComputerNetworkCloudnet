from __future__ import annotations

import uuid
import unittest

from tests.support import ASGIClient, has_route, load_app


class SocialCoreContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.module, cls.app = load_app()
        cls.client = ASGIClient(cls.app)

    def _pick_route(self, method: str, *templates: str) -> str:
        for template in templates:
            if has_route(self.app, method, template):
                return template
        self.skipTest(
            f"Missing route for {method} among: {', '.join(templates)}")
        raise AssertionError("unreachable")

    def _request(self, method: str, templates: tuple[str, ...], **kwargs):
        template = self._pick_route(method, *templates)
        path = template.format(**kwargs.pop("path_params", {}))
        return self.client.request(method, path, **kwargs)

    @staticmethod
    def _unique(prefix: str) -> str:
        return f"{prefix}_{uuid.uuid4().hex[:8]}"

    @staticmethod
    def _auth_headers(token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    @staticmethod
    def _as_dict(payload):
        if isinstance(payload, dict):
            return payload
        return {}

    @staticmethod
    def _as_list(payload):
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict):
            for key in ("items", "results", "posts", "comments", "notifications", "users"):
                value = payload.get(key)
                if isinstance(value, list):
                    return value
        return []

    def _signup_and_login(self, prefix: str):
        username = self._unique(prefix)
        password = "Password123!"
        email = f"{username}@example.com"
        signup_path = self._pick_route("POST", "/api/signup", "/signup")
        signup_payload = {
            "username": username,
            "email": email,
            "password": password,
            "display_name": f"{prefix.title()} User",
            "bio": f"bio for {username}",
            "avatar_url": f"https://example.com/{username}.png",
        }
        signup = self.client.request(
            "POST", signup_path, json_body=signup_payload)
        if signup.status_code == 503:
            self.skipTest(
                "Auth contract is unavailable until the backend DB is wired up")
        self.assertIn(signup.status_code, {200, 201}, signup.text)

        login_path = self._pick_route("POST", "/api/login", "/login")
        login = self.client.request("POST", login_path, data={
                                    "username": username, "password": password})
        if login.status_code == 503:
            self.skipTest(
                "Auth contract is unavailable until the backend DB is wired up")
        self.assertEqual(login.status_code, 200, login.text)

        token_payload = login.json()
        token = token_payload.get("access_token")
        self.assertTrue(token, login.text)
        return {
            "username": username,
            "password": password,
            "email": email,
            "token": token,
            "headers": self._auth_headers(token),
        }

    def _create_post(self, token: str, content: str):
        post_path = self._pick_route("POST", "/api/posts")
        response = self.client.request("POST", post_path, headers=self._auth_headers(
            token), json_body={"content": content})
        self.assertIn(response.status_code, {200, 201}, response.text)
        payload = self._as_dict(response.json())
        if "id" in payload:
            return payload

        post_id = self._find_post_id_by_content(token, content)
        self.assertIsNotNone(
            post_id, f"Could not locate created post for content {content!r}")
        return {"id": post_id, "content": content}

    def _find_post_id_by_content(self, token: str, content: str):
        feed = self._request(
            "GET", ("/api/feed",), headers=self._auth_headers(token), params={"scope": "for_you"})
        posts = self._as_list(feed.json())
        for item in posts:
            if isinstance(item, dict) and item.get("content") == content:
                return item.get("id")
        return None

    def _get_post(self, post_id: int, token: str | None = None):
        post_path = self._pick_route("GET", "/api/posts/{post_id}")
        headers = self._auth_headers(token) if token else None
        response = self.client.request(
            "GET", post_path.format(post_id=post_id), headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        return self._as_dict(response.json())

    def _list_comments(self, post_id: int, token: str | None = None):
        comments_path = self._pick_route(
            "GET", "/api/posts/{post_id}/comments")
        headers = self._auth_headers(token) if token else None
        response = self.client.request(
            "GET", comments_path.format(post_id=post_id), headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        return self._as_list(response.json())

    def _list_notifications(self, token: str, filter_name: str = "all"):
        notifications_path = self._pick_route("GET", "/api/notifications")
        response = self.client.request(
            "GET",
            notifications_path,
            headers=self._auth_headers(token),
            params={"filter": filter_name},
        )
        self.assertEqual(response.status_code, 200, response.text)
        return self._as_list(response.json())

    def test_signup_login_me(self) -> None:
        account = self._signup_and_login("identity")
        me_path = self._pick_route("GET", "/api/me", "/me")
        response = self.client.request(
            "GET", me_path, headers=account["headers"])
        self.assertEqual(response.status_code, 200, response.text)

        payload = self._as_dict(response.json())
        subject = payload.get("profile") if isinstance(
            payload.get("profile"), dict) else payload
        self.assertEqual(subject.get("username"), account["username"])
        self.assertEqual(subject.get("email"), account["email"])

    def test_profile_update_and_avatar_update(self) -> None:
        account = self._signup_and_login("profile-edit")

        update_path = self._pick_route("PATCH", "/api/me")
        updated_name = "Updated Display"
        updated_bio = "Updated profile bio"
        update = self.client.request(
            "PATCH",
            update_path,
            headers=account["headers"],
            json_body={"display_name": updated_name, "bio": updated_bio},
        )
        self.assertEqual(update.status_code, 200, update.text)
        updated_payload = self._as_dict(update.json())
        self.assertEqual(updated_payload.get("display_name"), updated_name)
        self.assertEqual(updated_payload.get("bio"), updated_bio)

        avatar_path = self._pick_route("POST", "/api/me/avatar")
        avatar = self.client.request(
            "POST",
            avatar_path,
            headers=account["headers"],
            files={
                "image": (
                    "avatar.png",
                    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01",
                    "image/png",
                )
            },
        )
        self.assertEqual(avatar.status_code, 200, avatar.text)
        avatar_payload = self._as_dict(avatar.json())
        self.assertTrue(avatar_payload.get("avatar_url"), avatar.text)

    def test_guest_restrictions(self) -> None:
        post_path = self._pick_route("POST", "/api/posts")
        comment_path = self._pick_route(
            "POST", "/api/posts/{post_id}/comments")
        like_path = self._pick_route("POST", "/api/posts/{post_id}/like")
        follow_path = self._pick_route("POST", "/api/users/{username}/follow")

        cases = [
            ("post", lambda: self.client.request("POST", post_path,
             json_body={"content": "guest should not post"})),
            ("comment", lambda: self.client.request("POST", comment_path.format(
                post_id=1), json_body={"content": "guest comment"})),
            ("like", lambda: self.client.request(
                "POST", like_path.format(post_id=1))),
            ("follow", lambda: self.client.request(
                "POST", follow_path.format(username="someone"))),
        ]

        for name, action in cases:
            with self.subTest(action=name):
                response = action()
                self.assertIn(response.status_code, {401, 403}, response.text)

    def test_create_delete_post(self) -> None:
        author = self._signup_and_login("poster")
        content = f"contract post {uuid.uuid4().hex[:8]}"
        created = self._create_post(author["token"], content)
        post_id = created["id"]

        detail = self._get_post(post_id, author["token"])
        self.assertEqual(detail.get("content"), content)
        self.assertEqual(detail.get("viewer_has_liked"), False)

        delete_path = self._pick_route("DELETE", "/api/posts/{post_id}")
        response = self.client.request("DELETE", delete_path.format(
            post_id=post_id), headers=author["headers"])
        self.assertIn(response.status_code, {200, 204}, response.text)

        deleted = self.client.request("GET", self._pick_route(
            "GET", "/api/posts/{post_id}").format(post_id=post_id), headers=author["headers"])
        self.assertEqual(deleted.status_code, 404, deleted.text)

    def test_add_and_list_comments(self) -> None:
        author = self._signup_and_login("comment-author")
        commenter = self._signup_and_login("commenter")
        post = self._create_post(
            author["token"], f"comment target {uuid.uuid4().hex[:8]}")

        comments_path = self._pick_route(
            "POST", "/api/posts/{post_id}/comments")
        comment_body = {"content": f"nice post @{author['username']}"}
        response = self.client.request(
            "POST",
            comments_path.format(post_id=post["id"]),
            headers=commenter["headers"],
            json_body=comment_body,
        )
        self.assertIn(response.status_code, {200, 201}, response.text)

        comment_payload = self._as_dict(response.json())
        if "id" in comment_payload:
            self.assertEqual(comment_payload.get("post_id"), post["id"])
            self.assertEqual(comment_payload.get(
                "content"), comment_body["content"])

        comments = self._list_comments(post["id"], author["token"])
        contents = [item.get("content")
                    for item in comments if isinstance(item, dict)]
        self.assertIn(comment_body["content"], contents)

    def test_like_unlike_idempotency(self) -> None:
        author = self._signup_and_login("liked-author")
        viewer = self._signup_and_login("liker")
        post = self._create_post(
            author["token"], f"like target {uuid.uuid4().hex[:8]}")

        like_path = self._pick_route("POST", "/api/posts/{post_id}/like")
        unlike_path = self._pick_route("DELETE", "/api/posts/{post_id}/like")

        first_like = self.client.request("POST", like_path.format(
            post_id=post["id"]), headers=viewer["headers"])
        self.assertIn(first_like.status_code, {200, 201, 204}, first_like.text)

        second_like = self.client.request("POST", like_path.format(
            post_id=post["id"]), headers=viewer["headers"])
        self.assertIn(second_like.status_code, {200, 204}, second_like.text)

        detail = self._get_post(post["id"], viewer["token"])
        self.assertTrue(detail.get("viewer_has_liked"))
        self.assertEqual(detail.get("like_count"), 1)

        first_unlike = self.client.request("DELETE", unlike_path.format(
            post_id=post["id"]), headers=viewer["headers"])
        self.assertIn(first_unlike.status_code, {200, 204}, first_unlike.text)

        second_unlike = self.client.request("DELETE", unlike_path.format(
            post_id=post["id"]), headers=viewer["headers"])
        self.assertIn(second_unlike.status_code, {
                      200, 204}, second_unlike.text)

        detail_after = self._get_post(post["id"], viewer["token"])
        self.assertFalse(detail_after.get("viewer_has_liked"))
        self.assertEqual(detail_after.get("like_count"), 0)

    def test_follow_unfollow_and_self_follow_rejection(self) -> None:
        source = self._signup_and_login("source")
        target = self._signup_and_login("target")

        follow_path = self._pick_route("POST", "/api/users/{username}/follow")
        unfollow_path = self._pick_route(
            "DELETE", "/api/users/{username}/follow")
        profile_path = self._pick_route("GET", "/api/users/{username}")

        follow = self.client.request("POST", follow_path.format(
            username=target["username"]), headers=source["headers"])
        self.assertIn(follow.status_code, {200, 201, 204}, follow.text)

        follow_again = self.client.request("POST", follow_path.format(
            username=target["username"]), headers=source["headers"])
        self.assertIn(follow_again.status_code, {200, 204}, follow_again.text)

        profile = self.client.request("GET", profile_path.format(
            username=target["username"]), headers=source["headers"])
        self.assertEqual(profile.status_code, 200, profile.text)
        profile_payload = self._as_dict(profile.json())
        subject = profile_payload.get("profile") if isinstance(
            profile_payload.get("profile"), dict) else profile_payload
        self.assertTrue(subject.get("is_followed"))

        self_follow = self.client.request("POST", follow_path.format(
            username=source["username"]), headers=source["headers"])
        self.assertGreaterEqual(self_follow.status_code, 400, self_follow.text)

        unfollow = self.client.request("DELETE", unfollow_path.format(
            username=target["username"]), headers=source["headers"])
        self.assertIn(unfollow.status_code, {200, 204}, unfollow.text)

        unfollow_again = self.client.request("DELETE", unfollow_path.format(
            username=target["username"]), headers=source["headers"])
        self.assertIn(unfollow_again.status_code, {
                      200, 204}, unfollow_again.text)

    def test_feed_scope_filtering(self) -> None:
        viewer = self._signup_and_login("viewer")
        followed = self._signup_and_login("followed")
        outsider = self._signup_and_login("outsider")

        follow_path = self._pick_route("POST", "/api/users/{username}/follow")
        self.client.request("POST", follow_path.format(
            username=followed["username"]), headers=viewer["headers"])

        followed_post = self._create_post(
            followed["token"], f"followed feed {uuid.uuid4().hex[:8]}")
        viewer_post = self._create_post(
            viewer["token"], f"viewer feed {uuid.uuid4().hex[:8]}")
        outsider_post = self._create_post(
            outsider["token"], f"outsider feed {uuid.uuid4().hex[:8]}")

        feed_path = self._pick_route("GET", "/api/feed")
        for_you = self.client.request(
            "GET", feed_path, headers=viewer["headers"], params={"scope": "for_you"})
        self.assertEqual(for_you.status_code, 200, for_you.text)
        for_you_posts = self._as_list(for_you.json())
        for_you_contents = [item.get("content")
                            for item in for_you_posts if isinstance(item, dict)]
        self.assertIn(followed_post["content"], for_you_contents)
        self.assertIn(viewer_post["content"], for_you_contents)
        self.assertIn(outsider_post["content"], for_you_contents)

        following = self.client.request(
            "GET", feed_path, headers=viewer["headers"], params={"scope": "following"})
        self.assertEqual(following.status_code, 200, following.text)
        following_posts = self._as_list(following.json())
        following_contents = [
            item.get("content") for item in following_posts if isinstance(item, dict)]
        self.assertIn(followed_post["content"], following_contents)
        self.assertNotIn(outsider_post["content"], following_contents)
        self.assertNotIn(viewer_post["content"], following_contents)

        trending = self.client.request(
            "GET", feed_path, headers=viewer["headers"], params={"scope": "trending"})
        self.assertEqual(trending.status_code, 200, trending.text)
        self.assertIsInstance(self._as_list(trending.json()), list)

    def test_feed_pagination_non_overlapping_windows(self) -> None:
        viewer = self._signup_and_login("pager")
        for index in range(5):
            self._create_post(
                viewer["token"], f"page marker {index} {uuid.uuid4().hex[:6]}")

        feed_path = self._pick_route("GET", "/api/feed")
        page_one = self.client.request(
            "GET",
            feed_path,
            headers=viewer["headers"],
            params={"scope": "for_you", "limit": 2, "offset": 0},
        )
        page_two = self.client.request(
            "GET",
            feed_path,
            headers=viewer["headers"],
            params={"scope": "for_you", "limit": 2, "offset": 2},
        )
        self.assertEqual(page_one.status_code, 200, page_one.text)
        self.assertEqual(page_two.status_code, 200, page_two.text)

        page_one_posts = self._as_list(page_one.json())
        page_two_posts = self._as_list(page_two.json())
        self.assertLessEqual(len(page_one_posts), 2)
        self.assertLessEqual(len(page_two_posts), 2)

        first_ids = {item.get("id")
                     for item in page_one_posts if isinstance(item, dict)}
        second_ids = {item.get("id")
                      for item in page_two_posts if isinstance(item, dict)}
        self.assertTrue(first_ids)
        self.assertTrue(first_ids.isdisjoint(
            second_ids), f"Expected disjoint windows, got overlap: {first_ids & second_ids}")

    def test_profile_posts_pagination(self) -> None:
        author = self._signup_and_login("profile-pager")
        for index in range(4):
            self._create_post(
                author["token"], f"profile page marker {index} {uuid.uuid4().hex[:6]}")

        profile_posts_path = self._pick_route(
            "GET", "/api/users/{username}/posts")
        page_one = self.client.request(
            "GET",
            profile_posts_path.format(username=author["username"]),
            headers=author["headers"],
            params={"limit": 2, "offset": 0},
        )
        page_two = self.client.request(
            "GET",
            profile_posts_path.format(username=author["username"]),
            headers=author["headers"],
            params={"limit": 2, "offset": 2},
        )
        self.assertEqual(page_one.status_code, 200, page_one.text)
        self.assertEqual(page_two.status_code, 200, page_two.text)

        first_items = self._as_list(page_one.json())
        second_items = self._as_list(page_two.json())
        self.assertLessEqual(len(first_items), 2)
        self.assertLessEqual(len(second_items), 2)

        first_ids = {item.get("id")
                     for item in first_items if isinstance(item, dict)}
        second_ids = {item.get("id")
                      for item in second_items if isinstance(item, dict)}
        self.assertTrue(first_ids)
        self.assertTrue(first_ids.isdisjoint(
            second_ids), f"Expected disjoint windows, got overlap: {first_ids & second_ids}")

        for item in first_items + second_items:
            if isinstance(item, dict):
                author_payload = item.get("author") if isinstance(
                    item.get("author"), dict) else {}
                self.assertEqual(author_payload.get(
                    "username"), author["username"])

    def test_notifications_generation_and_mark_all_read(self) -> None:
        author = self._signup_and_login("notified")
        actor = self._signup_and_login("actor")
        post = self._create_post(
            author["token"], f"notify target {uuid.uuid4().hex[:8]}")

        follow_path = self._pick_route("POST", "/api/users/{username}/follow")
        like_path = self._pick_route("POST", "/api/posts/{post_id}/like")
        comment_path = self._pick_route(
            "POST", "/api/posts/{post_id}/comments")
        notifications_path = self._pick_route("GET", "/api/notifications")
        read_all_path = self._pick_route("POST", "/api/notifications/read-all")

        self.client.request("POST", follow_path.format(
            username=author["username"]), headers=actor["headers"])
        self.client.request("POST", like_path.format(
            post_id=post["id"]), headers=actor["headers"])
        self.client.request(
            "POST",
            comment_path.format(post_id=post["id"]),
            headers=actor["headers"],
            json_body={"content": f"great work @{author['username']}"},
        )

        all_notifications = self.client.request(
            "GET", notifications_path, headers=author["headers"], params={"filter": "all"})
        self.assertEqual(all_notifications.status_code,
                         200, all_notifications.text)
        payload = self._as_list(all_notifications.json())
        self.assertTrue(payload, "expected at least one notification")
        types = {item.get("type")
                 for item in payload if isinstance(item, dict)}
        self.assertTrue({"follow", "like", "comment"} & types)

        mentions = self.client.request(
            "GET", notifications_path, headers=author["headers"], params={"filter": "mentions"})
        self.assertEqual(mentions.status_code, 200, mentions.text)
        mentions_payload = self._as_list(mentions.json())
        self.assertTrue(mentions_payload, "expected mention notifications")

        mark_all = self.client.request(
            "POST", read_all_path, headers=author["headers"])
        self.assertIn(mark_all.status_code, {200, 204}, mark_all.text)

        after = self.client.request(
            "GET", notifications_path, headers=author["headers"], params={"filter": "all"})
        after_payload = self._as_list(after.json())
        self.assertTrue(after_payload)
        self.assertTrue(all(isinstance(item, dict) and item.get(
            "read_at") for item in after_payload))

    def test_mentions_in_posts_and_comments(self) -> None:
        author = self._signup_and_login("mention-target")
        writer = self._signup_and_login("writer")

        post_path = self._pick_route("POST", "/api/posts")
        comment_path = self._pick_route(
            "POST", "/api/posts/{post_id}/comments")
        notifications_path = self._pick_route("GET", "/api/notifications")

        post_mention_text = f"hello @{author['username']} from a post"
        comment_mention_text = f"hello again @{author['username']} from a comment"

        post = self.client.request("POST", post_path, headers=writer["headers"], json_body={
                                   "content": post_mention_text})
        self.assertIn(post.status_code, {200, 201}, post.text)
        post_payload = self._as_dict(post.json())
        post_id = post_payload.get("id") or self._find_post_id_by_content(
            writer["token"], post_mention_text)
        self.assertIsNotNone(post_id)

        self.client.request(
            "POST",
            comment_path.format(post_id=post_id),
            headers=writer["headers"],
            json_body={"content": comment_mention_text},
        )

        mentions = self.client.request(
            "GET", notifications_path, headers=author["headers"], params={"filter": "mentions"})
        self.assertEqual(mentions.status_code, 200, mentions.text)
        mention_payload = self._as_list(mentions.json())
        excerpts = [item.get("excerpt", "")
                    for item in mention_payload if isinstance(item, dict)]
        self.assertTrue(
            any(author["username"] in excerpt for excerpt in excerpts))

    def test_search_results_for_users_and_posts(self) -> None:
        author = self._signup_and_login("searchable")
        content_marker = f"search marker {author['username']} {uuid.uuid4().hex[:8]}"
        self._create_post(author["token"], content_marker)

        search_path = self._pick_route("GET", "/api/search")
        response = self.client.request(
            "GET", search_path, headers=author["headers"], params={"q": author["username"]})
        self.assertEqual(response.status_code, 200, response.text)
        payload = self._as_dict(response.json())

        users = self._as_list(payload.get("users"))
        posts = self._as_list(payload.get("posts"))

        self.assertTrue(any(item.get(
            "username") == author["username"] for item in users if isinstance(item, dict)))
        self.assertTrue(any(content_marker in item.get("content", "")
                        for item in posts if isinstance(item, dict)))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
