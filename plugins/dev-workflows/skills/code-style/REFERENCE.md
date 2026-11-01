# code-style — before → after reference

Long-tail examples for the principles in `SKILL.md`, drawn from small neutral apps (a blog, a task
tracker, a notification service, a feed reader, an HTTP client). The names are illustrative — when
you apply a principle, find the repo's own equivalent and cite it. Section tags match `SKILL.md`.

## Abstraction barriers & API surface [any]

**Collapse a sequence into one intent-named method.**
```ruby
# before — the controller orchestrates every channel itself
UserMailer.mention(user, comment).deliver_later if user.email_opt_in?
user.push_devices.each { |device| PushClient.send(device.token, comment.excerpt) }
user.inbox_items.create!(kind: "mention", subject: comment)

# after
Notifications.deliver(MentionEvent.new(comment), to: user)
```

**Hide an internal concept from subclasses.**
```ruby
# before — every importer subclass knows the column map
name, email, team = row.values_at(*COLUMN_MAP.values)

# after — one call; the map never leaves the base class,
# and the return is a hash, not a positional array
name:, email:, team: = row_attributes(row)
```
`Importer#row_attributes` is **public**, declared above `private`, next to `each_row`.

**Delete a pass-through hook.**
```tsx
// before — the hook hands back the setter it was given
const { setSort } = useSortableTable(setSortOrder);

// after — the state owner exposes it directly; the hook stops taking a setter
const { setSortOrder } = useTaskListState();
```

**Delete a one-line alias.**
```ruby
# before
def slugify(text) = Slug.slugify(text)

# after — call Slug.slugify at the two call sites
```

## Domain boundaries [any; examples Rails]

**Behavior that always accompanies an operation moves inside it.**
```ruby
# before — every caller must remember the slug
post.slug ||= Slug.slugify(post.title)
post.publish!

# after — publish! guarantees a slug itself
post.publish!
```

**Encode the terminal state instead of rescuing the I/O.**
```ruby
# before — a request we already know is pointless, caught after the fact
def deliver(event)
  HTTP.timeout(5).post(endpoint.url, json: event.payload)
rescue HTTP::TimeoutError
  endpoint.record_failure!
end

# after — a disabled endpoint is a terminal state; don't make the request
def deliver(event)
  return if endpoint.disabled?

  HTTP.timeout(5).post(endpoint.url, json: event.payload)
end
```

**One caller ⇒ a private method, not a new service object.**
```
# before
Feeds::RetryFailedFetch.call(feed)        # called only from RefreshFeedJob

# after
RefreshFeedJob
  private def retry_failed_fetch(feed)
```

**Move the attribute to its real owner.** `date_format` started on `EmailTemplate` and belongs on
`Locale` — every template, export and UI string in that locale needs it. When a per-user override
later appears, resolution follows the two-layer shape the app already uses elsewhere:

```ruby
# app/models/user.rb
def date_format
  date_format_override.presence || locale.date_format
end
```

## Declarative over imperative [any]

**Registry over branching.**
```ruby
# before
def validate(field, value)
  if field.kind == :email then EmailValidator.new.call(value)
  elsif field.kind == :url then UrlValidator.new.call(value)
  elsif field.kind == :phone then PhoneValidator.new.call(value)
  end
end

# after
Validators.register(:email, EmailValidator)   # at boot; register checks the shared interface
Validators.for(field.kind).call(value)
```

**Don't split a failure to reassemble it.** See `SKILL.md` §3 — and push the *distinction* into the
layer that can compute it: if callers need to tell `:rate_limited` from `:unauthorized`, the HTTP
client returns that code already resolved, and no caller re-derives it from the status.

**No accumulate-and-skip.**
```ruby
# before
visible = []
tasks.each do |task|
  next if task.archived?
  visible << task
end

# after — say what the result is
visible = tasks.reject(&:archived?)
```

