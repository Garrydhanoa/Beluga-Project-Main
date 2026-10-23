/**
 * customId codec for the report flow. Format: `rs:<action>:<part>:<part>...`
 * Kept well under Discord's 100-char custom_id limit (ids are small ints/codes).
 *
 * Actions:
 *   rs:start                          panel "Report Series" button
 *   rs:group:<sessionId>              modal submit carrying the group link
 *   rs:match:<sessionId>:<side>:<i>   string-select for player slot i on side h/a
 *   rs:sub:<sessionId>:<side>:<i>     user-select to assign a sub to slot i
 *   rs:submit:<sessionId>:<side>      captain submits their side's matches
 *   rs:confirm:<sessionId>:<side>     final confirm by a side
 *   rs:reject:<sessionId>:<side>      reject at final confirm
 *   rs:cancel:<sessionId>             cancel the whole report
 *   rs:scconfirm:<sessionId>          salary-crew instant finalize
 *   rs:ff                             panel "Report Forfeit" button (salary crew)
 *   rs:ffpick:<winnerCode>            forfeit outcome: h | a | double
 */

const PREFIX = 'rs';

function build(action, ...parts) {
    const id = [PREFIX, action, ...parts.map((p) => String(p))].join(':');
    if (id.length > 100) throw new Error(`customId too long (${id.length}): ${id}`);
    return id;
}

function parse(customId) {
    const segments = String(customId || '').split(':');
    return { prefix: segments[0], action: segments[1], parts: segments.slice(2) };
}

function isReportId(customId) {
    return String(customId || '').startsWith(`${PREFIX}:`);
}

module.exports = { PREFIX, build, parse, isReportId };
