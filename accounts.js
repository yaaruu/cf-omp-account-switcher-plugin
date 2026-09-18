/**
 * Account switching for OMP's stored OAuth logins.
 *
 * OMP keeps every logged-in account in its credential database and picks
 * between them on its own, so there is no way to say "use this one". It does
 * however skip any account that carries a *block* - the same marker it writes
 * itself when a provider rate-limits an account.
 *
 * Switching therefore means: block every account except the chosen one, and
 * clear the chosen one's block. Nothing is logged out, no token is touched,
 * and the change is reversible by switching back.
 *
 * No database writes happen outside these two calls, and the credential rows
 * themselves are never modified - only the separate block table.
 */
import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

// A block far enough out to mean "not this one", while still being an
// ordinary expiring block rather than a permanent state OMP cannot undo.
const BLOCK_MS = 10 * 365 * 24 * 60 * 60 * 1000;

// Blocks further out than this are ones *we* wrote to sideline an account
// (see BLOCK_MS). Blocks nearer than this are a real provider rate-limit,
// which OMP writes itself and clears when the limit resets. 60 days is far
// longer than any provider rate-limit but far shorter than our own block.
const RATE_LIMIT_HORIZON_MS = 60 * 24 * 60 * 60 * 1000;

// Friendly names for the providers OMP can log in to. Anything not listed
// falls back to a tidied-up version of the raw id (see providerLabel).
const PROVIDER_LABELS = {
    anthropic: "Claude (Anthropic)",
    openai: "ChatGPT (OpenAI)",
    "openai-codex": "ChatGPT (Codex)",
    google: "Gemini (Google)",
    "google-vertex": "Gemini (Vertex)",
    "google-gemini-cli": "Gemini (CLI)",
    deepseek: "DeepSeek",
    xai: "Grok (xAI)",
    zai: "Z.ai (GLM)",
    moonshot: "Kimi (Moonshot)",
    mistral: "Mistral",
    groq: "Groq",
    cerebras: "Cerebras",
    "github-copilot": "GitHub Copilot",
    "amazon-bedrock": "Amazon Bedrock",
    azure: "Azure OpenAI",
    together: "Together",
    nvidia: "NVIDIA",
    minimax: "MiniMax",
    qwen: "Qwen",
    "qwen-portal": "Qwen",
};

/**
 * A human-readable name for a provider id.
 *
 * Known providers use the friendly names above; anything else is turned into
 * a readable title so a brand-new provider still shows something sensible.
 */
