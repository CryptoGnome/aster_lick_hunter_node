/**
 * Analyze recent trade performance from exchange API
 * Usage: npx tsx scripts/analyze-recent-trades.ts [days]
 */

import { loadConfig } from '../src/lib/bot/config';
import { buildSignedQuery } from '../src/lib/api/auth';

const DAYS = parseInt(process.argv[2] || '7');
const BASE_URL = 'https://fapi.asterdex.com';

interface Trade {
  symbol: string;
  id: number;
  orderId: number;
  side: 'BUY' | 'SELL';
  price: string;
  qty: string;
  realizedPnl: string;
  marginAsset: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  positionSide: string;
  buyer: boolean;
  maker: boolean;
}

interface Income {
  symbol: string;
  incomeType: string;
  income: string;
  asset: string;
  time: number;
  info: string;
  tranId: number;
  tradeId: string;
}

async function apiCall(endpoint: string, params: Record<string, string>): Promise<any> {
  const config = await loadConfig();
  const { apiKey, secretKey } = config.api;
  
  const queryString = buildSignedQuery(params, { apiKey, secretKey });
  const url = `${BASE_URL}${endpoint}?${queryString}`;
  
  const res = await fetch(url, {
    headers: { 'X-MBX-APIKEY': apiKey }
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  
  return res.json();
}

async function getAllTrades(days: number): Promise<Trade[]> {
  const config = await loadConfig();
  const symbols = Object.keys(config.symbols);
  const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
  
  const allTrades: Trade[] = [];
  
  for (const symbol of symbols) {
    try {
      const trades = await apiCall('/fapi/v1/userTrades', {
        symbol,
        startTime: startTime.toString(),
        limit: '1000'
      });
      allTrades.push(...trades);
    } catch (e: any) {
      console.error(`  Failed to get trades for ${symbol}: ${e.message}`);
    }
  }
  
  return allTrades.sort((a, b) => a.time - b.time);
}

async function getIncome(days: number): Promise<Income[]> {
  const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
  const allIncome: Income[] = [];
  
  // Get REALIZED_PNL
  try {
    const pnl = await apiCall('/fapi/v1/income', {
      incomeType: 'REALIZED_PNL',
      startTime: startTime.toString(),
      limit: '1000'
    });
    allIncome.push(...pnl);
  } catch (e: any) {
    console.error(`  Failed to get PnL income: ${e.message}`);
  }
  
  // Get COMMISSION
  try {
    const comm = await apiCall('/fapi/v1/income', {
      incomeType: 'COMMISSION',
      startTime: startTime.toString(),
      limit: '1000'
    });
    allIncome.push(...comm);
  } catch (e: any) {
    console.error(`  Failed to get commission income: ${e.message}`);
  }
  
  // Get FUNDING_FEE
  try {
    const funding = await apiCall('/fapi/v1/income', {
      incomeType: 'FUNDING_FEE',
      startTime: startTime.toString(),
      limit: '1000'
    });
    allIncome.push(...funding);
  } catch (e: any) {
    console.error(`  Failed to get funding income: ${e.message}`);
  }
  
  return allIncome.sort((a, b) => a.time - b.time);
}

async function getAccountBalance(): Promise<{ totalBalance: number; availableBalance: number; unrealizedPnl: number }> {
  const account = await apiCall('/fapi/v2/account', {});
  return {
    totalBalance: parseFloat(account.totalWalletBalance),
    availableBalance: parseFloat(account.availableBalance),
    unrealizedPnl: parseFloat(account.totalUnrealizedProfit)
  };
}

async function getCurrentPositions(): Promise<any[]> {
  const account = await apiCall('/fapi/v2/account', {});
  return account.positions.filter((p: any) => parseFloat(p.positionAmt) !== 0);
}

async function main() {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  TRADE PERFORMANCE ANALYSIS — Last ${DAYS} days`);
  console.log(`${'='.repeat(70)}\n`);
  
  // Get account info
  const balance = await getAccountBalance();
  console.log(`📊 Account: $${balance.totalBalance.toFixed(2)} (available: $${balance.availableBalance.toFixed(2)}, unrealized: $${balance.unrealizedPnl.toFixed(2)})\n`);
  
  // Current positions
  const positions = await getCurrentPositions();
  if (positions.length > 0) {
    console.log(`📌 Open Positions:`);
    for (const p of positions) {
      const amt = parseFloat(p.positionAmt);
      const entry = parseFloat(p.entryPrice);
      const pnl = parseFloat(p.unrealizedProfit);
      const side = amt > 0 ? 'LONG' : 'SHORT';
      console.log(`   ${p.symbol} ${side} ${Math.abs(amt)} @ $${entry.toFixed(4)} | PnL: $${pnl.toFixed(2)}`);
    }
    console.log();
  }
  
  // Get trades
  console.log(`Fetching trades...`);
  const trades = await getAllTrades(DAYS);
  console.log(`Found ${trades.length} fills\n`);
  
  // Get income
  console.log(`Fetching income...`);
  const income = await getIncome(DAYS);
  
  // Income breakdown
  const realizedPnl = income.filter(i => i.incomeType === 'REALIZED_PNL');
  const commissions = income.filter(i => i.incomeType === 'COMMISSION');
  const funding = income.filter(i => i.incomeType === 'FUNDING_FEE');
  
  const totalPnl = realizedPnl.reduce((sum, i) => sum + parseFloat(i.income), 0);
  const totalComm = commissions.reduce((sum, i) => sum + parseFloat(i.income), 0);
  const totalFunding = funding.reduce((sum, i) => sum + parseFloat(i.income), 0);
  const netProfit = totalPnl + totalComm + totalFunding;
  
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  INCOME BREAKDOWN (${DAYS} days)`);
  console.log(`${'─'.repeat(50)}`);
  console.log(`  Realized PnL:   ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(4)}`);
  console.log(`  Commissions:    ${totalComm >= 0 ? '+' : ''}$${totalComm.toFixed(4)}`);
  console.log(`  Funding Fees:   ${totalFunding >= 0 ? '+' : ''}$${totalFunding.toFixed(4)}`);
  console.log(`  ${'─'.repeat(30)}`);
  console.log(`  NET PROFIT:     ${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(4)}`);
  console.log(`  ROI:            ${((netProfit / balance.totalBalance) * 100).toFixed(2)}%`);
  console.log();
  
  // Group trades by symbol
  const symbolStats: Record<string, {
    trades: number;
    wins: number;
    losses: number;
    totalPnl: number;
    totalVolume: number;
    totalComm: number;
    totalFunding: number;
    avgWin: number;
    avgLoss: number;
    biggestWin: number;
    biggestLoss: number;
    winPnls: number[];
    lossPnls: number[];
  }> = {};
  
  // Process realized PnL per symbol
  for (const inc of realizedPnl) {
    const pnl = parseFloat(inc.income);
    if (!symbolStats[inc.symbol]) {
      symbolStats[inc.symbol] = {
        trades: 0, wins: 0, losses: 0, totalPnl: 0, totalVolume: 0,
        totalComm: 0, totalFunding: 0, avgWin: 0, avgLoss: 0,
        biggestWin: 0, biggestLoss: 0, winPnls: [], lossPnls: []
      };
    }
    const s = symbolStats[inc.symbol];
    s.trades++;
    s.totalPnl += pnl;
    if (pnl > 0) {
      s.wins++;
      s.winPnls.push(pnl);
      if (pnl > s.biggestWin) s.biggestWin = pnl;
    } else if (pnl < 0) {
      s.losses++;
      s.lossPnls.push(pnl);
      if (pnl < s.biggestLoss) s.biggestLoss = pnl;
    }
  }
  
  // Add commissions per symbol
  for (const inc of commissions) {
    if (symbolStats[inc.symbol]) {
      symbolStats[inc.symbol].totalComm += parseFloat(inc.income);
    }
  }
  
  // Add funding per symbol
  for (const inc of funding) {
    if (symbolStats[inc.symbol]) {
      symbolStats[inc.symbol].totalFunding += parseFloat(inc.income);
    }
  }
  
  // Add volume from trades
  for (const t of trades) {
    if (symbolStats[t.symbol]) {
      symbolStats[t.symbol].totalVolume += parseFloat(t.quoteQty);
    }
  }
  
  // Calculate averages
  for (const s of Object.values(symbolStats)) {
    s.avgWin = s.winPnls.length > 0 ? s.winPnls.reduce((a, b) => a + b, 0) / s.winPnls.length : 0;
    s.avgLoss = s.lossPnls.length > 0 ? s.lossPnls.reduce((a, b) => a + b, 0) / s.lossPnls.length : 0;
  }
  
  // Per-symbol breakdown
  console.log(`${'─'.repeat(70)}`);
  console.log(`  PER-SYMBOL BREAKDOWN`);
  console.log(`${'─'.repeat(70)}`);
  
  const sorted = Object.entries(symbolStats).sort((a, b) => b[1].totalPnl - a[1].totalPnl);
  
  for (const [symbol, s] of sorted) {
    const winRate = s.trades > 0 ? ((s.wins / s.trades) * 100).toFixed(0) : '0';
    const net = s.totalPnl + s.totalComm + s.totalFunding;
    console.log(`\n  ${symbol}`);
    console.log(`    Closes: ${s.trades} (${s.wins}W/${s.losses}L) | Win rate: ${winRate}%`);
    console.log(`    PnL: ${s.totalPnl >= 0 ? '+' : ''}$${s.totalPnl.toFixed(4)} | Comm: $${s.totalComm.toFixed(4)} | Funding: $${s.totalFunding.toFixed(4)}`);
    console.log(`    Net: ${net >= 0 ? '+' : ''}$${net.toFixed(4)} | Volume: $${s.totalVolume.toFixed(0)}`);
    console.log(`    Avg Win: +$${s.avgWin.toFixed(4)} | Avg Loss: $${s.avgLoss.toFixed(4)}`);
    console.log(`    Best: +$${s.biggestWin.toFixed(4)} | Worst: $${s.biggestLoss.toFixed(4)}`);
  }
  
  // Daily breakdown
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  DAILY P&L`);
  console.log(`${'─'.repeat(50)}`);
  
  const dailyPnl: Record<string, { pnl: number; comm: number; funding: number; trades: number }> = {};
  
  for (const inc of realizedPnl) {
    const day = new Date(inc.time).toISOString().split('T')[0];
    if (!dailyPnl[day]) dailyPnl[day] = { pnl: 0, comm: 0, funding: 0, trades: 0 };
    dailyPnl[day].pnl += parseFloat(inc.income);
    dailyPnl[day].trades++;
  }
  for (const inc of commissions) {
    const day = new Date(inc.time).toISOString().split('T')[0];
    if (dailyPnl[day]) dailyPnl[day].comm += parseFloat(inc.income);
  }
  for (const inc of funding) {
    const day = new Date(inc.time).toISOString().split('T')[0];
    if (!dailyPnl[day]) dailyPnl[day] = { pnl: 0, comm: 0, funding: 0, trades: 0 };
    dailyPnl[day].funding += parseFloat(inc.income);
  }
  
  const days = Object.entries(dailyPnl).sort();
  for (const [day, d] of days) {
    const net = d.pnl + d.comm + d.funding;
    const bar = net >= 0 ? '█'.repeat(Math.min(30, Math.floor(net * 10))) : '░'.repeat(Math.min(30, Math.floor(Math.abs(net) * 10)));
    console.log(`  ${day} | ${net >= 0 ? '+' : ''}$${net.toFixed(4)} (${d.trades} closes) ${net >= 0 ? '🟢' : '🔴'} ${bar}`);
  }
  
  // Summary stats
  const winDays = days.filter(([_, d]) => (d.pnl + d.comm + d.funding) > 0).length;
  const lossDays = days.filter(([_, d]) => (d.pnl + d.comm + d.funding) < 0).length;
  console.log(`\n  Win days: ${winDays}/${days.length} | Loss days: ${lossDays}/${days.length}`);
  
  // Recent trades list (last 20)
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  LAST 20 REALIZED PNL EVENTS`);
  console.log(`${'─'.repeat(70)}`);
  
  const recentPnl = realizedPnl.slice(-20);
  for (const inc of recentPnl) {
    const pnl = parseFloat(inc.income);
    const date = new Date(inc.time).toISOString().replace('T', ' ').substring(0, 19);
    console.log(`  ${date} | ${inc.symbol.padEnd(12)} | ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(4)}`);
  }
  
  console.log(`\n${'='.repeat(70)}\n`);
}

main().catch(console.error);
