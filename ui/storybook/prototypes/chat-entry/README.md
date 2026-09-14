# Chat entry UX review

Open **Design explorations → Chat entry → 01 · First use · Start here**.

This proposal adds a Chats section, compose action on hover or keyboard focus (visible on touch), and a company-wide
picker with name/role search. First use uses the same compact sidebar rows as
returning chats. The first-created agent always remains as the default entry,
even when unstarred and absent from recents. Compose and star controls share
the same vertical column. The picker has no subtitle, count, continuation
labels, or footer. Stars and recents are
local to the mounted review. Existing conversations continue without resetting
history. Selecting another agent opens the actual production chat composer; send
appends to the in-memory fixture. Paused Operations has a review-only explanation
and links to the fixture agent settings, with no implicit resume.

Stories cover first use, returning chats, picker, role search, search recovery,
paused agent, larger roster, light theme, and mobile. Try selecting Design Lead,
sending a message, switching to CodexCoder, and returning to Design Lead. Star a
conversation to keep it above recents. All data is simulated.

The production app is unchanged. Only Storybook files implement the proposal.
The existing agent-chat fixture accepts an optional entryScenario and mounts the
review via Layout's existing sidebarSections slot. Its lazy creation fixture also
preserves each agent's distinct conversation identity.

Run from this worktree:

```sh
pnpm --filter @paperclipai/ui exec storybook dev --port 6018 --host 127.0.0.1 --no-open -c storybook/.storybook
```