export function providerLabel(provider) {
    if (PROVIDER_LABELS[provider]) {
        return PROVIDER_LABELS[provider];
    }
    const pretty = String(provider || "")
        .split(/[-_:]/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    return pretty || String(provider || "");
}

/** Where the credentials live, honouring `--profile` and the env override. */
export function agentDbPath(env = process.env) {
    const dir = env.PI_CODING_AGENT_DIR || join(homedir(), ".omp", "agent");
    return join(dir, "agent.db");
}

function open(dbPath, readonly) {
    return new Database(dbPath, readonly ? { readonly: true } : undefined);
}

/**
 * Every usable account for a provider, newest login last.
 *
 * `active` marks the account OMP may currently use: an account is inactive
 * only while a block is still in the future.
 */
export function listAccounts(dbPath = agentDbPath(), provider = "anthropic") {
    const db = open(dbPath, true);
    try {
        const now = Date.now();
        const blocked = new Map();
        for (const row of db
            .query("SELECT credential_id, MAX(blocked_until_ms) AS until FROM auth_credential_blocks GROUP BY credential_id")
            .all()) {
            blocked.set(row.credential_id, row.until);
        }
        const rows = db
            .query(
                `SELECT id, data FROM auth_credentials
                  WHERE provider = ? AND credential_type = 'oauth'
                    AND disabled_cause IS NULL
                  ORDER BY created_at`
            )
            .all(provider);
        return rows.map((row) => {
            let info = {};
            try {
                info = JSON.parse(row.data) || {};
            } catch {
                info = {};
            }
            const until = blocked.get(row.id) || 0;
            return {
                id: row.id,
                provider,
                email: info.email || `account ${row.id}`,
                org: info.orgName || "",
                active: until <= now,
                blockedUntil: until > now ? until : null,
            };
        });
    } finally {
        db.close();
    }
}

/**
 * Every account worth offering in the menu.
 *
 * Only providers holding more than one login are included: with a single
 * account there is nothing to switch to, and listing it would just be noise.
 */
export function listSwitchable(dbPath = agentDbPath()) {
    const db = open(dbPath, true);
    let providers = [];
    try {
        providers = db
            .query(
                `SELECT provider FROM auth_credentials
                  WHERE credential_type = 'oauth' AND disabled_cause IS NULL
                  GROUP BY provider HAVING COUNT(*) > 1
                  ORDER BY provider`
            )
            .all()
            .map((row) => row.provider);
    } finally {
        db.close();
    }
    return providers.flatMap((provider) => listAccounts(dbPath, provider));
}

/**
 * Every logged-in account across every provider, newest login last.
 *
 * Unlike listSwitchable this keeps single-login providers too, so the menu can
 * show all of them together (Claude, ChatGPT, Gemini, DeepSeek, and so on) and
 * let you pick which provider/account to work with. Each account carries a
 * `providerLabel` for display.
 */
export function listAllAccounts(dbPath = agentDbPath()) {
    const db = open(dbPath, true);
    let providers = [];
    try {
        providers = db
            .query(
                `SELECT provider FROM auth_credentials
                  WHERE credential_type = 'oauth' AND disabled_cause IS NULL
                  GROUP BY provider
                  ORDER BY provider`
            )
            .all()
            .map((row) => row.provider);
    } finally {
        db.close();
    }
    return providers.flatMap((provider) =>
        listAccounts(dbPath, provider).map((account) => ({
            ...account,
            providerLabel: providerLabel(provider),
        }))
    );
}

/**
 * Make one account the only one OMP may use.
 *
 * Returns the account that is now in use. Throws when the id is not a stored
 * account for that provider, so a stale menu choice cannot block everything
 * and leave the provider unusable.
 */
export function switchTo(id, dbPath = agentDbPath(), provider = "anthropic") {
    const accounts = listAccounts(dbPath, provider);
    const chosen = accounts.find((a) => a.id === id);
    if (!chosen) {
        throw new Error(`No stored ${provider} account with id ${id}`);
    }
    const db = open(dbPath, false);
    try {
        const now = Date.now();
        const key = `${provider}:oauth`;
        // One transaction: the provider is never left with every account
        // blocked, even if the process dies midway.
        db.transaction(() => {
            const block = db.query(
                `INSERT INTO auth_credential_blocks
                     (credential_id, provider_key, block_scope, blocked_until_ms, updated_at)
                 VALUES (?, ?, '', ?, ?)
                 ON CONFLICT (credential_id, provider_key, block_scope)
                 DO UPDATE SET blocked_until_ms = excluded.blocked_until_ms,
                               updated_at = excluded.updated_at`
            );
            const unblock = db.query(
                "DELETE FROM auth_credential_blocks WHERE credential_id = ?"
            );
            for (const account of accounts) {
                if (account.id === chosen.id) {
                    unblock.run(account.id);
                } else {
                    block.run(account.id, key, now + BLOCK_MS, Math.floor(now / 1000));
                }
            }
        })();
        return chosen;
    } finally {
        db.close();
    }
}

/** A short, human duration like "45m", "2h", or "3d" (rounded, min "1m"). */
function humanUntil(ms) {
    const mins = Math.max(1, Math.round(ms / 60000));
    if (mins < 60) return `${mins}m`;
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return `${hrs}h`;
    return `${Math.round(hrs / 24)}d`;
}

/**
 * What state an account is in, for display.
 *
 *   { kind: "active",  label: "in use" }                         usable now
 *   { kind: "limited", label: "rate-limited · free in 2h" }      provider limit
 *   { kind: "parked",  label: "set aside" }                      sidelined by us
 *
 * "limited" vs "parked" is decided by how far the block reaches: a real
 * provider rate-limit clears within hours, while our own block (BLOCK_MS)
 * sits ~10 years out.
 */
export function accountStatus(account, now = Date.now()) {
    const until = account.blockedUntil || 0;
    if (account.active || until <= now) {
        return { kind: "active", label: "in use" };
    }
    const remaining = until - now;
    if (remaining > RATE_LIMIT_HORIZON_MS) {
        return { kind: "parked", label: "set aside" };
    }
    return { kind: "limited", label: `rate-limited · free in ${humanUntil(remaining)}` };
}

/** "Claude (Anthropic): shan@example.com — Org  (rate-limited · free in 2h)". */
export function describe(account) {
    const prov = account.providerLabel || providerLabel(account.provider);
    const who = account.email;
    const org = account.org ? ` — ${account.org}` : "";
    return `${prov}: ${who}${org}  (${accountStatus(account).label})`;
}
