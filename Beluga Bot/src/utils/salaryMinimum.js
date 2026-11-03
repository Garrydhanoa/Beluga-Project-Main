/**
 * The lowest salary a player can sign at. The SalSheet doesn't lift anyone to it any more:
 * a player keeps the salary they calculate to, and can't join a team, even for one day,
 * until Salary Crew moves them up with /salary-adjustment or the website's Salary panel.
 *
 * Column O (SAL lock) is their real salary. While it still reads NS the salary lock hasn't
 * reached them, so column N decides. Going by O alone would let anyone sign in that gap.
 */

const MIN_SALARY = 12.5;

function toNumber(value) {
    const n = parseFloat(String(value ?? '').replace(/^'/, '').trim());
    return Number.isFinite(n) ? n : null;
}

/** @returns {number|null} the salary that's too low, or null when it's fine or there isn't one */
function salaryBelowMinimum(locked, calculated = null) {
    const salary = toNumber(locked) ?? toNumber(calculated);
    return salary !== null && salary > 0 && salary < MIN_SALARY ? salary : null;
}

function belowMinimumMessage(salary) {
    return `Player's salary is ${salary}, under the ${MIN_SALARY} minimum. Salary Crew must move them up to ${MIN_SALARY} first.`;
}

module.exports = { MIN_SALARY, salaryBelowMinimum, belowMinimumMessage };
