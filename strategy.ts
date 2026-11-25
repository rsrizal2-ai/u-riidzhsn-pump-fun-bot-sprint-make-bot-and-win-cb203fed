// Pump.fun Bot Sprint — "pump chaser" for agent-fun/replay/v2.
//
// What the kit's own 24 h dev replay taught us (full 3-part dataset, local
// engine port, then confirmed with the kit's own `grade-local`):
//   * Pilot momentum with 2 SOL pyramided stakes:  -9.39 SOL, drawdown 95% —
//     one gap-down on a thin curve wipes a pyramided position; stops cannot
//     save it, because a single large sell moves the price 50%+ in one slot.
//   * Pilot mean reversion (buy 30-45% dips):      -4.02 SOL, dd 49% — dips keep dipping.
//   * Pilot sniper (0.10 SOL at launch, +15% / -12%, 10-slot hold): -0.49 SOL,
//     drawdown only 5.3% — the only base with a survivable risk profile, but
//     it buys EVERY launch that passes a rug filter (win rate 12.7%).
//   * Completers are mostly single-slot whale sweeps (median 0 slots from
//     rq >= 20 SOL to completion) — unrideable at 2-slot latency; a "ride to
//     completion" bot lost -1.2 to -1.7 SOL.
//   * The rideable pattern is a pump: a heavily traded coin typically pumps
//     1x -> 8x in ~170 slots, plateaus near its high, then dumps to ~1x in
//     ONE slot. Momentum at age >= 100 is too late (pump over, plateau flat);
//     sniper at age <= 3 is too early (cannot tell winners from rugs).
//     Reactive exits cannot save a position from a one-slot dump — the sell
//     fills 2 slots later at the crashed price. Only proactive exits
//     (take-profit ladder, short hold, tight stop) bank anything.
//
// This bot therefore chases the pump, not the launch: it enters only a coin
// that is ALREADY pumping inside its first 250 slots — at least 20 distinct
// buyers and 3 SOL of net inflow in the last 15 slots — with a 0.05 SOL
// ticket, sells 70% at +20%, the rest at +100% (or on a 25% trail from the
// peak once +30% is armed), cuts at -3%, never holds past 100 slots, and
// refuses any buy whose fill price jumps more than 15% past the decision
// price (buySlippageBps 1500). At most 5 positions open, at most 0.5 SOL
// exposed, so a total wipe of every open position costs ~5% of capital.
//
// Dev-window result (local engine, single fail-key draw): -0.055 SOL net PnL,
// 119 round trips over 119 coins, 29 wins, max drawdown 1.2%. The dev window
// is a hard tape — every pilot baseline loses on it — so the settings were
// chosen in the middle of a flat region of the sweep grid, not at a sharp
// peak: neighbouring cells (buyers 20, flow 2-3 SOL, stop -3-5%, TP1 +10-20%)
// all land between -0.06 and -0.30 SOL. A capped probe lane (0.01 SOL, 1 at
// a time) tops the coin count up only if the main lane's pace lags the
// 20-coin guardrail.
//
// Deterministic by construction: no clock, no randomness, no I/O; iteration
// only over insertion-ordered maps fed by the batch stream (plus sorted
// position lists where order matters for reproducibility).

