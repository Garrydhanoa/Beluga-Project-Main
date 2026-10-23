// The privileged-access allowlist (ADMIN_DISCORD_IDS — the operator + the owner).
// Lives in its own module so the auth options, the security layer and the audit
// log can all read it without importing each other in a cycle.

export function getAdminDiscordIds() {
  const raw = process.env.ADMIN_DISCORD_IDS || process.env.ADMIN_DISCORD_ID || ''
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

/**
 * "Super admin" = an ID explicitly listed in ADMIN_DISCORD_IDS. That list is the
 * league's privileged-access allowlist (it already bypasses the director check),
 * so it is also what gates the hidden audit log at /admin/dashboard/higgenlogs,
 * and it is the only set of people who can never be IP-banned or logged out.
 *
 * Being a director is NOT enough — the whole point of the audit log is that the
 * people it might incriminate cannot read or curate it. Fails CLOSED: if the env
 * var is unset, nobody is a super admin.
 */
export function isSuperAdminId(discordUserId) {
  if (!discordUserId) return false
  return getAdminDiscordIds().includes(String(discordUserId))
}
