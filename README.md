# cf-omp-account-switcher-plugin

Keep every account logged in and choose which account **and model** OMP uses.

OMP stores all logged-in accounts and rotates between them on its own, so there
is no built-in way to say "use this one". It also picks the model (provider) for
a turn from your configured role, so there is no quick way to say "use ChatGPT
for this one, Claude for the next". This plugin puts every logged-in account —
across every provider (Claude, ChatGPT, Gemini, DeepSeek, and any other you have
logged in) — and the models each provider offers into one menu, and lets you
pick which account/model to work with. Nobody is ever logged out.

## Install

```
unzip -o cf-omp-account-switcher-plugin.zip -d ~/omp-plugins
omp plugin install ~/omp-plugins/cf-omp-account-switcher-plugin
```

Then restart OMP and type `/cf`.

Keep the `~/omp-plugins/cf-omp-account-switcher-plugin` folder — a local install
is linked to it, not copied.

## Commands

| Command | What it does |
|---|---|
| `/cf_account_switch` | Menu of every logged-in account (all providers). Pick one, then pick its model. |
| `/cf_model` | Menu of every model you can run right now — pick a model/provider directly. |
| `/cf_account_next` | Flip straight to the next account of the same provider, no menu. |
| `/cf_account_list` | Show every account and the model currently in use. |
| `/cf_chat_rename` | Rename the current chat/session — `/cf_chat_rename Billing bug fix` (or run it with no name to be asked). |
| `/cf_prompt_edit` | Pick one of your earlier prompts, edit it, and resend from that point. Non-destructive — the original stays in the tree. |

The account menu lists each provider and login, and marks each one's status —
which is **in use**, which OMP has **rate-limited** (with time until it frees up),
and which the switcher has **set aside**:

```
Switch account / model
❯ Claude (Anthropic): first@example.com — first@example.com's Organization  (in use)
  Claude (Anthropic): second@example.com — second@example.com's Organization  (rate-limited · free in 2h)
  ChatGPT (Codex): shan@example.com — prolite  (set aside)
```

So when a login gets rate-limited you can see it at a glance and pick another.
`/cf_account_list` also prints a one-line count of how many logins are rate-limited
right now.

After you pick an account, if that provider offers more than one model you get a
second menu to choose the model; the current model is marked. Picking the
account switches the login, and picking the model switches the provider/model
OMP uses for your next turn.

## Edit an earlier prompt

`/cf_prompt_edit` lists your recent prompts; pick one and it loads that prompt's
text back into the input box so you can add, remove, or change it and press Enter
to **resend from that point**.

This is safe. It drives OMP's own session tree, which is append-only: going back
to an earlier prompt just moves the active branch to before it and starts a new
branch when you resend. Your original prompt and its replies are never deleted —
they stay in the tree and you can return to them with `/tree`. (OMP already
supports the same thing natively via `/tree` or double-`Esc`; this command is a
quicker, more obvious way in.)

## How switching works

Two independent switches happen, and neither logs anyone out.

**Account** (which login inside a provider). OMP skips any account carrying a
**block** — the marker it writes itself when a provider rate-limits an account.
Switching an account puts a block on the same-provider accounts you are not
using and clears it on the one you are.

- Nothing is logged out and no token is touched.
- Only the `auth_credential_blocks` table is written; stored credentials are
  never modified.
- The database's own triggers bump `auth_change_revision`, which is how a
  running OMP notices — no restart needed after a switch.
- Switching back is the same command again.

**Model / provider** (Claude vs ChatGPT vs Gemini ...). Choosing a model calls
OMP's own `setModel`, the same thing `/model` uses, so your next turn is sent to
that provider and model. A model only appears when its provider has a usable
login, so you can only switch to something you can actually run.

## Requirements

- OMP 18 or newer
- One or more provider logins — add one with `/login`

Every logged-in provider is listed, even with a single account, so you can pick
its model. `/cf_account_next` still needs two or more logins for the *same*
provider — with one login there is no sibling account to flip to. Works with any
OAuth provider, including Anthropic (Claude Pro/Max), ChatGPT (Codex), Gemini,
and DeepSeek.

## Privacy

No network calls, no child processes, no dependencies beyond OMP's own runtime.
It reads only the account id, email and organisation name for the menu, and
never reads or transmits access or refresh tokens.

## Uninstall

```
omp plugin uninstall cf-omp-account-switcher-plugin
```

Switching leaves ordinary expiring blocks behind. To clear them and let OMP
rotate freely again, run `/cf_account_switch` and pick the account you want
left enabled before uninstalling.

MIT licensed.