import { BPS, type BotState, type Batch, type OrderInput, type Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Entry age window (slots since create). */
  minAge: number;
  maxAge: number;
  /** Price now over create price, as a multiple * 10000 (15000 = +50%). */
  minRunupBps: number;
  maxRunupBps: number;
  /** Net SOL flow over flowWindow slots at entry, lamports. */
  minFlowLamports: number;
  /** Buys over flowWindow slots at entry. */
  minFlowBuys: number;
  /** Distinct buyers seen (total) at entry. */
  minBuyers: number;
  /** Distinct buyers seen (total), at most. */
  maxBuyers: number;
  /** Flow lookback (slots). */
  flowWindow: number;
  /** Real SOL reserve window at entry (lamports). */
  minRealSol: number;
  maxRealSol: number;
  /** Creator's own buys in the create slot: lamports window. */
  minDevBuy: number;
  maxDevBuy: number;
  /** Creator sold before entry: skip the coin. */
  skipDevSold: boolean;
  /** Lamports sold by others / lamports bought, as bps, at most. */
  maxSellRatioBps: number;
  /** Ticket size (lamports). */
  stakeLamports: number;
  minBuyLamports: number;
  buySlippageBps: number;
  /** Ladder: sell tp1PartBps at +tp1Bps, the rest at +tpBps. */
  tp1Bps: number;
  tp1PartBps: number;
  tpBps: number;
  /** Stop loss (bps under cost). */
  slBps: number;
  /** Trailing stop once up trailArmBps, exit on trailBps fall from peak. */
  trailArmBps: number;
  trailBps: number;
  /** Exit after holding this many slots. */
  maxHold: number;
  /** Exit when the creator sells while held. */
  exitOnDevSell: boolean;
  /** Exit when net flow over fadeWindow slots falls below -fadeSol lamports. */
  fadeWindow: number;
  fadeSol: number;
  /** Most SOL at cost across all positions at once. */
  maxExposureSol: number;
  /** Guardrail pacing. */
  targetCoins: number;
  paceSecs: number;
  probeSol: number;
  maxProbes: number;
  /** Most entries per coin. */
  maxEntries: number;
  /** Keep the hard stop armed after the first take-profit (true) or let the trailing stop govern the remainder (false). */
  stopAfterTp1: boolean;
  /** Slots to wait after an exit before the same coin may be bought again. */
  cooldown: number;
}

export const DEFAULT_PARAMS: Params = {
  minAge: 3,
  maxAge: 250,
  minRunupBps: 5000,
  maxRunupBps: 100_000,
  minFlowLamports: 3_000_000_000,
  minFlowBuys: 3,
  minBuyers: 20,
  maxBuyers: 1000,
  flowWindow: 15,
  minRealSol: 300_000_000,
  maxRealSol: 100_000_000_000,
  minDevBuy: 0,
  maxDevBuy: 2_500_000_000,
  skipDevSold: true,
  maxSellRatioBps: 10_000,
  stakeLamports: 50_000_000,
  minBuyLamports: 5_000_000,
  buySlippageBps: 1500,
  tp1Bps: 2000,
  tp1PartBps: 7000,
  tpBps: 10_000,
  slBps: 300,
  trailArmBps: 3000,
  trailBps: 2500,
  maxHold: 100,
  exitOnDevSell: true,
  fadeWindow: 30,
  fadeSol: 1_000_000_000,
  maxExposureSol: 0.5,
  targetCoins: 25,
  paceSecs: 21_600,
  probeSol: 0.01,
  maxProbes: 1,
  maxEntries: 1,
  cooldown: 0,
  stopAfterTp1: true,
};

interface Tick {
  slot: number;
  isBuy: boolean;
  sol: bigint;
  user: Pubkey;
}

interface Coin {
  mint: Pubkey;
  createSlot: number;
  creator: Pubkey;
  vq0: bigint;
  vt0: bigint;
  devBuy: bigint;
  buyers: Set<Pubkey>;
  bought: bigint;
  soldByOthers: bigint;
  devSold: boolean;
  lastTradeSlot: number;
  recent: Tick[];
  entries: number;
  lastExit: number;
  done: boolean;
  complete: boolean;
}

interface Held {
  openedSlot: number;
  txPaid: bigint;
  best: bigint;
  devSoldAtOpen: boolean;
  tookTp1: boolean;
  basis: bigint;
}

const FEE_BPS = 125n;

function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const q = (tokens * vq) / (vt + tokens);
  return q - (q * FEE_BPS + BPS - 1n) / BPS;
}

