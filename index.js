/**
 * Account & model switcher — keep every login and choose which one to use.
 *
 * OMP stores all logged-in accounts and rotates between them by itself, so
 * there is no way to say "bill this one". Logging the other account out works
 * but then it has to be logged in again next time. It also picks the model
 * (provider) for a turn from whatever role you configured, so there is no quick
 * way to say "use ChatGPT for this one, Claude for the next".
 *
 * This lists every logged-in account across every provider (Claude, ChatGPT,
 * Gemini, DeepSeek, and any other you have logged in) together with the models
 * that provider offers, and lets you pick one account/model and switch to it.
 *
 * Commands (all prefixed, so typing "/cf" lists them together):
 *   /cf_account_switch   pick an account (and its model) from a menu
 *   /cf_model            pick just a model/provider to use
 *   /cf_account_next     flip straight to the next same-provider account
 *   /cf_account_list     show every account and the model in use
 *   /cf_chat_rename      rename the current chat/session
 *   /cf_prompt_edit      edit an earlier prompt and resend from that point
 *
 * Two independent switches happen here:
 *   - the account within a provider is chosen with a block (see accounts.js);
 *     nothing is ever logged out.
 *   - the active model/provider is chosen with pi.setModel, which is how OMP
 *     actually starts sending the next turn to that provider.
 */
import {
    accountStatus,
    describe,
    listAllAccounts,
    listSwitchable,
    providerLabel,
    switchTo,
} from "./accounts.js";

/** The live session model, or null when the API is unavailable. */
function currentModel(ctx) {
    try {
        if (ctx.models && typeof ctx.models.current === "function") {
            return ctx.models.current() || null;
        }
    } catch {
        // fall through
    }
    return null;
}

/** Every model OMP can use right now, grouped by provider id. */
function modelsByProvider(ctx) {
    const grouped = new Map();
    let models = [];
    try {
        if (ctx.models && typeof ctx.models.list === "function") {
            models = ctx.models.list() || [];
        }
    } catch {
        models = [];
    }
    if (!Array.isArray(models)) {
        return grouped;
    }
    for (const model of models) {
        if (!model || !model.provider) {
            continue;
        }
        if (!grouped.has(model.provider)) {
            grouped.set(model.provider, []);
        }
        grouped.get(model.provider).push(model);
    }
    return grouped;
}

function modelName(model) {
    return (model && (model.name || model.id)) || "unknown model";
}

function isSameModel(a, b) {
    return Boolean(a && b && a.provider === b.provider && a.id === b.id);
}

/** The line shown for a model in the model menu, marking the one in use. */
function modelLabel(model, current) {
    return `${modelName(model)}${isSameModel(model, current) ? "  (current)" : ""}`;
}

/** Announce the result the same way wherever the switch came from. */
function announce(ctx, account, model) {
    const org = account.org ? ` (${account.org})` : "";
    const modelPart = model ? ` — model ${modelName(model)}` : "";
    ctx.ui.notify(
        `Now using ${providerLabel(account.provider)}: ${account.email}${org}${modelPart}. ` +
            "Other accounts stay logged in.",
        "success"
    );
}

/** Collapse a prompt to one short line for the picker. */
function oneLine(text, max) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** The plain text of a user message entry, or "" if it carries none. */
function userPromptText(entry) {
    const content = entry && entry.message && entry.message.content;
    if (typeof content === "string") {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .map((block) =>
                typeof block === "string"
                    ? block
                    : block && typeof block.text === "string"
                      ? block.text
                      : ""
            )
            .filter(Boolean)
            .join("\n");
    }
    return "";
}

/**
 * Edit an earlier prompt and resend from that point.
 *
 * This drives OMP's own session tree: navigating to a past user message moves
 * the active leaf to that message's parent (append-only — nothing is deleted),
 * then loads the old text into the composer so it can be edited and resent as a
 * new branch. The original chat stays in the tree, reachable from `/tree`.
 */
