from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserSignup(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1, max_length=128)
    display_name: str | None = Field(default=None, max_length=80)
    bio: str | None = Field(default=None, max_length=280)
    avatar_url: str | None = Field(default=None, max_length=500)


class UserProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=80)
    bio: str | None = Field(default=None, max_length=280)


class CommentCreate(BaseModel):
    content: str = Field(min_length=1, max_length=500)


class FeedScope(str, Enum):
    for_you = "for_you"
    following = "following"
    trending = "trending"


class NotificationFilter(str, Enum):
    all = "all"
    mentions = "mentions"


class UserSummary(BaseModel):
    id: str
    username: str
    display_name: str
    avatar_url: str
    bio: str = ""
    follower_count: int = 0
    following_count: int = 0
    post_count: int = 0
    is_followed: bool = False


class UserProfile(UserSummary):
    email: str
    avatar_seed: str


class PostAuthor(UserSummary):
    pass


class PostOut(BaseModel):
    id: int
    content: str
    image_url: str | None = None
    created_at: str
    author: PostAuthor | None = None
    like_count: int = 0
    comment_count: int = 0
    viewer_has_liked: bool = False
    viewer_has_followed: bool = False


class CommentOut(BaseModel):
    id: int
    content: str
    created_at: str
    author: UserSummary
    post_id: int


class NotificationOut(BaseModel):
    id: int
    type: str
    created_at: str
    read_at: str | None = None
    actor: UserSummary | None = None
    post_id: int | None = None
    comment_id: int | None = None
    excerpt: str | None = None


class SearchResults(BaseModel):
    users: list[UserSummary] = Field(default_factory=list)
    posts: list[PostOut] = Field(default_factory=list)


class ProfileResponse(BaseModel):
    profile: UserProfile
    recent_posts: list[PostOut] = Field(default_factory=list)


PostOut.model_rebuild()
CommentOut.model_rebuild()
NotificationOut.model_rebuild()
SearchResults.model_rebuild()
ProfileResponse.model_rebuild()
