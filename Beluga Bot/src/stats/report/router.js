/**
 * Central dispatch for all `rs:` report interactions (buttons, selects, modal).
 * Swallows expired/double-ack errors (10062 / 40060) so they never spam logs or
 * crash the handler — the user just re-clicks the still-present panel.
 */

const ids = require('./ids');
const flow = require('./flow');
const Logger = require('../../utils/logger');
const higgenLog = require('../../utils/higgenLog');

const HANDLERS = {
    start: (i) => flow.startReport(i),
    group: (i, p) => flow.handleGroupModal(i, p),
    assign: (i, p) => flow.handleAssign(i, p),
    match: (i, p) => flow.handleMatch(i, p),
    sub: (i, p) => flow.handleSub(i, p),
    page: (i, p) => flow.handlePage(i, p),
    submit: (i, p) => flow.handleSubmit(i, p),
    confirm: (i, p) => flow.handleConfirm(i, p),
    reject: (i, p) => flow.handleReject(i, p),
    cancel: (i, p) => flow.handleCancel(i, p),
    dispute: (i, p) => flow.handleDispute(i, p),
    scfinal: (i, p) => flow.handleSalaryFinalize(i, p),
};

async function route(interaction) {
    const { action, parts } = ids.parse(interaction.customId);
    const handler = HANDLERS[action];
    if (!handler) {
        higgenLog.markSubRouterOutcome(interaction, {
            outcome: 'unhandled',
            note: `No handler is registered for the report action "${action}".`,
        });
        return;
    }
    try {
        await handler(interaction, parts);
    } catch (err) {
        // Errors are caught here and never rethrown, so bot.js can't see them —
        // tell the audit log directly or a crashed report would read as a success.
        if (err?.code === 10062 || err?.code === 40060) {
            higgenLog.markSubRouterOutcome(interaction, {
                outcome: 'expired',
                note: 'The button was clicked after its interaction had timed out.',
            });
            return; // expired / already acknowledged
        }
        higgenLog.markSubRouterOutcome(interaction, {
            outcome: 'failed',
            note: `The report step "${action}" threw an error.`,
            error: err,
        });
        Logger.error(`report router error on '${action}'`, err);
        try {
            if (interaction.isRepliable?.() && !interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ Something went wrong. Try again, or ping salary crew.', flags: 64 });
            }
        } catch { /* ignore secondary failures */ }
    }
}

module.exports = { route };
