# Contribution & Outreach Notes

Short log of what this plugin does, where we shared it, and what we told people.

## What the plugin does

- Lists **every logged-in account across all providers** (Claude, ChatGPT/Codex, Gemini, DeepSeek, and any other you have logged in).
- **Switch account** inside a provider — blocks the sibling accounts and clears the block on your chosen one. Nothing is logged out, only the `auth_credential_blocks` table is touched, and it is reversible.
- **Switch model / provider** with `/cf_model` — picks any available model and switches the active one via OMP's `setModel`.
- **Unified menu** — `/cf_account_switch` lets you pick an account, then its model, in one place.
- Commands: `/cf_account_switch`, `/cf_model`, `/cf_account_next`, `/cf_account_list`.

## Install

```
git clone https://github.com/Akash00-git/cf-omp-account-switcher-plugin
omp plugin install ./cf-omp-account-switcher-plugin
```

Then restart/reload OMP and run `/cf_account_switch` (accounts) or `/cf_model` (models).

## Submitted to OMP

- Plugin submission request: https://github.com/can1357/oh-my-pi/issues/12426

## Outreach log

Where we found a real user need, we posted a disclosed, tailored reply with the repo URL and the install command above.

| Platform / thread | What the user needed | What we answered |
|---|---|---|
| Issue [#4614](https://github.com/can1357/oh-my-pi/issues/4614) — "Allow choosing the active ChatGPT account for a session" | Manually pick which ChatGPT account a session uses | Our account switcher does exactly this (`/cf_account_switch`); shared URL + install |
| Issue [#4829](https://github.com/can1357/oh-my-pi/issues/4829) — "add `/usage switch` to manually select OAuth account" | "use account 2" without `--profile`/`--api-key` | Plugin pins the chosen account via the block table; shared URL + install |
| Issue [#6342](https://github.com/can1357/oh-my-pi/issues/6342) — "Openai Model Switch" | Switch between GPT and Codex models | `/cf_model` switches the active model on demand; shared URL + install |
| Discussion [#11652](https://github.com/can1357/oh-my-pi/discussions/11652) (Q&A) — "Switching a long-running session to cheaper models" | Move the main session to cheaper models mid-run | `/cf_model` flips the main model instantly; honest caveat that parked subagents keep their old model; shared URL + install |

## Notes

- Web search on Google / Reddit / Stack Overflow was rate-limited in our environment, so the community we reached is OMP's GitHub (issues + discussions), which is where OMP users are.
- We deliberately kept posts few, disclosed (each says "I'm the author"), and on-topic. The GitHub account is new, and mass-posting the same link is a spam signal.
- We did **not** post on other people's similar plugins (e.g. `omp-multi-auth`) or on account-pinning threads already covered, to avoid duplicate/off-topic promotion.

## Community search — round 2 (Google / Reddit / SO / HN)


Searched the wider web directly through the headless browser and public APIs
(DuckDuckGo, Hacker News Algolia, Stack Exchange API, Reddit).

| Platform | Method | Result |
|---|---|---|
| Hacker News | Algolia API | OMP is discussed (launch posts, "having fun with…", local-model tuning) — **general discussion, no feature request** for account/model switching |
| Stack Overflow / Stack Exchange | API + `site:` search | **No OMP questions** — only Raspberry-Pi / oh-my-zsh noise from the word "pi" |
| Reddit | JSON + old.reddit | **Nothing** — Reddit now gates anonymous access ("accounts required to access old Reddit") |
| Google (via DuckDuckGo) | `site:` + keyword search | Only the OMP repo, docs, MacPorts, package pages |

**Conclusion:** no *new* feature request for this plugin exists outside GitHub. The
only in-domain unmet request is **auto-failover to another account/model when the
primary is rate-limited** (OMP issues [#5912](https://github.com/can1357/oh-my-pi/issues/5912),
[#7031](https://github.com/can1357/oh-my-pi/issues/7031)). That needs a live OMP
rate-limit runtime event that cannot be verified in this environment, so it was
**not implemented blind** (a half-working failover is worse than none). Left as a
documented follow-up.

## Feature implemented — rate-limit visibility (v1.2.0)


- **What was requested:** users repeatedly hit provider rate-limits and want to
  see/act on which login is limited. Related OMP threads:
  [#5912](https://github.com/can1357/oh-my-pi/issues/5912) and
  [#7031](https://github.com/can1357/oh-my-pi/issues/7031) (rate-limit failover),
  and [#10733](https://github.com/can1357/oh-my-pi/issues/10733) (quota
  exhaustion shown as a generic rate limit).
- **Where:** OMP GitHub issues (no equivalent request found on Google/Reddit/SO/HN).
- **What we implemented:** the switch menu and `/cf_account_list` now label every
  account's status — `in use`, `rate-limited · free in <2h>` (with time until it
  clears), or `set aside` (parked by the switcher). `/cf_account_list` also prints
  a one-line count of how many logins are rate-limited right now. This tells apart
  a real provider rate-limit (a short OMP-written block) from the switcher's own
  long "set aside" block.
- **New export:** `accountStatus(account)` in `accounts.js`.
- **Not done (on purpose):** automatic failover — it needs a live rate-limit
  runtime event we cannot verify in this environment, so it stays a follow-up
  rather than shipping half-working. This feature makes the limit *visible* so the
  manual switch (`/cf_account_switch`, `/cf_model`) is one glance away.
- **Tested:** 13 checks via a Node + `sql.js` harness against OMP's real DB schema
  (status classification, time formatting, list summary, and switch regression).

## Feature implemented — rename the current chat (v1.3.0)


- **What was requested:** add a way to rename the current chat/session from the
  plugin.
- **What we implemented:** a new `/cf_chat_rename` command. It renames the
  current session via OMP's `pi.setSessionName(...)`. The name comes from the
  command argument (`/cf_chat_rename Billing bug fix`); with no argument it asks
  through `ctx.ui.input` when the UI supports it. It ignores empty/unchanged
  names and degrades gracefully on older OMP builds without `setSessionName`.
- **Tested:** 10 checks via a Node harness with a mock `pi` (argument path,
  prompt path, trimming, cancel, empty-name guidance, same-name no-op, and the
  missing-API fallback).
