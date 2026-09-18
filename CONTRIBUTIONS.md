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