**Wrap paired ref bookkeeping.**
```ts
// before — two operations that always fire together, inline in the main hook
delete thumbnailCacheRef.current[id];
markThumbnailStale(id);

// after — a small sub-hook in the same file exposes declarative operations
thumbnails.invalidate(id);
```

## Frontend shape [React] [GraphQL]

**Dispatcher over a generic branching component.**
```tsx
// before — one component with a branch per block type
function Block({ block }) { if (block.type === "image") { /* … */ } else if (block.type === "quote") { /* … */ } }

// after — one file per variant, a thin type → component map
const BLOCKS = { image: ImageBlock, quote: QuoteBlock, embed: EmbedBlock };
const Component = BLOCKS[block.type];
```

**No state wrapping a derivable value.**
```tsx
// before
const [isOverdue, setIsOverdue] = useState(false);
useEffect(() => setIsOverdue(task.dueAt < now), [task.dueAt, now]);

// after
const isOverdue = task.dueAt < now;
```

**[GraphQL] Widen the wire type when the shape is already known to be coming.**
```ruby
# before
argument :settings, String, required: false

# after — the next PR sends an object; match the repo's existing JSON-typed arguments
argument :settings, GraphQL::Types::JSON, required: false
```

## Readability [any]

**Implicit return.**
```ruby
# before
def archive_completed
  completed = tasks.select(&:done?)
  completed.each(&:archive!)
  return nil
end

# after
def archive_completed
  tasks.select(&:done?).each(&:archive!)
end
```

**One default mechanism, not two.**
```ruby
# before
tags = []
tags = Array(tags)

# after
tags = []
```

**Symmetry when a sibling variable already exists.**
```ruby
# before — one path in a local, the other inline
edit_path = edit_post_path(post, return_to:)
redirect_to preview_post_path(post, token: preview_token)

# after — both named
edit_path    = edit_post_path(post, return_to:)
preview_path = preview_post_path(post, token: preview_token)
```

## Comments [any]

```ruby
# before — stale rationale, over-long, restates the code
# We pass the feed explicitly because the job used to load it from
# the subscription, which pointed at the old URL after a redirect, and
# then the retry used the cached etag from the wrong feed, so now we
# always pass it in even though the subscription would usually be fine.

# after — either delete it, or state the current reason in one or two lines
```

```ruby
# before — asserts a fact that can drift
# Every feed has a title.

# after — defensive framing
# Defensive: some feeds omit <title>.
```

The one comment the user asks *for*: a placeholder that will be replaced.
```ruby
# Placeholder until per-user digest schedules land in the follow-up PR.
DEFAULT_DIGEST_HOUR = 8
```

## Naming [any]

| before | after | why |
| --- | --- | --- |
| `TwitterEmbed` | `SocialEmbed` | the class now handles three networks |
| `tweet_url`, `TWEET_PATTERN` | `post_url`, `SOCIAL_POST_PATTERN` | rename the whole surface, including admin labels and specs |
| `Comment#tweetable?` | `Comment#shareable?` | predicate follows the concept |
| `email` (on a contact form) | `contact` | a contact can be an email or a phone number |
| `PRIORITY_WEIGHTS = { 'urgent' => 3, … }` | `PRIORITY_ORDER = %w[urgent high normal low]` | only the order was ever consumed |
| `relativeDate.ts` | `formatRelativeDate.ts` | file name matches its export |
| a fixture named after one real feed | `"feed-without-etag"` | name the condition under test, not today's instance |

## Libraries & public APIs [library]

```ts
// before — a new public method on a class users subclass, no types, no changelog
class Reporter { flushNow() { … } }

// after — the PR body states "minor: adds Reporter#flushNow (may shadow subclass methods named
// flushNow)", the .d.ts gains the signature in the same diff, and a type test covers it
```

```js
// before — "redundant" guard removed in a hot path
function onRequest(req) { if (!this.hooks.length) return; runHooks(this.hooks, req); }
// The early return is the cheap path for the common no-hooks case; keep it unless a benchmark says otherwise.
```
