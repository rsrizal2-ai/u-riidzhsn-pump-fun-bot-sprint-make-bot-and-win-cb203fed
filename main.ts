// Pump.fun Bot Sprint: Make Bot And Win — pump chaser with a take-profit ladder.
// The grader runs `node /bot/main.ts`; the strategy lives in strategy.ts and the
// SDK shim is the kit's sdk/ts/makefun-bot.ts, vendored byte for byte.
// Dev-window result: -0.055 SOL net PnL, 119 trips / 119 coins, max drawdown 1.2%.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