async function editPrompt(ctx) {
    if (typeof ctx.navigateTree !== "function") {
        ctx.ui.notify(
            "Editing a past prompt isn't supported in this OMP version.",
            "info"
        );
        return;
    }
    if (typeof ctx.waitForIdle === "function") {
        await ctx.waitForIdle();
    }

    let entries = [];
    try {
        if (ctx.sessionManager && typeof ctx.sessionManager.getBranch === "function") {
            entries = ctx.sessionManager.getBranch() || [];
        }
    } catch (err) {
        ctx.ui.notify(`Could not read the chat: ${err.message}`, "error");
        return;
    }

    const prompts = entries
        .filter(
            (e) =>
                e &&
                e.type === "message" &&
                e.message &&
                e.message.role === "user"
        )
        .map((e) => ({ id: e.id, text: userPromptText(e) }))
        .filter((p) => p.id && p.text.trim());
    if (prompts.length === 0) {
        ctx.ui.notify("There is no earlier prompt to edit yet.", "info");
        return;
    }

    // Newest first, and don't flood the menu.
    const recent = prompts.slice(-15).reverse();
    const labels = recent.map((p, i) => `${i + 1}. ${oneLine(p.text, 70)}`);
    const choice = await ctx.ui.select("Edit which prompt?", labels);
    if (!choice) {
        return; // cancelled
    }
    const picked = recent[labels.indexOf(choice)];
    if (!picked) {
        return;
    }

    try {
        // Move the active branch back to just before that prompt. Non-destructive:
        // the original prompt and its replies stay in the tree.
        await ctx.navigateTree(picked.id);
    } catch (err) {
        ctx.ui.notify(`Could not go back to that prompt: ${err.message}`, "error");
        return;
    }

    // Load the old prompt into the composer for editing (works whether or not
    // navigateTree already restored the draft).
    if (ctx.ui && typeof ctx.ui.setEditorText === "function") {
        try {
            ctx.ui.setEditorText(picked.text);
        } catch {
            // prefill is best-effort
        }
    }
    ctx.ui.notify(
        "Loaded your earlier prompt into the input box. Edit it and press Enter " +
            "to resend from that point — your original chat stays saved (see /tree).",
        "success"
    );
}

