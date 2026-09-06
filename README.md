# postwright

postwright is a local-first CLI for drafting social content (X, LinkedIn, dev.to) and
releasing it under an evidence gate. It stages a draft on disk, lints it against a fixed
set of measured rules before it can be called ready, and only ever touches a real account
when the operator explicitly asks it to, one channel at a time.

Nothing about this tool auto-posts. Every draft sits in a local directory until a human
runs an explicit release command with an explicit confirmation flag.

## The idea behind the gates

The lint rules aren't a generic style guide — they encode what was actually observed to
work and not work on a real account, and they're meant to be tightened or loosened only
when new evidence says so. For example: on the account this tool was built against, posts
formatted as a single, concrete question measured far higher engagement than posts that
opened with a topic announcement or a full explainer; all-caps "newsletter" style headers
measured close to zero engagement by comparison; and LinkedIn posts carrying two or more
outbound links measured a fraction of the impressions of posts with none. The twelve rules
in `src/core/lint.js` (R1 through R12) each cite the specific observation behind them.

Those observations are account-specific, not a universal claim about what content
performs well everywhere. The account handles a gate checks against (which X handle, which
LinkedIn profile, which dev.to username) are configuration, not something baked into the
tool's premise — point postwright at your own account and its own history and the same
mechanism applies, but the specific thresholds encoded in this repo reflect the account it
was measured on. If you fork this and adjust a rule, the expectation (see
`CONTRIBUTING.md`) is that you bring your own measurement, not just a preference.

## Install

- Node.js 24 or newer.
- Python 3.12 with Pillow, for the sibling `diagif` tool that renders native GIF visuals
  for LinkedIn posts. `diagif` is a separate project; point `paths.diagif` at its entry
  script (see Configure, below).
- A `browser-harness` binary for the browser-driven X and LinkedIn publishers. These
  publishers act through a real logged-in browser session rather than an unofficial API.

```bash
npm test
```

runs the full test suite offline — no network or credentials required.

## Configure

Real, machine-local paths (where your browser harness binary lives, where your credential
file lives, where the `diagif` and Claude CLI entry points live) belong in
`postwright.config.json`, which is gitignored and never committed. Copy the template to
get started:

```bash
cp postwright.config.example.json postwright.config.json
```

Then edit the `paths` object with the real locations for your machine. Every key is
optional — an unset key falls back to its environment variable
(`POSTWRIGHT_SECRET_FILE`, `POSTWRIGHT_BROWSER_HARNESS`, `POSTWRIGHT_DIAGIF`,
`POSTWRIGHT_CLAUDE_CLI`), then to a generic platform default. See `src/core/config.js`
for the exact resolution order.

Credentials themselves (API keys, session cookies) never belong in this config file or in
any file under this repository — they belong in your own secret store or an authenticated
browser session, referenced only by path.

## The one-command flow: `postwright run`

```bash
postwright run <topic> [--brain NAME] [--visual mindmap|diagram] [--channels x,devto,linkedin] [--release --confirm] [--out DIR]
```

`run` stages a draft for `<topic>`, lints it against the evidence gates, and prints a
per-channel readiness table. By default it stops there — nothing is published. Only when
both `--release` and `--confirm` are passed does it go on to attempt a real release, one
channel at a time, in the order given by `--channels` (or `x`, `linkedin`, `devto` by
default), stopping at the first channel that refuses (fails lint, fails readback
verification, or hits a cadence/duplicate guard) or whose outcome is uncertain, rather than
continuing on to the next.

`--brain` selects the editorial source for the draft text (see the `draft` command,
below); `--visual` selects which native visual `diagif` renders for the LinkedIn draft.

## Individual commands

```bash
postwright draft <topic> [--gif|--no-gif] [--brain NAME] [--visual mindmap|diagram] [--out DIR]
postwright lint <slug>|--all [--out DIR] [--x-evidence URL --replies N --bookmarks N] [--force REASON]
postwright status [--out DIR]
postwright release <slug> --channel x|devto|linkedin --confirm [--out DIR]
postwright auth
postwright doctor
```

- **`draft`** stages X, LinkedIn, and dev.to copy plus a manifest for one topic. `--brain`
  chooses how the copy is generated (`claude-cli` for real content, or the deterministic
  `template` default used for offline tests — template output says nothing and is never
  publishable). A GIF is rendered by default; `--no-gif` opts out explicitly. `--visual`
  chooses which native visual `diagif` renders (`diagram` by default, or `mindmap`). A
  mind map that leaves more than a quarter of its frame empty at the top or bottom records
  a `visualWarning` in the manifest rather than failing the draft.
- **`lint`** runs all twelve gates against one draft (or every draft, with `--all`) and
  reports pass/fail per rule with the evidence behind each one. `--x-evidence` records
  measured same-topic X engagement to satisfy the dev.to engagement gate; `--force` records
  a deliberate, reasoned exception to that same gate only.
- **`status`** prints the current per-channel gate state for one or all drafts, without
  touching a network or a browser.
- **`release`** publishes exactly one channel of one draft for real, and only runs at all
  if `--confirm` is present.
- **`auth`** reports whether each channel's credentials or browser session look usable,
  without ever printing a credential value.
- **`doctor`** checks local environment health: Node version, whether the configured
  `browser-harness` and `diagif` paths exist, and whether a credential source is present.

## Safety model

- Nothing is published without an explicit `release <slug> --channel ... --confirm` (or,
  under the `run` flow, both `--release` and `--confirm`). There is no implicit or
  scheduled posting path.
- A click, a submitted form, or a 2xx HTTP response is never treated as proof that
  something was actually posted. Every publisher reads its result back from the live page
  or API — the actual text, the actual owner, the actual identifier — and compares it
  against what was supposed to be sent before `release` reports success.
- If that readback can't be confirmed (the browser couldn't verify the post landed, the
  API response didn't match what was sent), the release is refused and the outcome is
  reported as uncertain — never as a clean failure. Reporting an uncertain outcome as a
  plain failure is exactly what leads to an automatic retry duplicate-posting something
  that may have actually gone through.
- Release also refuses on a stale local reservation, a duplicate dev.to title, too many
  releases in a short window, or content that changed since it was last linted.

Publishing is never automatic. It requires a human to run `release` with an explicit
`--confirm` (or `run` with both `--release` and `--confirm`), one channel at a time.
