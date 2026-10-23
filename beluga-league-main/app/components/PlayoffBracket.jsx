'use client'

import { motion } from 'framer-motion'
import TeamLogo from './TeamLogo'

/**
 * The public playoff bracket.
 *
 * Styling is the site's own dark ocean glass with gold reserved for the final
 * and the champion — picked from three candidates rendered against real Season
 * 10 data. Team bars carry the franchise colour and the DB logo bleeds through,
 * which is what the league's hand-made graphics did.
 *
 * Layout: one column per round. Connectors work because every matchup wrapper in
 * a column is `flex-1`, so adjacent centres are exactly one wrapper-height apart
 * and the vertical joiner is always h-1/2 from centre. Under `md` the columns
 * stack and the connectors are dropped — a squeezed tree is unreadable on a
 * phone, and the same lesson is already baked into the homepage bracket.
 *
 * Dense type is deliberate here, so the wrapper carries `data-dense`:
 * app/mobile-responsive.css forces every div/span/p to 16px under 640px, which
 * would make a seed chip the same size as a team name.
 */

// ---------------------------------------------------------------------------
// Theme tokens
// ---------------------------------------------------------------------------

const THEME = {
    shell: 'relative rounded-3xl border border-white/10 bg-white/[0.02] p-5 sm:p-8',
    line: 'bg-cyan-400/30',
    roundLabel: 'text-[10px] font-black tracking-[0.25em] uppercase text-blue-300/70',
    roundMeta: 'text-[10px] text-white/30',
    card: 'rounded-xl border border-white/10 bg-white/[0.04] overflow-hidden backdrop-blur-sm transition-all duration-300 hover:border-blue-400/40 hover:shadow-[0_8px_30px_rgba(59,130,246,0.15)]',
    cardFinal: 'rounded-xl border border-yellow-400/40 bg-yellow-400/[0.06] overflow-hidden backdrop-blur-sm shadow-[0_0_30px_rgba(250,204,21,0.12)]',
    row: 'text-white',
    rowLose: 'opacity-45',
    name: 'text-white',
    score: 'text-white/40',
    scoreWin: 'text-emerald-300',
    winBar: 'bg-emerald-400',
    winBarFinal: 'bg-yellow-300',
    seed: 'bg-blue-500/15 border border-blue-400/30 text-blue-200',
  tbd: 'text-white/25',
}

const FALLBACK_COLOR = '#3b82f6'

