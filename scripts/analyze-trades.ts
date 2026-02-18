import { getIncomeHistory } from '../src/lib/api/income';
import { loadConfig } from '../src/lib/bot/config';
import { getPositions, getBalance } from '../src/lib/api/market';

async function main() {
  const config = await loadConfig();
  const endTime = Date.now();
  const startTime = endTime - 7 * 24 * 60 * 60 * 1000;
  
  // Get income history
  const income = await getIncomeHistory(config.api, { startTime, endTime, limit: 1000 });
  
  if (!income || income.length === 0) {
    console.log('No income data returned from API');
    return;
  }
  
  // Get current positions and balance
  let positions: any[] = [];
  let balance: any = null;
  try {
    positions = await getPositions(config.api);
    positions = positions.filter((p: any) => parseFloat(p.positionAmt) !== 0);
    balance = await getBalance(config.api);
  } catch (e) {
    console.error('Failed to fetch positions/balance');
  }

  const byType: Record<string, { count: number; total: number }> = {};
  const bySymbol: Record<string, { count: number; pnl: number; wins: number; losses: number; totalWinAmt: number; totalLossAmt: number }> = {};
  const byDay: Record<string, { count: number; pnl: number; fees: number; funding: number }> = {};

  for (const t of income) {
    const typ = t.incomeType;
    const amt = parseFloat(t.income);
    if (!byType[typ]) byType[typ] = { count: 0, total: 0 };
    byType[typ].count++;
    byType[typ].total += amt;

    const sym = t.symbol || 'N/A';
    const day = new Date(parseInt(t.time)).toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = { count: 0, pnl: 0, fees: 0, funding: 0 };

    if (typ === 'REALIZED_PNL') {
      if (!bySymbol[sym]) bySymbol[sym] = { count: 0, pnl: 0, wins: 0, losses: 0, totalWinAmt: 0, totalLossAmt: 0 };
      bySymbol[sym].count++;
      bySymbol[sym].pnl += amt;
      if (amt > 0) { bySymbol[sym].wins++; bySymbol[sym].totalWinAmt += amt; }
      else { bySymbol[sym].losses++; bySymbol[sym].totalLossAmt += Math.abs(amt); }
      byDay[day].count++;
      byDay[day].pnl += amt;
    } else if (typ === 'COMMISSION') {
      byDay[day].fees += amt;
    } else if (typ === 'FUNDING_FEE') {
      byDay[day].funding += amt;
    }
  }

  console.log('=== INCOME BY TYPE (7 days) ===');
  for (const [typ, d] of Object.entries(byType).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`${typ.padEnd(25)} count=${String(d.count).padStart(5)}  total=${d.total >= 0 ? '+' : ''}${d.total.toFixed(4)} USDT`);
  }

  console.log('\n=== PNL BY SYMBOL (7 days) ===');
  for (const [sym, d] of Object.entries(bySymbol).filter(e => e[0] !== 'N/A').sort((a, b) => b[1].pnl - a[1].pnl)) {
    const avgW = d.wins > 0 ? d.totalWinAmt / d.wins : 0;
    const avgL = d.losses > 0 ? d.totalLossAmt / d.losses : 0;
    const wr = d.count > 0 ? (d.wins / d.count * 100) : 0;
    console.log(`${sym.padEnd(20)} trades=${String(d.count).padStart(4)}  W/L=${d.wins}/${d.losses} (${wr.toFixed(0)}%)  PnL=${d.pnl >= 0 ? '+' : ''}${d.pnl.toFixed(4)}  avgW=+${avgW.toFixed(4)} avgL=-${avgL.toFixed(4)}`);
  }

  console.log('\n=== PNL BY DAY ===');
  for (const [day, d] of Object.entries(byDay).sort()) {
    const net = d.pnl + d.fees + d.funding;
    console.log(`${day}  trades=${String(d.count).padStart(4)}  PnL=${d.pnl >= 0 ? '+' : ''}${d.pnl.toFixed(4)}  fees=${d.fees.toFixed(4)}  funding=${d.funding >= 0 ? '+' : ''}${d.funding.toFixed(4)}  net=${net >= 0 ? '+' : ''}${net.toFixed(4)}`);
  }

  const totalPnL = Object.values(bySymbol).reduce((s, d) => s + d.pnl, 0);
  const totalTrades = Object.values(bySymbol).reduce((s, d) => s + d.count, 0);
  const totalWins = Object.values(bySymbol).reduce((s, d) => s + d.wins, 0);
  const totalFees = Object.values(byDay).reduce((s, d) => s + d.fees, 0);
  const totalFunding = Object.values(byDay).reduce((s, d) => s + d.funding, 0);
  const avgWin = totalWins > 0 ? Object.values(bySymbol).reduce((s, d) => s + d.totalWinAmt, 0) / totalWins : 0;
  const totalLosses = totalTrades - totalWins;
  const avgLoss = totalLosses > 0 ? Object.values(bySymbol).reduce((s, d) => s + d.totalLossAmt, 0) / totalLosses : 0;

  console.log('\n=== TOTALS (7 days) ===');
  console.log(`Realized PnL:  ${totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(4)} USDT`);
  console.log(`Fees:          ${totalFees.toFixed(4)} USDT`);
  console.log(`Funding:       ${totalFunding >= 0 ? '+' : ''}${totalFunding.toFixed(4)} USDT`);
  console.log(`Net:           ${(totalPnL + totalFees + totalFunding) >= 0 ? '+' : ''}${(totalPnL + totalFees + totalFunding).toFixed(4)} USDT`);
  console.log(`Total trades:  ${totalTrades} (Win rate: ${(totalWins / totalTrades * 100).toFixed(1)}%)`);
  console.log(`Avg win:       +${avgWin.toFixed(4)} USDT`);
  console.log(`Avg loss:      -${avgLoss.toFixed(4)} USDT`);
  console.log(`Risk/Reward:   1:${(avgWin / avgLoss).toFixed(2)}`);

  // Current positions
  if (positions.length > 0) {
    console.log('\n=== OPEN POSITIONS ===');
    let totalUnrealized = 0;
    for (const p of positions) {
      const amt = parseFloat(p.positionAmt);
      const entry = parseFloat(p.entryPrice);
      const unrealized = parseFloat(p.unrealizedProfit || p.unRealizedProfit || '0');
      const notional = Math.abs(parseFloat(p.notional || '0'));
      const leverage = parseInt(p.leverage || '1');
      totalUnrealized += unrealized;
      const side = amt > 0 ? 'LONG' : 'SHORT';
      console.log(`${p.symbol.padEnd(16)} ${side.padEnd(5)} qty=${Math.abs(amt)}  entry=$${entry.toFixed(4)}  notional=$${notional.toFixed(2)}  unrealized=${unrealized >= 0 ? '+' : ''}${unrealized.toFixed(4)}  lev=${leverage}x`);
    }
    console.log(`Total unrealized: ${totalUnrealized >= 0 ? '+' : ''}${totalUnrealized.toFixed(4)} USDT`);
  }

  // Balance
  if (balance) {
    const balArr = Array.isArray(balance) ? balance : [balance];
    const usdtBal = balArr.find((b: any) => b.asset === 'USDT');
    if (usdtBal) {
      console.log('\n=== ACCOUNT BALANCE ===');
      console.log(`Total balance:     ${parseFloat(usdtBal.balance).toFixed(4)} USDT`);
      console.log(`Available:         ${parseFloat(usdtBal.availableBalance || usdtBal.crossWalletBalance).toFixed(4)} USDT`);
    }
  }

  // Config analysis
  console.log('\n=== CURRENT CONFIG ===');
  for (const [sym, sc] of Object.entries(config.symbols) as any) {
    const ts = sc.longTradeSize || sc.shortTradeSize || sc.tradeSize || 0;
    const maxMargin = sc.maxPositionMarginUSDT || 'unlimited';
    const lev = sc.leverage || 10;
    console.log(`${sym.padEnd(20)} tradeSize=${ts} USDT  maxMargin=${maxMargin}  lev=${lev}x  SL=${sc.stopLossPercent || '?'}%  TP=${sc.takeProfitPercent || '?'}%`);
  }
}

main().catch(e => console.error(e));
