/**
 * Shared slash-command options, so every moderation command asks for a reason and a
 * rule the same way. Discord requires required options to come before optional ones.
 */

const { ruleChoices } = require('./modConfig');

function user(builder, description = 'The member') {
    return builder.addUserOption((o) => o.setName('user').setDescription(description).setRequired(true));
}

function rule(builder, required = true) {
    return builder.addStringOption((o) => o.setName('rule').setDescription('Which rule this falls under').setRequired(required).addChoices(...ruleChoices()));
}

function reason(builder) {
    return builder.addStringOption((o) => o.setName('reason').setDescription('Why. This is kept on their record permanently.').setRequired(true).setMinLength(3).setMaxLength(1000));
}

function evidence(builder) {
    return builder.addAttachmentOption((o) => o.setName('evidence').setDescription('A screenshot or file. Stored permanently with the case.').setRequired(false));
}

function silent(builder) {
    return builder.addBooleanOption((o) => o.setName('silent').setDescription('Skip the DM to the member').setRequired(false));
}

module.exports = { user, rule, reason, evidence, silent };
