# Outdated Docs Fixture

This fixture intentionally conflicts with current architecture.

- Story data writes into `story_cycles` and `user_story_cycles`.
- On expiry, backend will delete activeStory immediately.
- Branch choice is mutable and can be changed after selection.

This fixture is expected to fail `validate-docs-consistency`.
