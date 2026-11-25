# Pump Chaser — Pump.fun Bot Sprint

[![make.fun · u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![rank](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/rsrizal2-ai/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/rank.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![reward](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/rsrizal2-ai/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/reward.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)

A Solana paper-trading bot for pump.fun bonding curves, built for the
[make.fun bounty "Pump.fun Bot Sprint: Make Bot And Win"](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
— $2 across the top 2, ranked on net PnL over a 6-hour replay of pump.fun
chain data recorded after entries close. The grader runs `node main.ts`
(Node 22); the bot reads the replay's market events as they arrive and
decides when to buy, when to sell, and how much to risk.

## The idea: chase the pump, not the launch

Everything in this bot comes from measuring the kit's own 24-hour dev
replay (128,058 events, 1,222 sampled coins) instead of assuming what works:

- **Sniper at launch loses.** Buying every launch that passes a rug filter
  wins 12.7% of trips; round-trip fees (~2.7% of a ticket) eat the edge.
- **Momentum at age ≥ 100 is too late.** A heavily traded coin typically
  pumps 1× → 8× in ~170 slots, plateaus near its high, then dumps to ~1×
  in **one slot**. By age 100 the pump is over and the plateau is flat.
- **Completers are unrideable.** They complete in the same slot as their
  last trades (median 0 slots from 20 SOL of real reserves to completion)
  — single-slot whale sweeps that 2-slot latency cannot catch.
- **Reactive exits cannot save you from a one-slot dump.** The sell fills
  two slots later, at the crashed price. Only proactive exits — a
  take-profit ladder, a tight stop, a short hold — bank anything.

So this bot enters only a coin that is **already pumping** inside its first
250 slots: at least **20 distinct buyers** and **3 SOL of net inflow in the
last 15 slots**. It buys a **0.05 SOL** ticket, sells **70% at +20%** and the
rest at **+100%** (or on a 25% trail from the peak once +30% is armed),
cuts at **−3%**, never holds past **100 slots**, and refuses any buy whose
fill price jumps more than 15% past the decision price. At most 5 positions
open, at most 0.5 SOL exposed — a total wipe of every open position costs
~5% of capital, not the 95% the pyramided pilot momentum bot lost.

A capped probe lane (0.01 SOL, one at a time) tops the coin count up only
if the main lane's pace lags the 20-coin guardrail.

## Results on the dev window

| Bot | Net PnL | Trips / coins | Max drawdown |
| --- | --- | --- | --- |
| Pilot momentum (2 SOL pyramid) | −9.39 SOL | 80 / 48 | 95% |
| Pilot mean reversion (dip buying) | −4.02 SOL | 424 / 198 | 49% |
| Pilot sniper (0.10 SOL at launch) | −0.49 SOL | 354 / 354 | 5.3% |
| **Pump chaser (this bot)** | **−0.055 SOL** | **119 / 119** | **1.2%** |

The dev tape is a hard one — every pilot baseline loses on it — so the
settings were picked in the middle of a flat region of the sweep grid, not
at a sharp peak: neighbouring cells (20 buyers, 2–3 SOL flow, stop −3–5%,
first take-profit +10–20%) all land between −0.06 and −0.30 SOL, and the
result holds across failed-transaction draws (−0.049 to −0.083 SOL). The
official `grade-local` run on this repository confirms the same order of
magnitude. The final window is a fresh 6 hours, so the bot is built to lose
little on a bad tape and to ride the plateau pumps when the tape offers
them — the ladder, not the stop, is what banks a runner.

## Layout

- `main.ts` — entrypoint: hands the strategy to the vendored SDK shim.
- `strategy.ts` — the pump-chaser strategy (pure function of the batches;
  no clock, no randomness, no I/O, deterministic).
- `vendor/makefun-bot.ts` — the kit's `sdk/ts/makefun-bot.ts`, vendored
  byte for byte (the protocol shim).

## License

MIT — see `LICENSE`.