export default function accountSwitcher(pi) {
    const canSetModel = () => typeof pi.setModel === "function";

    /**
     * After an account is chosen, pick a model for that provider and make it
     * the active one. Leaves the account switched even if no model is set.
     */
    async function chooseAndSetModel(ctx, provider, account) {
        const models = modelsByProvider(ctx).get(provider) || [];
        if (!canSetModel() || models.length === 0) {
            // Account is switched; the model API isn't available or the
            // provider has no usable model to move to, so stop here.
            announce(ctx, account, null);
            return;
        }

        let model = models[0];
        if (models.length > 1) {
            const current = currentModel(ctx);
            const labels = models.map((m) => modelLabel(m, current));
            const choice = await ctx.ui.select(
                `Model for ${providerLabel(provider)}`,
                labels
            );
            if (!choice) {
                // Cancelled the model menu — keep the account switch, don't
                // touch the model.
                announce(ctx, account, null);
                return;
            }
            model = models[labels.indexOf(choice)] || models[0];
        }

        try {
            const ok = await pi.setModel(model);
            if (ok) {
                announce(ctx, account, model);
            } else {
                ctx.ui.notify(
                    `Switched to ${account.email}, but ${modelName(model)} has no usable login yet.`,
                    "info"
                );
            }
        } catch (err) {
            ctx.ui.notify(
                `Switched account, but could not set the model: ${err.message}`,
                "error"
            );
        }
    }

    /** The menu: every logged-in account, pick one, then pick its model. */
    async function pick(ctx) {
        let accounts;
        try {
            accounts = listAllAccounts();
        } catch (err) {
            ctx.ui.notify(`Could not read the accounts: ${err.message}`, "error");
            return;
        }

        if (accounts.length === 0) {
            ctx.ui.notify(
                "No accounts are logged in. Run /login to add one.",
                "info"
            );
            return;
        }

        // The menu is a list of plain lines, so the label has to carry
        // everything: provider, who, organisation, and which one is in use.
        const labels = accounts.map(describe);
        const choice = await ctx.ui.select("Switch account / model", labels);
        if (!choice) {
            return; // cancelled
        }
        const account = accounts[labels.indexOf(choice)];
        if (!account) {
            return;
        }

        // 1) Make this account the only usable one for its provider. This is a
        //    no-op for a single-login provider beyond clearing any stale block.
        let switched;
        try {
            switched = switchTo(account.id, undefined, account.provider);
            switched.providerLabel = account.providerLabel;
        } catch (err) {
            ctx.ui.notify(`Could not switch account: ${err.message}`, "error");
            return;
        }

        // 2) Offer the provider's models and make the chosen one active.
        await chooseAndSetModel(ctx, account.provider, switched);
    }

    /** Pick just a model/provider to use, across everything you can run. */
    async function pickModel(ctx) {
        if (!ctx.models || typeof ctx.models.list !== "function" || !canSetModel()) {
            ctx.ui.notify(
                "Model switching is not available in this OMP version.",
                "info"
            );
            return;
        }
        let models = [];
        try {
            models = ctx.models.list() || [];
        } catch (err) {
            ctx.ui.notify(`Could not read the models: ${err.message}`, "error");
            return;
        }
        if (!Array.isArray(models) || models.length === 0) {
            ctx.ui.notify(
                "No models are available. Run /login to add a provider.",
                "info"
            );
            return;
        }
        const current = currentModel(ctx);
        const labels = models.map(
            (m) =>
                `${providerLabel(m.provider)}: ${modelName(m)}` +
                (isSameModel(m, current) ? "  (current)" : "")
        );
        const choice = await ctx.ui.select("Switch model", labels);
        if (!choice) {
            return; // cancelled
        }
        const model = models[labels.indexOf(choice)];
        if (!model) {
            return;
        }
        try {
            const ok = await pi.setModel(model);
            ctx.ui.notify(
                ok
                    ? `Now using ${providerLabel(model.provider)} — ${modelName(model)}.`
                    : `Could not switch to ${modelName(model)} (no usable login).`,
                ok ? "success" : "error"
            );
        } catch (err) {
            ctx.ui.notify(`Could not switch model: ${err.message}`, "error");
        }
    }

    /** No menu: go to the next same-provider account and say who it is. */
    async function next(ctx) {
        let accounts;
        try {
            accounts = listSwitchable();
        } catch (err) {
            ctx.ui.notify(`Could not read the accounts: ${err.message}`, "error");
            return;
        }
        if (accounts.length < 2) {
            ctx.ui.notify(
                "There is only one account to flip between. Use /cf_account_switch to change provider or model.",
                "info"
            );
            return;
        }
        const here = accounts.findIndex((a) => a.active);
        const target = accounts[(here + 1) % accounts.length];
        try {
            announce(ctx, switchTo(target.id, undefined, target.provider), null);
        } catch (err) {
            ctx.ui.notify(`Could not switch: ${err.message}`, "error");
        }
    }

    /** Show every logged-in account and the model currently in use. */
    function showList(ctx) {
        let accounts = [];
        try {
            accounts = listAllAccounts();
        } catch (err) {
            ctx.ui.notify(`Could not read the accounts: ${err.message}`, "error");
            return;
        }
        const lines = [
            accounts.length
                ? accounts.map(describe).join("\n")
                : "No accounts are logged in.",
        ];
        const limited = accounts.filter((a) => accountStatus(a).kind === "limited");
        if (limited.length) {
            lines.push(
                `\n${limited.length} account${limited.length > 1 ? "s" : ""} rate-limited right now — switch to another with /cf_account_switch.`
            );
        }
        const model = currentModel(ctx);
        if (model) {
            lines.push(
                `\nCurrent model: ${providerLabel(model.provider)} — ${modelName(model)}`
            );
        }
        ctx.ui.notify(lines.join("\n"), "info");
    }

    /**
     * Rename the current chat/session. The new name comes from the command
     * argument (`/cf_chat_rename Billing bug`), or from a prompt when none is
     * typed and the UI can ask.
     */
    async function renameChat(args, ctx) {
        if (typeof pi.setSessionName !== "function") {
            ctx.ui.notify(
                "Renaming chats isn't supported in this OMP version.",
                "info"
            );
            return;
        }
        const current =
            typeof pi.getSessionName === "function"
                ? String(pi.getSessionName() || "")
                : "";
        let name = String(args || "").trim();
        if (!name && ctx.ui && typeof ctx.ui.input === "function") {
            try {
                const answer = await ctx.ui.input("Rename this chat", current);
                if (answer == null) {
                    return; // cancelled
                }
                name = String(answer).trim();
            } catch {
                name = "";
            }
        }
        if (!name) {
            ctx.ui.notify(
                "Give the chat a name, e.g. /cf_chat_rename Billing bug fix.",
                "info"
            );
            return;
        }
        if (name === current) {
            ctx.ui.notify(`This chat is already called "${name}".`, "info");
            return;
        }
        try {
            await pi.setSessionName(name);
            ctx.ui.notify(`Chat renamed to "${name}".`, "success");
        } catch (err) {
            ctx.ui.notify(`Could not rename the chat: ${err.message}`, "error");
        }
    }

    const handler = async (args, ctx) => {
        const word = String(args || "").trim().toLowerCase();
        if (word === "next" || word === "toggle") {
            return next(ctx);
        }
        if (word === "model") {
            return pickModel(ctx);
        }
        if (word === "list" || word === "who") {
            return showList(ctx);
        }
        return pick(ctx);
    };

    // Every command is prefixed so typing "/cf" lists all of them together
    // instead of hunting through OMP's own commands.
    pi.registerCommand("cf_account_switch", {
        description:
            "CF Switcher — pick which logged-in account and model to use",
        handler,
    });
    pi.registerCommand("cf_model", {
        description: "CF Switcher — pick which model/provider to use",
        handler: async (_args, ctx) => pickModel(ctx),
    });
    pi.registerCommand("cf_account_next", {
        description: "CF Switcher — flip to the next same-provider account",
        handler: async (_args, ctx) => next(ctx),
    });
    pi.registerCommand("cf_account_list", {
        description: "CF Switcher — show every account and the model in use",
        handler: async (_args, ctx) => showList(ctx),
    });
    pi.registerCommand("cf_chat_rename", {
        description: "CF Switcher — rename the current chat/session",
        handler: renameChat,
    });
    pi.registerCommand("cf_prompt_edit", {
        description: "CF Switcher — edit an earlier prompt and resend from there",
        handler: async (_args, ctx) => editPrompt(ctx),
    });
}