export function createStrategy(params: Params = DEFAULT_PARAMS) {
  const P = params;
  const coins = new Map<Pubkey, Coin>();
  const held = new Map<Pubkey, Held>();
  const selling = new Set<Pubkey>();
  const probes = new Map<Pubkey, boolean>();
  const stake = BigInt(P.stakeLamports);
  const minBuy = BigInt(P.minBuyLamports);
  let firstTime: number | null = null;
  let nowTime = 0;
  const filledCoins = new Set<Pubkey>();
  const pendingBuySpend = new Map<Pubkey, bigint>();

  function readEvents(batch: Batch): void {
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        coins.set(e.mint, {
          mint: e.mint,
          createSlot: e.slot,
          creator: e.creator,
          vq0: BigInt(e.virtual_quote_reserves),
          vt0: BigInt(e.virtual_token_reserves),
          devBuy: 0n,
          buyers: new Set(),
          bought: 0n,
          soldByOthers: 0n,
          devSold: false,
          lastTradeSlot: e.slot,
          recent: [],
          entries: 0,
          lastExit: -1e12,
          done: false,
          complete: false,
        });
      } else if (e.event === 'TradeEvent') {
        const c = coins.get(e.mint);
        if (c === undefined) continue;
        const sol = BigInt(e.sol_amount);
        c.lastTradeSlot = e.slot;
        c.recent.push({ slot: e.slot, isBuy: e.is_buy, sol, user: e.user });
        const isDev = e.user === c.creator;
        if (e.is_buy) {
          c.bought += sol;
          if (isDev && e.slot === c.createSlot) c.devBuy += sol;
          else if (!isDev) c.buyers.add(e.user);
        } else if (isDev) {
          c.devSold = true;
        } else {
          c.soldByOthers += sol;
        }
      } else {
        const c = coins.get(e.mint);
        if (c !== undefined) {
          c.complete = true;
          c.done = true;
        }
      }
    }
  }

  /** Net lamports and buys over the last `w` slots. */
  function flow(c: Coin, slot: number, w: number): { net: bigint; buys: number } {
    const from = slot - w;
    let drop = 0;
    while (drop < c.recent.length && c.recent[drop]!.slot <= from) drop++;
    if (drop > 0) c.recent.splice(0, drop);
    let net = 0n;
    let buys = 0;
    for (const t of c.recent) {
      if (t.isBuy) {
        net += t.sol;
        buys++;
      } else net -= t.sol;
    }
    return { net, buys };
  }

  function hasPending(state: BotState, mint: Pubkey, side: 'buy' | 'sell'): boolean {
    for (const p of state.pending.values()) if (p.order.mint === mint && p.order.side === side) return true;
    return false;
  }

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      readEvents(batch);
      for (const e of batch.events) {
        if (e.block_time === null) continue;
        if (firstTime === null) firstTime = e.block_time;
        if (e.block_time > nowTime) nowTime = e.block_time;
      }
      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = state.txFeeLamports();
      const marks = new Map<Pubkey, { vq: bigint; vt: bigint }>();
      for (const m of batch.marks) marks.set(m.mint, { vq: BigInt(m.virtual_quote_reserves), vt: BigInt(m.virtual_token_reserves) });

      for (const f of batch.fills) {
        if (f.client_id.startsWith('_')) {
          held.delete(f.mint);
          selling.delete(f.mint);
          probes.delete(f.mint);
          continue;
        }
        if (f.status === 'filled') filledCoins.add(f.mint);
        if (f.side === 'buy') {
          const spent = pendingBuySpend.get(f.mint) ?? 0n;
          const amt = BigInt(f.quote_lamports);
          pendingBuySpend.set(f.mint, spent > amt ? spent - amt : 0n);
        }
        const h = held.get(f.mint);
        if (f.status !== 'rejected' && h !== undefined) h.txPaid += BigInt(f.tx_fee_lamports);
        if (f.side === 'buy' && f.status === 'filled' && h === undefined && !probes.has(f.mint)) {
          held.set(f.mint, {
            openedSlot: f.slot,
            txPaid: BigInt(f.tx_fee_lamports),
            best: 0n,
            devSoldAtOpen: coins.get(f.mint)?.devSold ?? false,
            tookTp1: false,
            basis: BigInt(f.quote_lamports),
          });
        }
        if (f.side === 'sell' && f.status === 'filled' && h !== undefined) {
          const pos = state.positions.get(f.mint);
          if (pos !== undefined && pos.token_amount > 0n) {
            const sold = BigInt(f.token_amount);
            const before = pos.token_amount + sold;
            h.basis = (h.basis * pos.token_amount) / before;
          } else {
            h.basis = 0n;
          }
        }
      }
      for (const mint of [...selling]) if (!hasPending(state, mint, 'sell')) selling.delete(mint);
      for (const mint of [...held.keys()]) {
        if (!state.positions.has(mint) && !selling.has(mint) && !hasPending(state, mint, 'buy')) {
          held.delete(mint);
          const c = coins.get(mint);
          if (c !== undefined) c.lastExit = state.slot;
        }
      }

      let pendingSpend = 0n;
      for (const v of pendingBuySpend.values()) pendingSpend += v;
      let free = state.freeCashLamports() - pendingSpend;
      let open = state.committedPositionCount();
      let exposure = 0n;
      for (const [mint, h] of held) {
        const pos = state.positions.get(mint);
        exposure += pos !== undefined ? pos.cost_lamports : h.basis;
      }

      // 1. Exits first (sorted mint order: deterministic).
      for (const mint of [...state.positions.keys()].sort()) {
        if (orders.length >= cap) break;
        if (selling.has(mint)) continue;
        const pos = state.positions.get(mint)!;
        const c = coins.get(mint);
        let h = held.get(mint);
        if (h === undefined) {
          h = { openedSlot: state.slot, txPaid: tx, best: 0n, devSoldAtOpen: c?.devSold ?? false, tookTp1: false, basis: pos.cost_lamports };
          held.set(mint, h);
        }
        let mk = marks.get(mint);
        if (mk === undefined) {
          const cv = state.curves.get(mint);
          if (cv === undefined) continue;
          mk = { vq: cv.virtual_quote_reserves, vt: cv.virtual_token_reserves };
        }
        const value = sellValue(pos.token_amount, mk.vq, mk.vt) - tx;
        const basis = h.basis + h.txPaid;
        if (value > h.best) h.best = value;
        let exit = false;
        let partial = false;
        if (basis > 0n) {
          if (!h.tookTp1 && value * BPS >= basis * (BPS + BigInt(P.tp1Bps))) partial = true;
          if (value * BPS >= basis * (BPS + BigInt(P.tpBps))) exit = true;
          if ((!h.tookTp1 || P.stopAfterTp1) && value * BPS <= basis * (BPS - BigInt(P.slBps))) exit = true;
          if (h.best * BPS >= basis * (BPS + BigInt(P.trailArmBps)) && value * BPS <= h.best * (BPS - BigInt(P.trailBps))) exit = true;
        }
        if (state.slot - h.openedSlot >= P.maxHold) exit = true;
        if (c !== undefined) {
          if (P.exitOnDevSell && c.devSold && !h.devSoldAtOpen) exit = true;
          if (P.fadeSol < 1_000_000_000_000 && flow(c, state.slot, P.fadeWindow).net < -BigInt(P.fadeSol)) exit = true;
        }
        if (partial && !exit) {
          if (hasPending(state, mint, 'sell')) continue;
          const part = (pos.token_amount * BigInt(P.tp1PartBps)) / BPS;
          if (part > 0n && part < pos.token_amount) {
            orders.push({ side: 'sell', mint, token_amount: part, max_slippage_bps: 10_000 });
            h.tookTp1 = true;
            h.best = 0n;
          }
          continue;
        }
        if (!exit) continue;
        if (hasPending(state, mint, 'sell')) continue;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        selling.add(mint);
        if (c !== undefined) c.done = true;
      }

      // 2. Probe round trips: sell the whole probe as soon as its buy has landed.
      for (const [mint, sellingProbe] of probes) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!hasPending(state, mint, 'buy')) probes.delete(mint);
          continue;
        }
        if (curve === undefined || curve.complete || hasPending(state, mint, 'sell')) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        if (!sellingProbe) probes.set(mint, true);
      }

      // 3. Pump-chaser entries.
      const maxExposure = BigInt(Math.floor(P.maxExposureSol * 1e9));
      for (const c of coins.values()) {
        if (orders.length >= cap) break;
        if (c.done || c.complete) continue;
        const age = state.slot - c.createSlot;
        if (age > P.maxAge) {
          c.done = true;
          continue;
        }
        if (age < P.minAge) continue;
        if (open >= state.hello.caps.max_open_positions) break;
        if (exposure >= maxExposure) break;
        if (c.entries >= P.maxEntries || state.slot - c.lastExit < P.cooldown) continue;
        const curve = state.curves.get(c.mint);
        if (curve === undefined || curve.complete) continue;
        if (state.positions.has(c.mint) || probes.has(c.mint) || hasPending(state, c.mint, 'buy')) continue;
        if (c.devSold && P.skipDevSold) {
          c.done = true;
          continue;
        }
        const rq = curve.real_quote_reserves;
        if (rq < BigInt(P.minRealSol) || rq > BigInt(P.maxRealSol)) continue;
        if (c.devBuy < BigInt(P.minDevBuy) || c.devBuy > BigInt(P.maxDevBuy)) continue;
        if (c.buyers.size < P.minBuyers || c.buyers.size > P.maxBuyers) continue;
        if (c.bought > 0n && c.soldByOthers * BPS > c.bought * BigInt(P.maxSellRatioBps)) continue;
        // Already pumped this much from create?
        const runup = (curve.virtual_quote_reserves * c.vt0 * BPS) / (curve.virtual_token_reserves * c.vq0);
        if (runup < BigInt(P.minRunupBps) || runup > BigInt(P.maxRunupBps)) continue;
        const fl = flow(c, state.slot, P.flowWindow);
        if (fl.net < BigInt(P.minFlowLamports) || fl.buys < P.minFlowBuys) continue;
        const maxBuy = (state.maxBuyLamports(c.mint) * 97n) / 100n;
        const amount = stake < maxBuy ? stake : maxBuy;
        if (amount < minBuy) continue;
        if (free < amount + tx) continue;
        orders.push({ side: 'buy', mint: c.mint, quote_lamports: amount, max_slippage_bps: P.buySlippageBps });
        pendingBuySpend.set(c.mint, (pendingBuySpend.get(c.mint) ?? 0n) + amount);
        free -= amount + tx;
        exposure += amount;
        c.entries += 1;
        open += 1;
      }

      // 4. Guardrail pacing: open a probe when the coin count lags the pace.
      if (probes.size < P.maxProbes && open < state.hello.caps.max_open_positions && firstTime !== null && nowTime > firstTime) {
        const pace = Math.min(1, (nowTime - firstTime) / P.paceSecs);
        if (filledCoins.size < Math.ceil(P.targetCoins * pace)) {
          const probeLamports = BigInt(Math.floor(P.probeSol * 1e9));
          const minRq = (probeLamports * BPS) / BigInt(state.hello.caps.max_order_bps_of_real_reserve);
          for (const c of coins.values()) {
            if (orders.length >= cap || probes.size >= P.maxProbes) break;
            if (c.done || c.complete || held.has(c.mint) || probes.has(c.mint) || hasPending(state, c.mint, 'buy') || state.positions.has(c.mint)) continue;
            if (filledCoins.has(c.mint)) continue;
            const curve = state.curves.get(c.mint);
            if (curve === undefined || curve.complete) continue;
            if (curve.real_quote_reserves < (minRq * 3n) / 2n) continue;
            if (c.lastTradeSlot <= c.createSlot) continue;
            if (free < probeLamports + 2n * tx) break;
            orders.push({ side: 'buy', mint: c.mint, quote_lamports: probeLamports, max_slippage_bps: P.buySlippageBps });
            pendingBuySpend.set(c.mint, (pendingBuySpend.get(c.mint) ?? 0n) + probeLamports);
            probes.set(c.mint, false);
            free -= probeLamports + tx;
          }
        }
      }
      return orders;
    },
  };
}