/** Franchise-colour wash behind a team bar; the winner's is the stronger one. */
function rowBackground(color, isWinner) {
  const c = color || FALLBACK_COLOR
  return { background: isWinner ? `linear-gradient(90deg, ${c}33, transparent 70%)` : 'transparent' }
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Seed({ seed, theme }) {
  if (!seed) return <span className="w-5 shrink-0" aria-hidden="true" />
  return (
    <span className={`w-5 h-5 shrink-0 rounded flex items-center justify-center text-[10px] font-black tabular-nums ${theme.seed}`}>
      {seed}
    </span>
  )
}

function TeamRow({ team, seed, score, isWinner, decided, theme, isFinal }) {
  const named = Boolean(team?.name)
  return (
    <div
      className={`relative flex items-center gap-2 px-2.5 py-2 ${theme.row} ${decided && !isWinner ? theme.rowLose : ''}`}
      style={named ? rowBackground(team.color, isWinner) : undefined}
    >
      {/* Logo bleeding through the banner, as in the league's own graphics. */}
      {named && (
        <span className="pointer-events-none absolute inset-y-0 right-8 w-20 opacity-[0.18] flex items-center justify-end overflow-hidden" aria-hidden="true">
          <TeamLogo name={team.name} teamId={team.id} className="h-10 w-10" imgClassName="h-10 w-10 object-contain" />
        </span>
      )}

      {isWinner && (
        <span className={`absolute left-0 inset-y-0 w-[3px] ${isFinal ? theme.winBarFinal : theme.winBar}`} aria-hidden="true" />
      )}

      <Seed seed={seed} theme={theme} />

      <span className="w-6 h-6 shrink-0 flex items-center justify-center relative z-10">
        {named
          ? <TeamLogo name={team.name} teamId={team.id} className="w-full h-full" imgClassName="w-full h-full object-contain" />
          : <span className="w-2.5 h-2.5 rounded-full border border-dashed border-current opacity-40" aria-hidden="true" />}
      </span>

      <span className={`relative z-10 flex-1 truncate text-[13px] ${named ? theme.name : theme.tbd} ${isWinner ? 'font-black' : 'font-semibold'}`}>
        {named ? team.name : 'TBD'}
      </span>

      <span className={`relative z-10 text-[13px] font-black tabular-nums ${isWinner ? theme.scoreWin : theme.score}`}>
        {score == null ? '' : score}
      </span>
    </div>
  )
}

function ForfeitTag({ kind }) {
  if (kind !== 'ffw' && kind !== 'double_ff') return null
  return (
    <div className="px-2.5 py-1 text-[9px] font-black tracking-[0.2em] uppercase bg-black/30 text-orange-200">
      {kind === 'double_ff' ? 'Double forfeit' : 'Won by forfeit'}
    </div>
  )
}

function Matchup({ matchup, theme, isFinal }) {
  const decided = Boolean(matchup.winnerTeamId)
  return (
    <div className={isFinal ? theme.cardFinal : theme.card}>
      <TeamRow
        team={matchup.home} seed={matchup.homeSeed} score={matchup.homeScore}
        isWinner={decided && matchup.winnerTeamId === matchup.home?.id}
        decided={decided} theme={theme} isFinal={isFinal}
      />
      <div className="h-px bg-black/30" />
      <TeamRow
        team={matchup.away} seed={matchup.awaySeed} score={matchup.awayScore}
        isWinner={decided && matchup.winnerTeamId === matchup.away?.id}
        decided={decided} theme={theme} isFinal={isFinal}
      />
      <ForfeitTag kind={matchup.resultKind} />
    </div>
  )
}

/** The trophy already used on the homepage champion card. */
function Trophy({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v2c0 2.21 1.79 4 4 4h.19c.67 1.46 1.98 2.56 3.56 2.87V19H8v2h8v-2h-2.75v-3.13c1.58-.31 2.89-1.41 3.56-2.87H17c2.21 0 4-1.79 4-4V7c0-1.1-.9-2-2-2zM5 9V7h2v4c-1.1 0-2-.9-2-2zm14 0c0 1.1-.9 2-2 2V7h2v2z" />
    </svg>
  )
}

function ChampionCard({ champion, theme }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-2">
      <div
        className="relative w-full max-w-[220px] px-5 py-6 rounded-2xl text-center bg-gradient-to-b from-yellow-400/20 via-amber-500/10 to-transparent border-2 border-yellow-400/50 shadow-[0_0_50px_rgba(250,204,21,0.25)]"
      >
        <span
          className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[9px] font-black tracking-[0.2em] uppercase bg-yellow-400 text-yellow-950"
        >
          Champion
        </span>

        <Trophy className="h-12 w-12 mx-auto mb-2 text-yellow-300 drop-shadow-[0_0_14px_rgba(250,204,21,0.7)]" />

        {champion ? (
          <>
            <div className="w-14 h-14 mx-auto mb-2 flex items-center justify-center">
              <TeamLogo name={champion.name} teamId={champion.id} className="w-full h-full" imgClassName="w-full h-full object-contain" />
            </div>
            <div className="text-base font-black leading-tight text-white">
              {champion.name}
            </div>
          </>
        ) : (
          <div className={`text-base font-black ${theme.tbd}`}>TBD</div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bracket
// ---------------------------------------------------------------------------

export default function PlayoffBracket({ bracket }) {
  const theme = THEME
  if (!bracket || !bracket.rounds?.length) return null

  const rounds = bracket.rounds
  const finalRound = rounds[rounds.length - 1]
  const finalMatchup = finalRound?.matchups?.[0] || null
  const champion = finalMatchup?.winnerTeamId
    ? (finalMatchup.winnerTeamId === finalMatchup.home?.id ? finalMatchup.home : finalMatchup.away)
    : null

  return (
    <div data-dense className={theme.shell}>
      {/* ---------- desktop: real bracket ---------- */}
      <div className="hidden md:block relative">
        {/* Height is driven by the first round so matchups get real breathing room
            instead of collapsing to the height of their own cards. */}
        <div
          className="flex gap-10 items-stretch"
          style={{ minHeight: `${Math.max(rounds[0]?.matchups?.length || 1, 1) * 104}px` }}
        >
          {rounds.map((round, rIndex) => {
            const isLastRound = rIndex === rounds.length - 1
            return (
              <div key={round.id} className="flex-1 min-w-0 flex flex-col">
                <div className="mb-3 px-1">
                  <div className={theme.roundLabel}>{round.name}</div>
                  <div className={theme.roundMeta}>Best of {round.bestOf}</div>
                </div>

                <div className="flex-1 flex flex-col">
                  {round.matchups.map((m, i) => (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, x: -12 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true, margin: '-60px' }}
                      transition={{ duration: 0.45, delay: rIndex * 0.08 + i * 0.04, ease: [0.16, 1, 0.3, 1] }}
                      className="relative flex-1 flex items-center py-2"
                    >
                      <div className="w-full">
                        <Matchup matchup={m} theme={theme} isFinal={round.isFinals} />
                      </div>

                      {/* line in from the previous round */}
                      {rIndex > 0 && (
                        <span className={`absolute right-full top-1/2 w-5 h-px ${theme.line}`} aria-hidden="true" />
                      )}

                      {/* Line out. Every round gets one — the last round's points at
                          the champion card. Only earlier rounds also get the vertical
                          joiner that merges this matchup with its pair. */}
                      <span className={`absolute left-full top-1/2 w-5 h-px ${theme.line}`} aria-hidden="true" />
                      {!isLastRound && (
                        <span
                          className={`absolute w-px ${theme.line} ${i % 2 === 0 ? 'top-1/2 h-1/2' : 'bottom-1/2 h-1/2'}`}
                          style={{ left: 'calc(100% + 1.25rem)' }}
                          aria-hidden="true"
                        />
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>
            )
          })}

          {/* champion column */}
          <div className="w-[240px] shrink-0 flex flex-col">
            <div className="mb-3 px-1">
              <div className={theme.roundLabel}>Champion</div>
              <div className={theme.roundMeta}>{bracket.division}</div>
            </div>
            <div className="flex-1 flex items-center relative">
              <span className={`absolute right-full top-1/2 w-5 h-px ${theme.line}`} aria-hidden="true" />
              <motion.div
                initial={{ opacity: 0, scale: 0.94 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.5, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="w-full"
              >
                <ChampionCard champion={champion} theme={theme} />
              </motion.div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- mobile: stacked rounds ---------- */}
      <div className="md:hidden space-y-6">
        {rounds.map((round) => (
          <div key={round.id}>
            <div className="mb-2 flex items-baseline gap-2">
              <span className={theme.roundLabel}>{round.name}</span>
              <span className={theme.roundMeta}>Bo{round.bestOf}</span>
            </div>
            <div className="space-y-2">
              {round.matchups.map((m) => (
                <Matchup key={m.id} matchup={m} theme={theme} isFinal={round.isFinals} />
              ))}
              {round.matchups.length === 0 && (
                <div className={`py-6 text-center text-xs ${theme.tbd}`}>Not set yet</div>
              )}
            </div>
          </div>
        ))}
        <div>
          <div className={`mb-2 ${theme.roundLabel}`}>Champion</div>
          <ChampionCard champion={champion} theme={theme} />
        </div>
      </div>
    </div>
  )
}

