import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://fkzqjoecqttpuvhjgtvl.supabase.co",
  "sb_publishable_-CAhEP0sH9sz39FNAIp2og_mru3kO_6"
);

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const CHAINS = ["Luxor","Tower","American","Festival","Worldwide","Continental","Imperial"];
const CHAIN_COLORS = {
  Luxor: "#c0392b",        // ruby red
  Tower: "#c9a84c",        // muted yellow
  American: "#1565c0",     // chicago cubs blue
  Festival: "#2d7a3a",     // bright forest green
  Worldwide: "#5d3a1a",    // dark brown
  Continental: "#4db6ac",  // light teal
  Imperial: "#f48fb1",     // light pink
};
const CHAIN_TIERS = {
  Luxor: 0, Tower: 0,
  American: 1, Festival: 1, Worldwide: 1,
  Continental: 2, Imperial: 2
};
// Stock prices by tier and chain size
// Columns: 2, 3, 4, 5, 6-10, 11-20, 21-30, 31-40, 41+
// Tier 0: Luxor, Tower  Tier 1: American, Festival, Worldwide  Tier 2: Continental, Imperial
const ROWS = 9, COLS = 12;

function tileId(r, c) { return r * COLS + c; }
function tileLabel(id) {
  const r = Math.floor(id / COLS), c = id % COLS;
  return `${c + 1}${"ABCDEFGHI"[r]}`;
}

const PRICE_TABLE = [
  [200, 300, 400, 500, 600, 700, 800, 900, 1000],
  [300, 400, 500, 600, 700, 800, 900, 1000, 1100],
  [400, 500, 600, 700, 800, 900, 1000, 1100, 1200],
];

function stockPrice(chain, size) {
  if (!size || size < 2) return 0;
  const tier = CHAIN_TIERS[chain];
  const idx = size >= 41 ? 8 : size >= 31 ? 7 : size >= 21 ? 6 : size >= 11 ? 5 :
    size >= 6 ? 4 : size - 2; // size 2→0, 3→1, 4→2, 5→3
  return PRICE_TABLE[tier][idx];
}

function majorityBonus(chain, size) { return stockPrice(chain, size) * 10; }
function minorityBonus(chain, size) { return stockPrice(chain, size) * 5; }

function calcBonuses(chain, size, stocks, players) {
  const holders = players.map((p, i) => ({ i, shares: stocks[i][chain] || 0 }))
    .filter(p => p.shares > 0).sort((a, b) => b.shares - a.shares);
  if (holders.length === 0) return {};
  const maj = majorityBonus(chain, size), min = minorityBonus(chain, size);
  const bonuses = {};
  if (holders.length === 1) {
    bonuses[holders[0].i] = (bonuses[holders[0].i] || 0) + maj + min;
  } else if (holders[0].shares === holders[1].shares) {
    const split = Math.round((maj + min) / holders.filter(h => h.shares === holders[0].shares).length / 100) * 100;
    holders.filter(h => h.shares === holders[0].shares).forEach(h => { bonuses[h.i] = (bonuses[h.i] || 0) + split; });
  } else {
    bonuses[holders[0].i] = (bonuses[holders[0].i] || 0) + maj;
    const minHolders = holders.slice(1).filter(h => h.shares === holders[1].shares);
    if (minHolders.length > 1) {
      const split = Math.round(min / minHolders.length / 100) * 100;
      minHolders.forEach(h => { bonuses[h.i] = (bonuses[h.i] || 0) + split; });
    } else {
      bonuses[holders[1].i] = (bonuses[holders[1].i] || 0) + min;
    }
  }
  return bonuses;
}

function initDeck() {
  const tiles = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) tiles.push(tileId(r, c));
  for (let i = tiles.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [tiles[i], tiles[j]] = [tiles[j], tiles[i]]; }
  return tiles;
}

function adjacentTiles(id) {
  const r = Math.floor(id / COLS), c = id % COLS, adj = [];
  if (r > 0) adj.push(tileId(r-1, c)); if (r < ROWS-1) adj.push(tileId(r+1, c));
  if (c > 0) adj.push(tileId(r, c-1)); if (c < COLS-1) adj.push(tileId(r, c+1));
  return adj;
}

function getAdjacentChains(tileIds, chainMap) {
  const chains = new Set();
  tileIds.forEach(id => { adjacentTiles(id).forEach(adj => { if (chainMap[adj]) chains.add(chainMap[adj]); }); });
  return [...chains];
}

function floodFill(start, board) {
  const visited = new Set([start]), queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    adjacentTiles(cur).forEach(n => { if (board[n] && !visited.has(n)) { visited.add(n); queue.push(n); } });
  }
  return visited;
}

// ─── AI LOGIC ─────────────────────────────────────────────────────────────────
// difficulty: "novice" | "hobbyist" | "pro"

// Helper: get the max shares any opponent holds in a chain
function opponentMax(chain, myIdx, allStocks) {
  return allStocks.reduce((mx, s, i) => i !== myIdx ? Math.max(mx, s[chain] || 0) : mx, 0);
}

// Helper: rough game-closeness score (0=early, 1=near-end)
function gameCloseness(chainSizes) {
  const active = CHAINS.filter(c => chainSizes[c] > 0);
  if (active.length === 0) return 0;
  const maxSize = Math.max(...active.map(c => chainSizes[c]));
  const safeCount = active.filter(c => chainSizes[c] >= 11).length;
  if (maxSize >= 35 || safeCount >= 3) return 1;
  if (maxSize >= 20 || safeCount >= 2) return 0.6;
  if (maxSize >= 11 || safeCount >= 1) return 0.3;
  return 0;
}

// How many of a tile's 4 potential neighbors actually exist on the board (not off-edge)
// Corner = 2, edge = 3, interior = 4
function tileMaxNeighbors(id) {
  return adjacentTiles(id).length;
}

// How many of a tile's neighbors are empty (not yet placed) — growth headroom
function tileOpenNeighbors(id, board) {
  return adjacentTiles(id).filter(n => !board[n]).length;
}

// Spatial score for a tile: rewards interior placement, penalises corners/edges
// Returns 0–10 where 10 = dead center of board
function tileSpatialScore(id) {
  const r = Math.floor(id / COLS);
  const c = id % COLS;
  // Distance from edge in each direction (0 = on edge, higher = more central)
  const dr = Math.min(r, ROWS - 1 - r); // 0..4
  const dc = Math.min(c, COLS - 1 - c); // 0..5
  // Normalise to 0–10
  return ((dr / 4) + (dc / 5)) * 5;
}

// For a founded chain, estimate its total expansion headroom:
// sum of open neighbors across all its tiles (frontier size)
function chainFrontierSize(chainTileIds, board) {
  const frontier = new Set();
  for (const id of chainTileIds) {
    for (const n of adjacentTiles(id)) {
      if (!board[n]) frontier.add(n);
    }
  }
  return frontier.size;
}

// Average spatial score of a chain's tiles — low means chain is stuck on edges
function chainSpatialScore(chainTileIds) {
  if (chainTileIds.length === 0) return 5;
  return chainTileIds.reduce((s, id) => s + tileSpatialScore(id), 0) / chainTileIds.length;
}

function aiChooseTile(hand, board, chainMap, chainSizes, availableChains, difficulty, playerIndex, playerStocks, allStocks, playerMoney) {
  const playable = hand.filter(t => {
    const adjChains = [...new Set(adjacentTiles(t).map(a => chainMap[a]).filter(Boolean))];
    if (adjChains.length >= 2) {
      return adjChains.filter(c => chainSizes[c] >= 11).length < 2;
    }
    return true;
  });
  const pool = playable.length > 0 ? playable : hand;

  if (difficulty === "novice") return pool[Math.floor(Math.random() * pool.length)];

  const closeness = gameCloseness(chainSizes);
  let best = pool[0], bestScore = -Infinity;

  for (const t of pool) {
    let score = 0;
    const adj = adjacentTiles(t);
    const adjPlaced = adj.filter(a => board[a]);
    const adjChains = [...new Set(adj.map(a => chainMap[a]).filter(Boolean))];
    const spatial = tileSpatialScore(t);
    const openNeighbors = tileOpenNeighbors(t, board);

    if (difficulty === "hobbyist") {
      if (adjChains.length === 1) score += 10 + (chainSizes[adjChains[0]] || 0);
      else if (adjChains.length === 0 && adjPlaced.length > 0 && availableChains.length > 0) score += 5 + spatial * 0.5;
      else if (adjChains.length >= 2) score += 3;
      // Hobbyist has light spatial awareness — prefers tiles with room to grow
      score += openNeighbors * 0.8;
      score += Math.random() * 3;
    }

    if (difficulty === "pro") {
      if (adjChains.length === 1) {
        const c = adjChains[0];
        const size = chainSizes[c] || 0;
        const myShares = (playerStocks && playerStocks[c]) || 0;
        const oppMax = allStocks ? opponentMax(c, playerIndex, allStocks) : 0;

        // Base: growing a chain is good
        score += 10 + size * 1.5;

        // Spatial: how much room does this chain have to keep growing?
        const chainTiles = Object.keys(chainMap).filter(id => chainMap[id] === c).map(Number);
        const frontier = chainFrontierSize(chainTiles, board);
        const chainAvgSpatial = chainSpatialScore(chainTiles);
        // Reward chains with open frontier; penalise chains boxed into corners
        score += frontier * 1.2;
        score += chainAvgSpatial * 1.5;

        // Big bonus for pushing a chain toward safe (11)
        if (size >= 8 && size < 11) score += 40 + (myShares - oppMax) * 5;
        else if (size >= 5 && size < 8) score += 20;

        // Majority value
        if (myShares > oppMax) score += 15 + (myShares - oppMax) * 3;
        else if (myShares < oppMax) score -= 5;

        // End-game urgency
        if (closeness > 0.5) score += size * closeness * 5;

      } else if (adjChains.length === 0 && adjPlaced.length > 0 && availableChains.length > 0) {
        // Founding — spatial value is critical here
        // Central tiles can grow in more directions; corner tiles get hemmed in fast
        score += 6 + spatial * 2.0;
        score += openNeighbors * 2.5; // open neighbors = growth potential
        const myChainsWithStake = CHAINS.filter(c => (playerStocks && playerStocks[c] || 0) > 0).length;
        score += myChainsWithStake < 2 ? 10 : 4;

      } else if (adjChains.length >= 2) {
        const sorted = [...adjChains].sort((a, b) => (chainSizes[b] || 0) - (chainSizes[a] || 0));
        const survivor = sorted[0];
        let mergerScore = 0;

        // Current cash — rich AI doesn't need liquidity, poor AI needs the bonus payout
        const cashNeeded = playerMoney < 2000; // low on cash — bonus payout is especially valuable

        for (const defunct of sorted.slice(1)) {
          const defunctSize = chainSizes[defunct] || 0;
          const defunctPrice = stockPrice(defunct, defunctSize);
          const myShares = (playerStocks && playerStocks[defunct]) || 0;
          const oppMax = allStocks ? opponentMax(defunct, playerIndex, allStocks) : 0;
          const allHolders = allStocks ? allStocks.map(s => s[defunct] || 0) : [];
          const totalHeld = allHolders.reduce((s, n) => s + n, 0);

          // Estimate what bonus we'd receive
          const isMajority = myShares > 0 && myShares >= oppMax;
          const isTied = myShares > 0 && myShares === oppMax;
          const majBonus = defunctPrice * 10;
          const minBonus = defunctPrice * 5;

          let expectedBonus = 0;
          if (myShares > oppMax) expectedBonus = majBonus + (totalHeld === myShares ? minBonus : 0); // sole holder gets both
          else if (isTied) expectedBonus = Math.round((majBonus + minBonus) / 2 / 100) * 100; // split
          else if (myShares > 0) expectedBonus = minBonus; // minority position
          // else 0 — we hold nothing

          // Stock value of our defunct shares (we'll sell or trade them)
          const stockValue = myShares * defunctPrice;

          // Trade opportunity: our defunct shares become survivor shares at 2:1
          const mySurv = (playerStocks && playerStocks[survivor]) || 0;
          const oppSurv = allStocks ? opponentMax(survivor, playerIndex, allStocks) : 0;
          const tradeImprovement = mySurv < oppSurv ? 15 : mySurv === oppSurv ? 8 : 3; // how much trading into survivor helps our position there

          if (myShares === 0 && oppMax > 0) {
            // We hold nothing, opponent profits — strongly avoid
            mergerScore -= 35 + Math.min(expectedBonus / 100, 20);
          } else if (oppMax > myShares + 3) {
            // Opponent dominates — we'd pay them a big bonus
            mergerScore -= 25;
          } else if (myShares > 0) {
            // We benefit: bonus + stock value + trade opportunity
            const benefitScore = (expectedBonus / 200) + (stockValue / 300) + tradeImprovement;
            mergerScore += benefitScore;

            // Extra incentive if we're cash-poor (the bonus payout is urgently needed)
            if (cashNeeded && expectedBonus > 0) mergerScore += 12;

            // Extra incentive if merging pushes survivor toward safe threshold
            const survivorSize = chainSizes[survivor] || 0;
            const mergedSize = survivorSize + defunctSize + 1;
            if (mergedSize >= 11 && survivorSize < 11) mergerScore += 20; // crosses safe!
            else if (mergedSize >= 8) mergerScore += 8;
          }
        }

        // Survivor position bonus
        const mySurv = (playerStocks && playerStocks[survivor]) || 0;
        const oppSurv = allStocks ? opponentMax(survivor, playerIndex, allStocks) : 0;
        if (mySurv > oppSurv) mergerScore += 10;
        else if (mySurv < oppSurv) mergerScore -= 5; // growing opponent's chain

        // Spatial: merged chain's combined frontier
        const survivorTiles = Object.keys(chainMap).filter(id => chainMap[id] === survivor).map(Number);
        const mergedFrontier = chainFrontierSize(survivorTiles, board);
        mergerScore += mergedFrontier * 0.4;

        // Never merge two safe chains
        const safeMerging = adjChains.filter(c => chainSizes[c] >= 11).length;
        if (safeMerging >= 2) mergerScore -= 100;

        score += mergerScore;

      } else {
        // Isolated tile — spatial score only
        score += spatial * 0.8;
        score += openNeighbors * 1.0;
      }

      score += Math.random() * 1.5;
    }

    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
}

function aiChooseChain(availableChains, chainSizes, playerStocks, allStocks, playerIndex, difficulty) {
  if (difficulty === "novice") return availableChains[Math.floor(Math.random() * availableChains.length)];
  if (difficulty === "hobbyist") return availableChains.slice().sort((a, b) => CHAIN_TIERS[a] - CHAIN_TIERS[b])[0];

  // Pro: pick the chain that gives us the best strategic position
  // Prefer high-tier chains we don't already have too many of
  return availableChains.slice().sort((a, b) => {
    const tierDiff = CHAIN_TIERS[b] - CHAIN_TIERS[a];
    // If same tier, prefer the one we have fewer of (diversify)
    const myA = (playerStocks && playerStocks[a]) || 0;
    const myB = (playerStocks && playerStocks[b]) || 0;
    return tierDiff !== 0 ? tierDiff : myA - myB;
  })[0];
}

function aiChooseMergerAction(mergerInfo, playerStocks, playerMoney, chainSizes, stockBank, allStocks, playerIndex, difficulty) {
  const { defunct, survivor } = mergerInfo;
  const shares = playerStocks[defunct] || 0;
  if (shares === 0) return { sell: 0, trade: 0, keep: 0 };

  if (difficulty === "novice") return { sell: shares, trade: 0, keep: 0 };

  const tradeMax = Math.floor(shares / 2) * 2;
  const bankAvail = stockBank[survivor] || 0;
  const maxTradeable = Math.min(tradeMax, bankAvail * 2);

  if (difficulty === "hobbyist") {
    const trade = Math.floor(maxTradeable / 2) * 2;
    return { sell: shares - trade, trade, keep: 0 };
  }

  // Pro: decide between trading and selling based on survivor position
  const mysurvivorShares = (playerStocks[survivor] || 0);
  const oppSurvivorMax = allStocks ? opponentMax(survivor, playerIndex, allStocks) : 0;
  const survivorPrice = stockPrice(survivor, chainSizes[survivor]);
  const defunctPrice = stockPrice(defunct, chainSizes[defunct]);

  // If survivor is high value and we don't dominate it yet, maximise trade
  const shouldTrade = survivorPrice >= defunctPrice || mysurvivorShares <= oppSurvivorMax + 2;

  if (shouldTrade) {
    // Maximise trade but keep enough cash flow to buy next turn
    const tradeAmt = maxTradeable;
    const cashFromSell = (shares - tradeAmt) * defunctPrice;
    return { sell: shares - tradeAmt, trade: tradeAmt, keep: 0 };
  } else {
    // Sell most, trade a few to maintain some position
    const trade = Math.min(Math.floor(maxTradeable / 2) * 2, 4);
    return { sell: shares - trade, trade, keep: 0 };
  }
}

function aiBuyStocks(playerMoney, chainSizes, stockBank, playerStocks, allStocks, players, playerIndex, difficulty, chainMap, board) {
  const buys = {};
  let money = playerMoney, slots = 3;
  const closeness = gameCloseness(chainSizes);

  if (difficulty === "novice") {
    const active = CHAINS.filter(c => chainSizes[c] > 0 && (stockBank[c] || 0) > 0)
      .sort(() => Math.random() - 0.5);
    for (const chain of active) {
      if (slots <= 0) break;
      const price = stockPrice(chain, chainSizes[chain]);
      if (price > money) continue;
      if (Math.random() > 0.3) { buys[chain] = 1; money -= price; slots--; }
    }
    return buys;
  }

  if (difficulty === "hobbyist") {
    const active = CHAINS.filter(c => chainSizes[c] > 0 && (stockBank[c] || 0) > 0)
      .sort((a, b) => stockPrice(a, chainSizes[a]) - stockPrice(b, chainSizes[b]));
    for (const chain of active) {
      if (slots <= 0) break;
      const price = stockPrice(chain, chainSizes[chain]);
      if (price <= 0 || price > money) continue;
      buys[chain] = 1; money -= price; slots--;
    }
    return buys;
  }

  // Pro: sophisticated scoring
  const active = CHAINS.filter(c => chainSizes[c] > 0 && (stockBank[c] || 0) > 0);

  const scored = active.map(chain => {
    const size = chainSizes[chain];
    const price = stockPrice(chain, size);
    const myShares = playerStocks[chain] || 0;
    const oppMax = players ? opponentMax(chain, playerIndex, allStocks) : 0;
    const lead = myShares - oppMax;

    // Spatial: compute real frontier size for this chain
    const chainTileIds = chainMap ? Object.keys(chainMap).filter(id => chainMap[id] === chain).map(Number) : [];
    const frontier = board && chainTileIds.length > 0 ? chainFrontierSize(chainTileIds, board) : 8;
    const avgSpatial = chainTileIds.length > 0 ? chainSpatialScore(chainTileIds) : 5;
    // A chain with a large open frontier can still grow big; penalise chains boxed in on edges
    const spatialBonus = (frontier * 0.4) + (avgSpatial * 0.3);

    let score = 0;

    // Strategic value of the chain itself
    if (size >= 9 && size < 11) score += 50;       // almost safe — huge value
    else if (size >= 6 && size < 9) score += 28;   // building toward safe
    else if (size >= 3 && size < 6) score += 12;   // early but growing
    else if (size >= 1 && size < 3) score += 4;    // tiny, low priority

    // Spatial bonus: central chains with open frontiers are worth more
    score += spatialBonus;

    // Tier value (Continental/Imperial worth more long term)
    score += CHAIN_TIERS[chain] * 8;

    // Majority battle scoring
    if (myShares === 0 && oppMax === 0) {
      score += 14; // uncontested — get in early
    } else if (myShares < oppMax) {
      // Behind — urgency scales with how close the chain is to paying out
      const urgency = size >= 9 ? 30 : size >= 6 ? 18 : 10;
      score += urgency;
    } else if (lead === 0) {
      score += 16; // tied — one share wins majority
    } else if (lead === 1) {
      score += 10; // narrow lead — protect it
    } else {
      // Comfortable/dominant lead — diminishing returns
      score += Math.max(0, 8 - lead * 2);
    }

    // End-game urgency: late game, double down on chains you're winning
    if (closeness > 0.5 && myShares > oppMax) score += 20 * closeness;
    if (closeness > 0.7 && myShares < oppMax) score += 15 * closeness; // desperate catch-up

    // Price efficiency — don't blow all cash on one expensive chain
    const affordability = Math.floor(money / price);
    if (affordability <= 1 && price > 600) score -= 8; // nearly broke after buying

    score += Math.random() * 3;
    return { chain, price, score };
  }).sort((a, b) => b.score - a.score);

  for (const { chain, price } of scored) {
    if (slots <= 0) break;
    if (price <= 0 || price > money || (stockBank[chain] || 0) <= 0) continue;
    const maxBuy = Math.min(slots, Math.floor(money / price), stockBank[chain]);
    if (maxBuy > 0) { buys[chain] = maxBuy; money -= maxBuy * price; slots -= maxBuy; }
  }
  return buys;
}

// ─── GAME STATE INIT ──────────────────────────────────────────────────────────
function initGame(playerSetup) {
  const deck = initDeck();
  const hands = playerSetup.map(() => deck.splice(0, 6));
  const stockBank = {};
  CHAINS.forEach(c => stockBank[c] = 25);
  const stocks = playerSetup.map(() => { const s = {}; CHAINS.forEach(c => s[c] = 0); return s; });
  return {
    phase: "placeTile", // placeTile | foundChain | buyStocks | merger | gameOver
    players: playerSetup,
    currentPlayer: Math.floor(Math.random() * playerSetup.length),
    hands,
    board: {}, // tileId -> true
    chainMap: {}, // tileId -> chainName
    chainSizes: Object.fromEntries(CHAINS.map(c => [c, 0])),
    stockBank,
    stocks,
    money: playerSetup.map(() => 6000),
    deck,
    log: [],
    mergerQueue: [],
    mergerInfo: null,
    gameOverStats: null,
    availableChains: [...CHAINS],
  };
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function AcquireGame() {
  const [setup, setSetup] = useState(null); // null = setup screen
  const [game, setGame] = useState(null);
  const [selectedTile, setSelectedTile] = useState(null);
  const [selectedChain, setSelectedChain] = useState(null);
  // buyCart lives in TurnPanel now
  const [mergerChoice, setMergerChoice] = useState({ sell: 0, trade: 0 });
  const [aiThinking, setAiThinking] = useState(false);
  const [animTile, setAnimTile] = useState(null);
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [playerActions, setPlayerActions] = useState({}); // playerIndex → {tile, stocks}

  // ── Multiplayer room state ──────────────────────────────────────────────────
  const [roomCode, setRoomCode] = useState(null);
  const [myPlayerIndex, setMyPlayerIndex] = useState(null); // which seat this device controls
  const [connectionStatus, setConnectionStatus] = useState("idle"); // idle | connecting | connected | error
  const gameRef = useRef(null); // mirrors `game` for use inside callbacks without stale closures
  gameRef.current = game;

  // Write a new game state to Supabase. Every device's realtime subscription (including
  // our own) will receive the update and call setGame — so we don't need to setGame here too,
  // though we do it anyway for instant local feedback before the round-trip completes.
  async function syncGame(newGameOrUpdater) {
    const current = gameRef.current;
    const next = typeof newGameOrUpdater === "function" ? newGameOrUpdater(current) : newGameOrUpdater;
    if (!next) return;
    setGame(next); // optimistic local update
    if (!roomCode) return; // not in multiplayer mode (shouldn't happen, but safe)
    const { error } = await supabase
      .from("games")
      .update({ state: next, updated_at: new Date().toISOString() })
      .eq("room_code", roomCode);
    if (error) console.error("Supabase sync error:", error);
  }

  // Subscribe to realtime updates for our room
  useEffect(() => {
    if (!roomCode) return;
    const channel = supabase
      .channel(`room-${roomCode}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games", filter: `room_code=eq.${roomCode}` },
        (payload) => {
          const incoming = payload.new.state;
          // Avoid redundant re-renders if it's literally the same object we just wrote
          setGame(incoming);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [roomCode]);

  async function createRoom(playerSetup) {
    setConnectionStatus("connecting");
    const code = makeRoomCode();
    const initialState = initGame(playerSetup);
    const { error } = await supabase.from("games").insert({ room_code: code, state: initialState });
    if (error) { console.error(error); setConnectionStatus("error"); return; }
    setRoomCode(code);
    setMyPlayerIndex(0); // creator always occupies the seat they configured as themselves (seat 0 in setup)
    setGame(initialState);
    setSetup(playerSetup);
    setConnectionStatus("connected");
    // Note: who goes FIRST each game is randomized independently in initGame() via currentPlayer —
    // being the creator (seat 0) does not mean going first.
  }

  async function joinRoom(code, seatIndex) {
    setConnectionStatus("connecting");
    const { data, error } = await supabase.from("games").select("*").eq("room_code", code).single();
    if (error || !data) { setConnectionStatus("error"); return false; }
    setRoomCode(code);
    setMyPlayerIndex(seatIndex);
    setGame(data.state);
    setSetup(data.state.players);
    setConnectionStatus("connected");
    return true;
  }

  function pushTileAction(text, color, playerIndex) {
    setPlayerActions(a => ({ ...a, [playerIndex]: { ...a[playerIndex], tile: { text, color: color || "#ccc" }, stocks: null } }));
  }
  function pushStockAction(text, color, playerIndex) {
    setPlayerActions(a => ({ ...a, [playerIndex]: { ...a[playerIndex], stocks: { text, color: color || "#ccc" } } }));
  }
  // Keep for mergers / misc
  function pushToast(text, color, playerIndex) {
    setPlayerActions(a => ({ ...a, [playerIndex]: { ...a[playerIndex], stocks: { text, color: color || "#ccc" } } }));
  }

  // ── AI Turn Driver ──────────────────────────────────────────────────────────
  // Only seat 0 (the room creator/host) runs AI logic and auto-advances —
  // otherwise every connected device would race to make the same AI move.
  useEffect(() => {
    if (!game || game.phase === "gameOver") return;
    if (myPlayerIndex !== 0) return; // not the host — let the host's browser drive AI turns

    // No stockholders in defunct chain — auto-advance regardless of who triggered the merger
    if (game.phase === "merger" && game.mergerInfo?.playerIndex == null) {
      const advanced = advanceAfterDefunct(game, game.mergerInfo.defunct, game.mergerInfo.survivor, [...game.money], game.stocks.map(s => ({ ...s })), { ...game.stockBank });
      syncGame(advanced.g);
      return;
    }

    // Safety: if current merger playerIndex somehow has 0 shares, skip them immediately
    if (game.phase === "merger" && game.mergerInfo?.playerIndex != null) {
      const pi = game.mergerInfo.playerIndex;
      if ((game.stocks[pi]?.[game.mergerInfo.defunct] || 0) === 0) {
        const result = applyMergerChoice(game, 0, 0);
        syncGame(result.g);
        return;
      }
    }

    // For merger phase, the acting player is mergerInfo.playerIndex, not currentPlayer
    const actingPlayerIndex = game.phase === "merger" && game.mergerInfo?.playerIndex != null
      ? game.mergerInfo.playerIndex
      : game.currentPlayer;
    const actingPlayer = game.players[actingPlayerIndex];
    if (!actingPlayer || actingPlayer.type !== "ai") return;
    if (game.phase === "chooseSurvivor" && game.players[game.currentPlayer]?.type !== "ai") return;

    // mergerAnnounce: only auto-dismiss if ALL players are AI (otherwise human needs to read it)
    if (game.phase === "mergerAnnounce") {
      const hasHuman = game.players.some(p => p.type === "human");
      if (hasHuman) return;
    }

    setAiThinking(true);
    const timer = setTimeout(() => {
      const nextGame = runAiTurn(game);
      syncGame(nextGame);
      setAiThinking(false);
    }, 900);
    return () => clearTimeout(timer);
  }, [game?.phase, game?.currentPlayer, game?.mergerInfo?.playerIndex, game?.mergerAnnouncement]);

  function runAiTurn(g) {
    const pi = g.phase === "merger" && g.mergerInfo?.playerIndex != null
      ? g.mergerInfo.playerIndex
      : g.currentPlayer;
    const difficulty = g.players[pi].difficulty || "hobbyist";
    let result;
    if (g.phase === "mergerAnnounce") {
      result = applyDismissAnnouncement(g);
      if (result.toast) pushToast(result.toast.text, result.toast.color, pi);
    } else if (g.phase === "placeTile") {
      const tile = aiChooseTile(g.hands[pi], g.board, g.chainMap, g.chainSizes, g.availableChains, difficulty, pi, g.stocks[pi], g.stocks, g.money[pi]);
      result = applyPlaceTile(g, tile);
      if (result.toast) pushTileAction(result.toast.text, result.toast.color, pi);
    } else if (g.phase === "foundChain") {
      const chain = aiChooseChain(g.availableChains, g.chainSizes, g.stocks[pi], g.stocks, pi, difficulty);
      result = applyFoundChain(g, chain);
      if (result.toast) pushTileAction(result.toast.text, result.toast.color, pi);
    } else if (g.phase === "chooseSurvivor") {
      const survivor = (g.tiedChains || []).slice().sort((a, b) => CHAIN_TIERS[b] - CHAIN_TIERS[a])[0];
      result = applyChooseSurvivor(g, survivor);
      if (result.toast) pushTileAction(result.toast.text, result.toast.color, pi);
    } else if (g.phase === "merger") {
      const mi = g.mergerInfo;
      if (mi && mi.playerIndex === pi) {
        const choice = aiChooseMergerAction(mi, g.stocks[pi], g.money[pi], g.chainSizes, g.stockBank, g.stocks, pi, difficulty);
        result = applyMergerChoice(g, choice.sell, choice.trade);
        if (result.toast) pushToast(result.toast.text, result.toast.color, pi);
      } else return g;
    } else if (g.phase === "buyStocks") {
      const buys = aiBuyStocks(g.money[pi], g.chainSizes, g.stockBank, g.stocks[pi], g.stocks, g.players, pi, difficulty, g.chainMap, g.board);
      result = applyBuyStocks(g, buys);
      if (result.toast) pushStockAction(result.toast.text, result.toast.color, pi);
    } else return g;

    return result.g;
  }

  // ── Core Game Logic ─────────────────────────────────────────────────────────
  function buildAnnouncement(g, defunct, survivor) {
    const size = g.chainSizes[defunct];
    const price = stockPrice(defunct, size);
    const holders = g.players.map((p, i) => ({ i, name: p.name, shares: g.stocks[i][defunct] || 0 }))
      .filter(h => h.shares > 0)
      .sort((a, b) => b.shares - a.shares);
    const bonuses = calcBonuses(defunct, size, g.stocks, g.players);
    return { defunct, survivor, size, price, holders, bonuses };
  }

  function applyDismissAnnouncement(g) {
    const mi = g.mergerInfo;
    // If no one holds stock, skip straight to next defunct or buyStocks
    if (!mi.players || mi.players.length === 0) {
      return advanceAfterDefunct(g, mi.defunct, mi.survivor, [...g.money], g.stocks.map(s => ({ ...s })), { ...g.stockBank });
    }
    return { g: { ...g, phase: "merger" }, toast: null };
  }

  function advanceAfterDefunct(g, defunct, survivor, newMoney, newStocks, newBank) {
    // Pay bonuses using the amounts calculated at announcement time (pre-resolution holdings)
    const bonuses = g.mergerAnnouncement?.bonuses || calcBonuses(defunct, g.chainSizes[defunct], g.stocks, g.players);
    Object.entries(bonuses).forEach(([i, amt]) => { newMoney[parseInt(i)] += amt; });

    // Absorb defunct tiles into survivor
    const newChainMap = { ...g.chainMap };
    Object.keys(newChainMap).forEach(t => { if (newChainMap[t] === defunct) newChainMap[t] = survivor; });
    if (g.pendingTile) newChainMap[g.pendingTile] = survivor;
    const newSize = Object.keys(newChainMap).filter(t => newChainMap[t] === survivor).length;
    const newChainSizes = { ...g.chainSizes, [survivor]: newSize, [defunct]: 0 };
    const newAvailable = [...g.availableChains, defunct].sort((a, b) => CHAINS.indexOf(a) - CHAINS.indexOf(b));

    const bonusText = Object.entries(bonuses).map(([i, amt]) => `${g.players[i].name} +$${amt.toLocaleString()}`).join(", ");

    // Next defunct in queue?
    if (g.mergerQueue.length > 0) {
      const next = g.mergerQueue[0];
      const announcement = buildAnnouncement({ ...g, chainSizes: newChainSizes, stocks: newStocks }, next.defunct, next.survivor);
      return {
        g: { ...g, money: newMoney, stocks: newStocks, stockBank: newBank, chainMap: newChainMap, chainSizes: newChainSizes, availableChains: newAvailable, phase: "mergerAnnounce", mergerQueue: g.mergerQueue.slice(1), mergerInfo: { ...next, playerIndex: next.players[0] ?? null }, mergerAnnouncement: announcement },
        toast: { text: bonusText || `${defunct} absorbed`, color: "#e74c3c" }
      };
    }

    // All done — tile placer now buys stocks
    return {
      g: { ...g, money: newMoney, stocks: newStocks, stockBank: newBank, chainMap: newChainMap, chainSizes: newChainSizes, availableChains: newAvailable, phase: "buyStocks", mergerInfo: null, mergerAnnouncement: null, pendingTile: null },
      toast: { text: bonusText || `Merger complete`, color: "#e74c3c" }
    };
  }
  function applyPlaceTile(g, tile) {
    const newBoard = { ...g.board, [tile]: true };
    const newHands = g.hands.map((h, i) => i === g.currentPlayer ? h.filter(t => t !== tile) : h);
    const adj = adjacentTiles(tile);
    const adjChains = [...new Set(adj.map(a => g.chainMap[a]).filter(Boolean))];
    const adjPlaced = adj.filter(a => newBoard[a] && !g.chainMap[a]);
    const pname = g.players[g.currentPlayer].name;

    const safeChains = adjChains.filter(c => g.chainSizes[c] >= 11);
    if (safeChains.length >= 2) {
      // AI auto-discards; humans handle this via the revealDead flow before ever calling applyPlaceTile
      const newDeck = [...g.deck];
      const newTile = newDeck.shift();
      const updatedHands = newHands.map((h, i) => i === g.currentPlayer ? (newTile !== undefined ? [...h, newTile] : h) : h);
      return { g: { ...g, board: g.board, hands: updatedHands, deck: newDeck, phase: "buyStocks" }, toast: { text: `Dead tile auto-discarded`, color: "#888" } };
    }

    if (adjChains.length >= 2) {
      const sorted = [...adjChains].sort((a, b) => g.chainSizes[b] - g.chainSizes[a]);
      const maxSize = g.chainSizes[sorted[0]];
      const tied = sorted.filter(c => g.chainSizes[c] === maxSize);

      // If there's a tie and current player is human, ask them to pick the survivor
      if (tied.length > 1 && g.players[g.currentPlayer].type === "human") {
        return {
          g: { ...g, board: newBoard, hands: newHands, phase: "chooseSurvivor", pendingTile: tile, tiedChains: tied },
          toast: { text: `Tie! Choose which chain survives`, color: "#f4c542" }
        };
      }

      // AI or no tie: pick highest-tier chain among tied as survivor
      const survivor = tied.sort((a, b) => CHAIN_TIERS[b] - CHAIN_TIERS[a])[0];
      const defuncts = sorted.filter(c => c !== survivor);
      const mergerQueue = [];
      for (const defunct of defuncts) {
        const playerOrder = [];
        for (let offset = 0; offset < g.players.length; offset++) {
          const pi = (g.currentPlayer + offset) % g.players.length;
          if ((g.stocks[pi][defunct] || 0) > 0) playerOrder.push(pi);
        }
        mergerQueue.push({ defunct, survivor, players: playerOrder });
      }
      // Build announcement for first defunct chain
      const firstDefunct = defuncts[0];
      const announcement = buildAnnouncement(g, firstDefunct, survivor);
      return {
        g: { ...g, board: newBoard, hands: newHands, phase: "mergerAnnounce", mergerQueue: mergerQueue.slice(1), mergerInfo: { defunct: firstDefunct, survivor, players: mergerQueue[0].players, playerIndex: mergerQueue[0].players[0] ?? null }, mergerAnnouncement: announcement, pendingTile: tile },
        toast: { text: `🔀 Merger! ${survivor} absorbs ${defuncts.join(", ")}`, color: "#e74c3c" }
      };
    }

    if (adjChains.length === 1) {
      const chain = adjChains[0];
      const newChainMap = { ...g.chainMap, [tile]: chain };
      const connected = floodFill(tile, newBoard);
      connected.forEach(t => { if (!newChainMap[t]) newChainMap[t] = chain; });
      const newSize = Object.values(newChainMap).filter(c => c === chain).length;
      const newChainSizes = { ...g.chainSizes, [chain]: newSize };
      return { g: { ...g, board: newBoard, chainMap: newChainMap, chainSizes: newChainSizes, hands: newHands, phase: "buyStocks" }, toast: { text: `Placed ${tileLabel(tile)} → ${chain} (${newSize})`, color: CHAIN_COLORS[chain] } };
    }

    if (adjPlaced.length > 0 || adjChains.length === 0 && adj.some(a => newBoard[a])) {
      if (g.availableChains.length > 0) {
        return { g: { ...g, board: newBoard, hands: newHands, phase: "foundChain", pendingTile: tile }, toast: { text: `Placed ${tileLabel(tile)} — founding chain`, color: "#f4c542" } };
      }
      // Would found a chain but no chains available — unplayable, discard and draw
      const newDeck = [...g.deck];
      const newTile = newDeck.shift();
      const updatedHands = newHands.map((h, i) => i === g.currentPlayer ? (newTile !== undefined ? [...h, newTile] : h) : h);
      return { g: { ...g, board: { ...g.board }, hands: updatedHands, deck: newDeck, phase: "buyStocks" }, toast: { text: `Discarded unplayable tile (no chains available)`, color: "#888" } };
    }

    return { g: { ...g, board: newBoard, hands: newHands, phase: "buyStocks" }, toast: { text: `Placed ${tileLabel(tile)}`, color: "#ccc" } };
  }

  function applyFoundChain(g, chain) {
    const tile = g.pendingTile;
    const newChainMap = { ...g.chainMap };
    const connected = floodFill(tile, g.board);
    connected.forEach(t => { newChainMap[t] = chain; });
    const size = connected.size;
    const newChainSizes = { ...g.chainSizes, [chain]: size };
    const newAvailable = g.availableChains.filter(c => c !== chain);
    const newStocks = g.stocks.map((s, i) => i === g.currentPlayer ? { ...s, [chain]: (s[chain] || 0) + 1 } : s);
    const newBank = { ...g.stockBank, [chain]: (g.stockBank[chain] || 25) - 1 };
    return {
      g: { ...g, chainMap: newChainMap, chainSizes: newChainSizes, availableChains: newAvailable, stocks: newStocks, stockBank: newBank, phase: "buyStocks", pendingTile: null },
      toast: { text: `Founded ${chain}! (free share)`, color: CHAIN_COLORS[chain] }
    };
  }

  function applyChooseSurvivor(g, survivor) {
    const tile = g.pendingTile;
    const adj = adjacentTiles(tile);
    const allAdjChains = [...new Set(adj.map(a => g.chainMap[a]).filter(Boolean))];
    const allDefuncts = allAdjChains.filter(c => c !== survivor);
    const mergerQueue = [];
    for (const defunct of allDefuncts) {
      const playerOrder = [];
      for (let offset = 0; offset < g.players.length; offset++) {
        const pi = (g.currentPlayer + offset) % g.players.length;
        if ((g.stocks[pi][defunct] || 0) > 0) playerOrder.push(pi);
      }
      mergerQueue.push({ defunct, survivor, players: playerOrder });
    }
    const firstDefunct = allDefuncts[0];
    const announcement = buildAnnouncement(g, firstDefunct, survivor);
    return {
      g: { ...g, phase: "mergerAnnounce", tiedChains: null, mergerQueue: mergerQueue.slice(1), mergerInfo: { defunct: firstDefunct, survivor, players: mergerQueue[0]?.players || [], playerIndex: mergerQueue[0]?.players[0] ?? null }, mergerAnnouncement: announcement },
      toast: { text: `🔀 ${survivor} survives, absorbs ${allDefuncts.join(", ")}`, color: "#e74c3c" }
    };
  }

  function applyMergerChoice(g, sell, trade) {
    const mi = g.mergerInfo;
    const pi = mi.playerIndex;
    const { defunct, survivor } = mi;
    const price = stockPrice(defunct, g.chainSizes[defunct]);
    let newMoney = [...g.money];
    let newStocks = g.stocks.map(s => ({ ...s }));
    let newBank = { ...g.stockBank };

    newMoney[pi] += sell * price;
    newStocks[pi][defunct] -= sell + trade;
    newBank[defunct] = (newBank[defunct] || 0) + sell + trade;
    const tradeGet = Math.floor(trade / 2);
    newStocks[pi][survivor] = (newStocks[pi][survivor] || 0) + tradeGet;
    newBank[survivor] = Math.max(0, (newBank[survivor] || 0) - tradeGet);

    const toastText = `${g.players[pi].name}: sold ${sell}, traded ${trade}→${tradeGet} ${survivor}, kept ${newStocks[pi][defunct]}`;

    // More stockholders to resolve? Use the already-pruned players list, recheck shares
    const remaining = (mi.players || []).filter(p => p !== pi && (newStocks[p]?.[defunct] || 0) > 0);
    if (remaining.length > 0) {
      return {
        g: { ...g, money: newMoney, stocks: newStocks, stockBank: newBank, mergerInfo: { ...mi, playerIndex: remaining[0], players: remaining } },
        toast: { text: toastText, color: "#e74c3c" }
      };
    }

    // All done with this defunct chain
    const result = advanceAfterDefunct(
      { ...g, money: newMoney, stocks: newStocks, stockBank: newBank },
      defunct, survivor, newMoney, newStocks, newBank
    );
    return { g: result.g, toast: { text: toastText, color: "#e74c3c" } };
  }

  function applyBuyStocks(g, buys) {
    let newMoney = [...g.money];
    let newStocks = g.stocks.map(s => ({ ...s }));
    let newBank = { ...g.stockBank };
    const pi = g.currentPlayer;
    let cost = 0;
    const buyLog = [];
    Object.entries(buys).forEach(([chain, qty]) => {
      if (qty > 0) {
        const p = stockPrice(chain, g.chainSizes[chain]);
        cost += p * qty;
        newStocks[pi][chain] = (newStocks[pi][chain] || 0) + qty;
        newBank[chain] = (newBank[chain] || 0) - qty;
        buyLog.push(`${qty}×${chain}`);
      }
    });
    newMoney[pi] -= cost;
    const buyStr = buyLog.length > 0 ? `Bought ${buyLog.join(", ")} for $${cost.toLocaleString()}` : "Passed on stocks";
    const toastMsg = { text: `${buyStr}`, color: buyLog.length > 0 ? "#2ecc71" : "#888" };

    const newDeck = [...g.deck];
    const newHands = g.hands.map((h, i) => {
      if (i !== pi) return h;
      const drawn = newDeck.shift();
      return drawn !== undefined ? [...h, drawn] : h;
    });

    const shouldEnd = checkGameEnd({ ...g, chainSizes: g.chainSizes });
    if (shouldEnd) {
      return { g: finishGame({ ...g, money: newMoney, stocks: newStocks, stockBank: newBank, hands: newHands, deck: newDeck }), toast: toastMsg };
    }

    const next = (pi + 1) % g.players.length;
    return { g: { ...g, money: newMoney, stocks: newStocks, stockBank: newBank, hands: newHands, deck: newDeck, phase: "placeTile", currentPlayer: next }, toast: toastMsg };
  }

  function checkGameEnd(g) {
    const active = CHAINS.filter(c => g.chainSizes[c] >= 1);
    if (active.length === 0) return false;
    if (active.some(c => g.chainSizes[c] >= 41)) return true;
    if (active.every(c => g.chainSizes[c] >= 11)) return true;
    return false;
  }

  function finishGame(g) {
    let finalMoney = [...g.money];
    const cashAtEnd = [...g.money]; // cash before any payouts

    // Per-chain breakdown: bonuses and stock cashouts
    const chainBreakdown = CHAINS.map(chain => {
      const size = g.chainSizes[chain];
      if (size === 0) return null;
      const price = stockPrice(chain, size);
      const bonuses = calcBonuses(chain, size, g.stocks, g.players);
      const holders = g.players.map((p, i) => ({
        i, name: p.name,
        shares: g.stocks[i][chain] || 0,
        stockValue: (g.stocks[i][chain] || 0) * price,
        bonus: bonuses[i] || 0,
      })).filter(h => h.shares > 0).sort((a, b) => b.shares - a.shares);
      // Pay out
      Object.entries(bonuses).forEach(([i, amt]) => { finalMoney[parseInt(i)] += amt; });
      g.players.forEach((_, i) => {
        const shares = g.stocks[i][chain] || 0;
        if (shares > 0) finalMoney[i] += shares * price;
      });
      return { chain, size, price, holders, bonuses };
    }).filter(Boolean);

    // Final rankings
    const ranked = g.players.map((p, i) => ({ i, name: p.name, total: finalMoney[i] }))
      .sort((a, b) => b.total - a.total);
    const medals = ["🥇","🥈","🥉","4th","5th","6th"];
    ranked.forEach((r, pos) => { r.place = medals[pos]; });

    const winner = finalMoney.reduce((best, m, i) => m > finalMoney[best] ? i : best, 0);
    return { ...g, money: finalMoney, phase: "gameOver", gameOverStats: { finalMoney, cashAtEnd, chainBreakdown, ranked, winner } };
  }

  // ── Event Handlers ──────────────────────────────────────────────────────────
  function handleTileClick(tile) {
    if (!game || game.phase !== "placeTile") return;
    if (game.currentPlayer !== myPlayerIndex) return; // not your turn
    if (game.players[game.currentPlayer].type === "ai") return;
    if (!game.hands[myPlayerIndex].includes(tile)) return;
    setSelectedTile(tile);
  }

  function handlePlaceTile() {
    if (selectedTile === null) return;
    if (game.currentPlayer !== myPlayerIndex) return; // not your turn
    const result = applyPlaceTile(game, selectedTile);
    syncGame(result.g);
    if (result.toast) pushTileAction(result.toast.text, result.toast.color, game.currentPlayer);
    setSelectedTile(null);
    setAnimTile(selectedTile);
    setTimeout(() => setAnimTile(null), 600);
  }

  function handleFoundChain(chain) {
    if (game.currentPlayer !== myPlayerIndex) return;
    const result = applyFoundChain(game, chain);
    syncGame(result.g);
    if (result.toast) pushTileAction(result.toast.text, result.toast.color, game.currentPlayer);
    setSelectedChain(null);
  }

  function handleBuyStocks(cart, endAfter = false) {
    if (game.currentPlayer !== myPlayerIndex) return;
    const result = applyBuyStocks(game, cart);
    const nextGame = endAfter ? finishGame(result.g) : result.g;
    syncGame(nextGame);
    if (result.toast) pushStockAction(result.toast.text, result.toast.color, game.currentPlayer);
  }

  function handleMergerConfirm() {
    const mi = game.mergerInfo;
    if (mi.playerIndex !== myPlayerIndex) return; // not your seat's merger to resolve
    const total = (mergerChoice.sell || 0) + (mergerChoice.trade || 0);
    const shares = game.stocks[mi.playerIndex][mi.defunct] || 0;
    if (total > shares) return;
    const result = applyMergerChoice(game, mergerChoice.sell || 0, Math.floor((mergerChoice.trade || 0) / 2) * 2);
    syncGame(result.g);
    if (result.toast) pushToast(result.toast.text, result.toast.color, mi.playerIndex);
    setMergerChoice({ sell: 0, trade: 0 });
  }

  function handleDismissAnnouncement() {
    if (game.currentPlayer !== myPlayerIndex) return;
    const result = applyDismissAnnouncement(game);
    syncGame(result.g);
    if (result.toast) pushToast(result.toast.text, result.toast.color, game.currentPlayer);
  }

  function handleChooseSurvivor(survivor) {
    if (game.currentPlayer !== myPlayerIndex) return;
    const result = applyChooseSurvivor(game, survivor);
    syncGame(result.g);
    if (result.toast) pushTileAction(result.toast.text, result.toast.color, game.currentPlayer);
  }

  function handleRevealDead(tile) {
    if (game.currentPlayer !== myPlayerIndex) return;
    // Reveal the dead tile to all players, wait for confirm to discard
    syncGame(g => ({ ...g, phase: "revealDead", deadTile: tile }));
    pushTileAction(`Dead tile revealed: ${tileLabel(tile)}`, "#e74c3c", game.currentPlayer);
  }

  function handleConfirmDead() {
    if (game.currentPlayer !== myPlayerIndex) return;
    const tile = game.deadTile;
    const pi = game.currentPlayer;
    const newDeck = [...game.deck];
    const newTile = newDeck.shift();
    const newHands = game.hands.map((h, i) => {
      if (i !== pi) return h;
      const without = h.filter(t => t !== tile);
      return newTile !== undefined ? [...without, newTile] : without;
    });
    syncGame(g => ({ ...g, phase: "placeTile", deadTile: null, hands: newHands, deck: newDeck }));
    pushTileAction(`Drew replacement for dead tile`, "#888", pi);
  }

  function handleEndGame() {
    syncGame(g => finishGame(g));
  }

  // ── Lobby / Room flow ─────────────────────────────────────────────────────────
  if (!roomCode) {
    return (
      <LobbyScreen
        onCreate={createRoom}
        onJoin={joinRoom}
        connectionStatus={connectionStatus}
      />
    );
  }
  if (!game) {
    return (
      <div style={{ ...styles.root, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#888", fontSize: 14 }}>Connecting to room {roomCode}…</div>
      </div>
    );
  }

  const cp = game.currentPlayer;
  const cpPlayer = game.players[cp];
  // Determine who is acting right now — accounts for merger resolution having a different actor than currentPlayer
  const actingIndex = (game.phase === "merger" && game.mergerInfo?.playerIndex != null)
    ? game.mergerInfo.playerIndex
    : cp;
  // "isHuman" here means: is THIS device's seat the one currently allowed to act
  const isHuman = actingIndex === myPlayerIndex && game.players[actingIndex]?.type === "human";

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={styles.logo}>ACQUIRE</span>
          <span style={{ fontSize: 11, color: "#666", border: "1px solid #2a2a3a", borderRadius: 4, padding: "3px 8px", letterSpacing: 2 }}>
            ROOM <span style={{ color: "#f4c542", fontWeight: 700 }}>{roomCode}</span>
          </span>
          <span style={{ fontSize: 11, color: "#555" }}>You are: <span style={{ color: "#2ecc71" }}>{game.players[myPlayerIndex]?.name}</span></span>
        </div>
        <div style={styles.headerRight}>
          <button style={styles.btnSecondary} onClick={() => setShowScoreboard(s => !s)}>📊 Scores</button>
          <button style={styles.btnSecondary} onClick={() => { setGame(null); setSetup(null); setRoomCode(null); setMyPlayerIndex(null); }}>↩ Menu</button>
        </div>
      </div>

      <div style={styles.body}>
        {/* Board */}
        <div style={styles.boardWrap}>
          <Board game={game} selectedTile={selectedTile} onTileClick={handleTileClick} animTile={animTile} myPlayerIndex={myPlayerIndex} />
          <ChainLegend chainSizes={game.chainSizes} stockBank={game.stockBank} />
        </div>

        {/* Sidebar */}
        <div style={styles.sidebar}>
          {showScoreboard && <Scoreboard game={game} onClose={() => setShowScoreboard(false)} myPlayerIndex={myPlayerIndex} />}
          <TurnPanel
            game={game} isHuman={isHuman} myPlayerIndex={myPlayerIndex} aiThinking={aiThinking}
            selectedTile={selectedTile} onTileClick={handleTileClick}
            onPlaceTile={handlePlaceTile}
            selectedChain={selectedChain} setSelectedChain={setSelectedChain}
            onFoundChain={handleFoundChain}
            onChooseSurvivor={handleChooseSurvivor}
            onDismissAnnouncement={handleDismissAnnouncement}
            onRevealDead={handleRevealDead}
            onConfirmDead={handleConfirmDead}
            onBuyStocks={handleBuyStocks}
            mergerChoice={mergerChoice} setMergerChoice={setMergerChoice} onMergerConfirm={handleMergerConfirm}
            onEndGame={handleEndGame}
          />
          <PlayerActionLog game={game} playerActions={playerActions} />
        </div>
      </div>
    </div>
  );
}

// ─── BOARD ────────────────────────────────────────────────────────────────────
function Board({ game, selectedTile, onTileClick, animTile, myPlayerIndex }) {
  // Only reveal hand tiles if it's THIS device's own seat acting right now —
  // never show another human player's hand, even when it's their turn.
  const actingIndex = (game.phase === "merger" && game.mergerInfo?.playerIndex != null)
    ? game.mergerInfo.playerIndex
    : game.currentPlayer;
  const isMySeatActing = actingIndex === myPlayerIndex && game.players[actingIndex]?.type === "human";
  const inHand = isMySeatActing ? (game.hands[myPlayerIndex] || []) : [];
  const [popup, setPopup] = useState(null); // { chain, x, y }

  return (
    <div style={{ position: "relative" }}>
      <div style={styles.boardGrid} onClick={e => { if (e.target === e.currentTarget) setPopup(null); }}>
      {Array.from({ length: ROWS }, (_, r) =>
        Array.from({ length: COLS }, (_, c) => {
          const id = tileId(r, c);
          const chain = game.chainMap[id];
          const placed = game.board[id];
          const inMyHand = inHand.includes(id);
          const isSelected = selectedTile === id;
          const isAnim = animTile === id;

          let bg, border, labelColor, shadow;
          if (chain) {
            bg = CHAIN_COLORS[chain];
            border = `1px solid ${CHAIN_COLORS[chain]}`;
            labelColor = "#000000cc";
            shadow = `0 0 6px ${CHAIN_COLORS[chain]}66`;
          } else if (placed) {
            bg = "#4a4a4a";
            border = "1px solid #666";
            labelColor = "#ffffffaa";
            shadow = "none";
          } else if (isSelected) {
            bg = "#2ecc71";
            border = "2px solid #fff";
            labelColor = "#000";
            shadow = "0 0 10px #2ecc71aa";
          } else if (inMyHand) {
            bg = "#1a3d28";
            border = "1px solid #2ecc71";
            labelColor = "#2ecc71";
            shadow = "none";
          } else {
            bg = "#1e1e2e";
            border = "1px solid #2a2a3a";
            labelColor = "#3a3a5a";
            shadow = "none";
          }

          return (
            <div key={id}
              onClick={() => inMyHand && game.phase === "placeTile" && onTileClick(id)}
              style={{
                ...styles.cell,
                background: bg,
                border,
                cursor: chain ? "pointer" : inMyHand && game.phase === "placeTile" ? "pointer" : "default",
                transform: isAnim ? "scale(1.3)" : "scale(1)",
                transition: "transform 0.3s, background 0.3s",
                boxShadow: shadow,
              }}
              onClick={e => {
                if (chain) { e.stopPropagation(); setPopup(p => p?.chain === chain ? null : { chain }); }
                else if (inMyHand && game.phase === "placeTile") onTileClick(id);
              }}>
              <span style={{ fontSize: 8, color: labelColor, fontWeight: 700, userSelect: "none" }}>
                {tileLabel(id)}
              </span>
            </div>
          );
        })
      )}
      </div>

      {/* Chain popup */}
      {popup && (() => {
        const { chain } = popup;
        const size = game.chainSizes[chain] || 0;
        const price = stockPrice(chain, size);
        const inBank = game.stockBank[chain] ?? 25;
        const sold = 25 - inBank;
        const isSafe = size >= 11;
        return (
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            background: "#0d130d",
            border: `2px solid ${CHAIN_COLORS[chain]}`,
            borderRadius: 8,
            padding: "16px 20px",
            zIndex: 50,
            minWidth: 200,
            boxShadow: `0 8px 32px #000c, 0 0 20px ${CHAIN_COLORS[chain]}44`,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 14, height: 14, borderRadius: 3, background: CHAIN_COLORS[chain] }} />
                <span style={{ fontWeight: 900, fontSize: 16, color: CHAIN_COLORS[chain], letterSpacing: 1 }}>{chain.toUpperCase()}</span>
                {isSafe && <span style={{ fontSize: 9, color: "#2ecc71", border: "1px solid #2ecc71", borderRadius: 3, padding: "1px 4px" }}>SAFE</span>}
              </div>
              <button onClick={() => setPopup(null)} style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #1a2a1a", paddingBottom: 5 }}>
                <span style={{ fontSize: 12, color: "#888" }}>Tiles on board</span>
                <span style={{ fontSize: 13, color: "#fff", fontWeight: 600 }}>{size}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #1a2a1a", paddingBottom: 5 }}>
                <span style={{ fontSize: 12, color: "#888" }}>Share price</span>
                <span style={{ fontSize: 13, color: "#f4c542", fontWeight: 600 }}>{price > 0 ? `$${price.toLocaleString()}` : "—"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #1a2a1a", paddingBottom: 5 }}>
                <span style={{ fontSize: 12, color: "#888" }}>Shares in bank</span>
                <span style={{ fontSize: 13, color: "#ccc", fontWeight: 600 }}>{inBank}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: "#888" }}>Shares outstanding</span>
                <span style={{ fontSize: 13, color: "#ccc", fontWeight: 600 }}>{sold}</span>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── CHAIN LEGEND ─────────────────────────────────────────────────────────────
function ChainLegend({ chainSizes, stockBank }) {
  return (
    <div style={styles.legend}>
      {CHAINS.map(c => {
        const size = chainSizes[c] || 0;
        const price = stockPrice(c, size);
        return (
          <div key={c} style={{ ...styles.legendItem, opacity: size > 0 ? 1 : 0.35 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: CHAIN_COLORS[c], flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "#ccc", minWidth: 80 }}>{c}</span>
            <span style={{ fontSize: 10, color: "#888" }}>{size > 0 ? `${size} tiles` : "—"}</span>
            <span style={{ fontSize: 10, color: "#f4c542", marginLeft: "auto" }}>{price > 0 ? `$${price}` : "—"}</span>
            <span style={{ fontSize: 10, color: "#aaa" }}>🏦{stockBank[c] ?? 25}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── TURN PANEL ───────────────────────────────────────────────────────────────
function TurnPanel({ game, isHuman, myPlayerIndex, aiThinking, selectedTile, onTileClick, onPlaceTile, selectedChain, setSelectedChain, onFoundChain, onChooseSurvivor, onDismissAnnouncement, onRevealDead, onConfirmDead, onBuyStocks, mergerChoice, setMergerChoice, onMergerConfirm, onEndGame }) {
  const cp = game.currentPlayer;
  const cpPlayer = game.players[cp];
  // Only ever read hand/money for OUR OWN seat — never the acting player's seat directly,
  // since in multiplayer the acting player might be a different human on a different device.
  const hand = isHuman ? (game.hands[myPlayerIndex] || []) : [];
  const money = isHuman ? game.money[myPlayerIndex] : (game.money[cp] || 0);

  const [buyCart, setBuyCart] = useState({});
  const buyCartRef = useRef({});
  // Keep ref in sync so click handlers always read the latest cart
  buyCartRef.current = buyCart;

  // Clear cart whenever it's a new buy phase for a (possibly different) player
  const phaseKey = `${game.phase}-${game.currentPlayer}`;
  const prevPhaseKey = useRef(phaseKey);
  if (prevPhaseKey.current !== phaseKey) {
    prevPhaseKey.current = phaseKey;
    // Can't call setState during render in a conditional, so use a ref trick:
    // We'll reset via useEffect below instead
  }
  useEffect(() => { setBuyCart({}); }, [phaseKey]);

  if (game.phase === "gameOver") {
    const { finalMoney, cashAtEnd, chainBreakdown, ranked } = game.gameOverStats;
    const medals = ["🥇","🥈","🥉","4️⃣","5️⃣","6️⃣"];
    return (
      <div style={{ ...styles.panel, overflowY: "auto", maxHeight: "80vh" }}>
        <div style={{ fontSize: 20, fontWeight: 900, color: "#f4c542", marginBottom: 12, textAlign: "center", letterSpacing: 2 }}>
          🏆 FINAL RESULTS
        </div>

        {/* Final standings */}
        <div style={{ marginBottom: 14 }}>
          {ranked.map((r, pos) => (
            <div key={r.i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 8px", marginBottom: 2, background: pos === 0 ? "#1a2a0a" : "#0d130d", border: `1px solid ${pos === 0 ? "#f4c542" : "#1a2a1a"}`, borderRadius: 4 }}>
              <span style={{ fontWeight: 700, color: pos === 0 ? "#f4c542" : "#ccc" }}>{medals[pos]} {r.name}</span>
              <span style={{ color: pos === 0 ? "#f4c542" : "#aaa", fontWeight: 600 }}>${r.total.toLocaleString()}</span>
            </div>
          ))}
        </div>

        {/* Per-chain breakdown */}
        {chainBreakdown.map(({ chain, size, price, holders, bonuses }) => (
          <div key={chain} style={{ marginBottom: 12, border: `1px solid ${CHAIN_COLORS[chain]}44`, borderRadius: 4, overflow: "hidden" }}>
            <div style={{ background: CHAIN_COLORS[chain] + "22", borderBottom: `1px solid ${CHAIN_COLORS[chain]}44`, padding: "5px 10px", display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 700, color: CHAIN_COLORS[chain], fontSize: 12 }}>{chain}</span>
              <span style={{ fontSize: 11, color: "#888" }}>{size} tiles · ${price.toLocaleString()}/share</span>
            </div>
            {holders.length === 0 ? (
              <div style={{ padding: "5px 10px", fontSize: 11, color: "#444" }}>No stockholders</div>
            ) : (
              holders.map((h, idx) => {
                const bonus = bonuses[h.i] || 0;
                const total = h.stockValue + bonus;
                return (
                  <div key={h.i} style={{ display: "flex", alignItems: "center", padding: "4px 10px", borderBottom: "1px solid #0f140f", gap: 6 }}>
                    <span style={{ fontSize: 11, color: "#888", width: 16 }}>{medals[idx]}</span>
                    <span style={{ fontSize: 12, color: "#ccc", flex: 1 }}>{h.name}</span>
                    <span style={{ fontSize: 11, color: "#aaa" }}>{h.shares} shares</span>
                    <span style={{ fontSize: 11, color: "#2ecc71", width: 64, textAlign: "right" }}>
                      ${h.stockValue.toLocaleString()}
                    </span>
                    {bonus > 0 && <span style={{ fontSize: 11, color: "#f4c542", width: 64, textAlign: "right" }}>+${bonus.toLocaleString()}</span>}
                    <span style={{ fontSize: 11, color: "#fff", width: 72, textAlign: "right", fontWeight: 600 }}>${total.toLocaleString()}</span>
                  </div>
                );
              })
            )}
          </div>
        ))}

        <button style={{ ...styles.btnPrimary, width: "100%", marginTop: 4 }} onClick={() => window.location.reload()}>Play Again</button>
      </div>
    );
  }

  const canEnd = (() => {
    const active = CHAINS.filter(c => game.chainSizes[c] >= 1);
    return active.some(c => game.chainSizes[c] >= 41) || active.every(c => game.chainSizes[c] >= 11);
  })();

  return (
    <div style={styles.panel}>
      <div style={styles.playerTag}>
        <span style={{ fontWeight: 700, color: "#f4c542" }}>{cpPlayer?.name}</span>
        {isHuman && <span style={{ color: "#2ecc71", fontWeight: 600 }}>${money.toLocaleString()}</span>}
        {!isHuman && <span style={{ color: "#444", fontSize: 12 }}>opponent</span>}
        {aiThinking && <span style={{ color: "#888", fontSize: 12 }}>thinking…</span>}
      </div>

      {/* Stocks — only visible for human players */}
      {isHuman && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
          {CHAINS.map(c => {
            const n = (game.stocks[myPlayerIndex] && game.stocks[myPlayerIndex][c]) || 0;
            return n > 0 ? (
              <span key={c} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: CHAIN_COLORS[c] + "33", border: `1px solid ${CHAIN_COLORS[c]}88`, color: "#fff" }}>
                {c.slice(0,3)} ×{n}
              </span>
            ) : null;
          })}
        </div>
      )}

      {/* Phases */}
      {game.phase === "placeTile" && isHuman && (
        <div>
          <div style={styles.phaseLabel}>Your Tiles — select one to place</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
            {[...hand].sort((a, b) => {
              const ac = a % COLS, ar = Math.floor(a / COLS);
              const bc = b % COLS, br = Math.floor(b / COLS);
              return ac !== bc ? ac - bc : ar - br;
            }).map(t => {
              const adjChains = [...new Set(adjacentTiles(t).map(a => game.chainMap[a]).filter(Boolean))];
              const safeAdj = adjChains.filter(c => game.chainSizes[c] >= 11);
              const isDead = safeAdj.length >= 2;
              return (
                <button key={t} onClick={() => isDead ? onRevealDead(t) : onTileClick(t)}
                  title={isDead ? "Dead tile — click to reveal and replace" : ""}
                  style={{ ...styles.tileBtn,
                    background: isDead ? "#2a0a0a" : selectedTile === t ? "#2ecc71" : "#1a3a2a",
                    border: isDead ? "1px solid #e74c3c55" : selectedTile === t ? "2px solid #2ecc71" : "1px solid #2ecc71",
                    color: isDead ? "#e74c3c66" : selectedTile === t ? "#000" : "#2ecc71",
                    textDecoration: isDead ? "line-through" : "none",
                  }}>
                  {tileLabel(t)}
                </button>
              );
            })}
          </div>
          {selectedTile !== null && <button style={{ ...styles.btnPrimary, width: "100%" }} onClick={onPlaceTile}>Place {tileLabel(selectedTile)}</button>}
        </div>
      )}

      {game.phase === "foundChain" && isHuman && (
        <div>
          <div style={styles.phaseLabel}>Choose a chain to found</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
            {game.availableChains.map(c => (
              <button key={c} onClick={() => setSelectedChain(c)}
                style={{ ...styles.tileBtn, background: selectedChain === c ? CHAIN_COLORS[c] : CHAIN_COLORS[c] + "22", border: `1px solid ${CHAIN_COLORS[c]}`, color: selectedChain === c ? "#000" : CHAIN_COLORS[c] }}>
                {c}
              </button>
            ))}
          </div>
          {selectedChain && <button style={{ ...styles.btnPrimary, width: "100%" }} onClick={() => onFoundChain(selectedChain)}>Found {selectedChain}</button>}
        </div>
      )}

      {game.phase === "chooseSurvivor" && isHuman && (
        <div>
          <div style={styles.phaseLabel}>⚖️ Tie! Choose which chain survives</div>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>Both chains are the same size — you decide the survivor.</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {(game.tiedChains || []).map(c => (
              <button key={c} onClick={() => onChooseSurvivor(c)}
                style={{ ...styles.tileBtn, background: CHAIN_COLORS[c] + "33", border: `2px solid ${CHAIN_COLORS[c]}`, color: CHAIN_COLORS[c], padding: "6px 12px", fontSize: 12 }}>
                {c} survives
              </button>
            ))}
          </div>
        </div>
      )}

      {game.phase === "mergerAnnounce" && game.mergerAnnouncement && (() => {
        const ann = game.mergerAnnouncement;
        const medals = ["🥇","🥈","🥉","4️⃣","5️⃣","6️⃣"];
        return (
          <div>
            <div style={styles.phaseLabel}>🔀 Merger Announcement</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e74c3c", marginBottom: 6 }}>
              <span style={{ color: CHAIN_COLORS[ann.survivor] }}>{ann.survivor}</span> acquires <span style={{ color: CHAIN_COLORS[ann.defunct] }}>{ann.defunct}</span>
            </div>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
              {ann.defunct}: {ann.size} tiles · stock price ${ann.price.toLocaleString()}
            </div>
            {ann.holders.length === 0 ? (
              <div style={{ fontSize: 11, color: "#555", marginBottom: 8 }}>No stockholders in {ann.defunct}.</div>
            ) : (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Stockholders</div>
                {ann.holders.map((h, idx) => {
                  const bonus = ann.bonuses[h.i] || 0;
                  return (
                    <div key={h.i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", borderBottom: "1px solid #111" }}>
                      <span style={{ fontSize: 12 }}>{medals[idx]} {h.name}</span>
                      <span style={{ fontSize: 11, color: "#ccc" }}>{h.shares} shares</span>
                      {bonus > 0 && <span style={{ fontSize: 11, color: "#f4c542" }}>+${bonus.toLocaleString()}</span>}
                    </div>
                  );
                })}
              </div>
            )}
            {game.currentPlayer === myPlayerIndex ? (
              <button style={{ ...styles.btnPrimary, width: "100%" }} onClick={onDismissAnnouncement}>
                {ann.holders.length > 0 ? "Resolve Stockholders →" : "Continue →"}
              </button>
            ) : (
              <div style={{ color: "#888", fontSize: 12, textAlign: "center", padding: "8px 0" }}>
                Waiting for {game.players[game.currentPlayer]?.name} to continue…
              </div>
            )}
          </div>
        );
      })()}

      {game.phase === "merger" && game.mergerInfo && (() => {
        const mi = game.mergerInfo;
        // Only this device's own seat can see/control the merger resolution sliders
        const isMine = mi.playerIndex != null && mi.playerIndex === myPlayerIndex && game.players[mi.playerIndex]?.type === "human";
        const mergePlayer = game.players[mi.playerIndex];
        const shares = isMine ? (game.stocks[myPlayerIndex]?.[mi.defunct] || 0) : 0;
        const price = stockPrice(mi.defunct, game.chainSizes[mi.defunct]);
        const maxTrade = Math.floor(shares / 2) * 2;
        const survivorAvail = (game.stockBank[mi.survivor] || 0);
        return (
          <div>
            <div style={styles.phaseLabel}>🔀 Merger: {mi.survivor} absorbs {mi.defunct}</div>
            {isMine ? (
              <div>
                <div style={{ color: "#ccc", fontSize: 12, marginBottom: 6 }}>You hold {shares} shares of {mi.defunct} @ ${price}</div>
                <label style={styles.label}>Sell: {mergerChoice.sell || 0}
                  <input type="range" min={0} max={shares - (mergerChoice.trade || 0)} value={mergerChoice.sell || 0}
                    onChange={e => setMergerChoice(m => ({ ...m, sell: +e.target.value }))} style={{ width: "100%", accentColor: "#f4c542" }} />
                </label>
                <label style={styles.label}>Trade (pairs): {mergerChoice.trade || 0} → {Math.floor((mergerChoice.trade || 0) / 2)} {mi.survivor}
                  <input type="range" min={0} max={Math.min(maxTrade, survivorAvail * 2, (shares - (mergerChoice.sell || 0)))} step={2} value={mergerChoice.trade || 0}
                    onChange={e => setMergerChoice(m => ({ ...m, trade: +e.target.value }))} style={{ width: "100%", accentColor: "#2ecc71" }} />
                </label>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>Keep: {shares - (mergerChoice.sell || 0) - (mergerChoice.trade || 0)}</div>
                <button style={{ ...styles.btnPrimary, width: "100%" }} onClick={onMergerConfirm}>Confirm</button>
              </div>
            ) : (
              <div style={{ color: "#888", fontSize: 13 }}>Waiting for {mergePlayer?.name} to resolve merger…</div>
            )}
          </div>
        );
      })()}

      {game.phase === "buyStocks" && isHuman && (() => {
        const cartTotal = Object.values(buyCart).reduce((a, b) => a + b, 0);
        const cartCost = Object.entries(buyCart).reduce((s, [ch, q]) => s + q * stockPrice(ch, game.chainSizes[ch]), 0);
        const active = CHAINS.filter(c => game.chainSizes[c] >= 1);
        const canEnd = active.some(c => game.chainSizes[c] >= 41) || active.filter(c => game.chainSizes[c] >= 11).length >= 3;
        return (
          <div>
            <div style={styles.phaseLabel}>Buy up to 3 stocks (${money.toLocaleString()} available)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {CHAINS.filter(c => game.chainSizes[c] > 0 && (game.stockBank[c] || 0) > 0).map(c => {
                const price = stockPrice(c, game.chainSizes[c]);
                const inCart = buyCart[c] || 0;
                const canAdd = cartTotal < 3 && cartCost + price <= money && (game.stockBank[c] || 0) > inCart;
                return (
                  <div key={c} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: CHAIN_COLORS[c] }} />
                    <span style={{ fontSize: 11, color: "#ccc", width: 80 }}>{c} <span style={{ color: "#f4c542" }}>${price}</span></span>
                    <button
                      onClick={() => setBuyCart(b => { const n = { ...b }; if ((n[c] || 0) > 0) { n[c]--; if (n[c] === 0) delete n[c]; } return n; })}
                      style={{ ...styles.qtyBtn, opacity: inCart === 0 ? 0.3 : 1 }}>−</button>
                    <span style={{ width: 16, textAlign: "center", color: "#fff", fontSize: 12 }}>{inCart}</span>
                    <button
                      onClick={() => { if (canAdd) setBuyCart(b => ({ ...b, [c]: (b[c] || 0) + 1 })); }}
                      style={{ ...styles.qtyBtn, opacity: canAdd ? 1 : 0.3 }}>+</button>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: "#888", margin: "6px 0" }}>
              Cost: <span style={{ color: "#f4c542" }}>${cartCost.toLocaleString()}</span>
              {" · "}After: <span style={{ color: "#2ecc71" }}>${(money - cartCost).toLocaleString()}</span>
            </div>
            <button style={{ ...styles.btnPrimary, width: "100%", marginBottom: 6 }} onClick={() => { const cart = buyCartRef.current; setBuyCart({}); buyCartRef.current = {}; onBuyStocks(cart); }}>
              {cartTotal === 0 ? "End turn (no purchase)" : `Buy ${cartTotal} stock${cartTotal > 1 ? "s" : ""} — $${cartCost.toLocaleString()}`}
            </button>
            <button style={{ ...styles.btnSecondary, width: "100%", opacity: canEnd ? 1 : 0.3, cursor: canEnd ? "pointer" : "not-allowed" }}
              onClick={() => { if (!canEnd) return; const cart = buyCartRef.current; setBuyCart({}); buyCartRef.current = {}; onBuyStocks(cart, true); }}>
              {canEnd ? (cartTotal > 0 ? `Buy & End Game — $${cartCost.toLocaleString()}` : "End Game") : "End Game (not yet eligible)"}
            </button>
          </div>
        );
      })()}

      {game.phase === "revealDead" && isHuman && (
        <div>
          <div style={styles.phaseLabel}>💀 Dead Tile</div>
          <div style={{ fontSize: 12, color: "#ccc", marginBottom: 8 }}>
            <span style={{ color: "#e74c3c", fontWeight: 700 }}>{tileLabel(game.deadTile)}</span> is unplayable — it would merge two safe chains.
          </div>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 10 }}>
            This tile has been revealed for all to see. You'll draw a replacement.
          </div>
          <button style={{ ...styles.btnPrimary, width: "100%" }} onClick={onConfirmDead}>
            Discard & Draw Replacement
          </button>
        </div>
      )}

      {!isHuman && game.phase !== "gameOver" && (() => {
        const actingIdx = (game.phase === "merger" && game.mergerInfo?.playerIndex != null)
          ? game.mergerInfo.playerIndex
          : game.currentPlayer;
        const actingP = game.players[actingIdx];
        const isAi = actingP?.type === "ai";
        return (
          <div style={{ color: "#888", fontSize: 13, textAlign: "center", padding: 12 }}>
            {isAi
              ? (aiThinking ? `🤖 ${actingP.name} is thinking…` : `🤖 ${actingP.name}'s turn…`)
              : `Waiting for ${actingP?.name || "player"}…`}
          </div>
        );
      })()}
    </div>
  );
}

// ─── SCOREBOARD ───────────────────────────────────────────────────────────────
function Scoreboard({ game, onClose, myPlayerIndex }) {
  return (
    <div style={{ ...styles.panel, marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontWeight: 700, color: "#f4c542" }}>Scoreboard</span>
        <button style={{ background: "none", border: "none", color: "#888", cursor: "pointer" }} onClick={onClose}>✕</button>
      </div>
      <div style={{ fontSize: 10, color: "#555", marginBottom: 6 }}>Only your own holdings are visible — others' are private until game end.</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr>
            <th style={styles.th}>Player</th>
            <th style={styles.th}>Cash</th>
            {CHAINS.map(c => <th key={c} style={{ ...styles.th, color: CHAIN_COLORS[c] }}>{c.slice(0,3)}</th>)}
          </tr>
        </thead>
        <tbody>
          {game.players.map((p, i) => {
            const isMe = i === myPlayerIndex;
            return (
              <tr key={i} style={{ background: i === game.currentPlayer ? "#1a2a1a" : "transparent" }}>
                <td style={styles.td}>{p.name}{isMe ? " (you)" : ""}</td>
                <td style={styles.td}>{isMe ? `$${game.money[i].toLocaleString()}` : <span style={{ color: "#333" }}>—</span>}</td>
                {CHAINS.map(c => <td key={c} style={styles.td}>{isMe ? (game.stocks[i][c] || 0) : <span style={{ color: "#333" }}>—</span>}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── PLAYER ACTION LOG ────────────────────────────────────────────────────────
function PlayerActionLog({ game, playerActions }) {
  return (
    <div style={{ margin: 8, marginTop: 4, border: "1px solid #1a2a1a", background: "#080d08" }}>
      <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: 2, padding: "8px 12px 6px", borderBottom: "1px solid #111" }}>Last Actions</div>
      {game.players.map((p, i) => {
        const action = playerActions[i] || {};
        const isCurrent = i === game.currentPlayer;
        return (
          <div key={i} style={{
            padding: "6px 12px",
            borderLeft: isCurrent ? "3px solid #f4c542" : "3px solid transparent",
            background: isCurrent ? "#0d150d" : "transparent",
            borderBottom: "1px solid #0f140f",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: isCurrent ? "#f4c542" : "#555", marginBottom: 4 }}>
              {p.name}
              {p.type === "ai" && <span style={{ fontSize: 9, color: "#383838", marginLeft: 4 }}>{p.difficulty}</span>}
            </div>
            <div style={{ fontSize: 11, color: action.tile ? action.tile.color : "#252525", marginBottom: 2 }}>
              🎯 {action.tile ? action.tile.text : "—"}
            </div>
            <div style={{ fontSize: 11, color: action.stocks ? action.stocks.color : "#252525" }}>
              📈 {action.stocks ? action.stocks.text : "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── SETUP SCREEN ─────────────────────────────────────────────────────────────
// ─── LOBBY SCREEN ─────────────────────────────────────────────────────────────
function LobbyScreen({ onCreate, onJoin, connectionStatus }) {
  const [mode, setMode] = useState(null); // null | "create" | "join"
  const [joinCode, setJoinCode] = useState("");
  const [joinSeats, setJoinSeats] = useState(null); // seats fetched after entering a valid code
  const [joinError, setJoinError] = useState("");

  if (mode === "create") {
    return <SetupScreen onStart={onCreate} onBack={() => setMode(null)} multiplayer />;
  }

  if (mode === "join") {
    return (
      <div style={{ ...styles.root, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={styles.setupCard}>
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: 6, color: "#f4c542", fontFamily: "Georgia, serif" }}>JOIN GAME</div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>Room code</div>
            <input
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ABCDE"
              maxLength={5}
              style={{ ...styles.input, width: "100%", fontSize: 24, textAlign: "center", letterSpacing: 6, padding: "12px 0" }}
            />
          </div>
          {joinError && <div style={{ color: "#e74c3c", fontSize: 12, marginBottom: 10 }}>{joinError}</div>}
          <button
            style={{ ...styles.btnPrimary, width: "100%", marginBottom: 10, opacity: joinCode.length === 5 ? 1 : 0.4 }}
            disabled={joinCode.length !== 5 || connectionStatus === "connecting"}
            onClick={async () => {
              setJoinError("");
              // Fetch the room to show seat picker
              const { data, error } = await supabase.from("games").select("*").eq("room_code", joinCode).single();
              if (error || !data) { setJoinError("Room not found. Check the code and try again."); return; }
              setJoinSeats(data.state.players);
            }}
          >
            {connectionStatus === "connecting" ? "Connecting…" : "Find Room"}
          </button>
          <button style={{ ...styles.btnSecondary, width: "100%" }} onClick={() => { setMode(null); setJoinSeats(null); setJoinError(""); }}>← Back</button>

          {joinSeats && (
            <div style={{ marginTop: 16, borderTop: "1px solid #1a2a1a", paddingTop: 14 }}>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>Which seat are you?</div>
              {joinSeats.map((p, i) => (
                <button key={i}
                  disabled={p.type !== "human"}
                  style={{
                    ...styles.tileBtn, width: "100%", marginBottom: 6, padding: "10px 12px",
                    opacity: p.type === "human" ? 1 : 0.3,
                    background: p.type === "human" ? "#1a3d28" : "#222",
                    border: p.type === "human" ? "1px solid #2ecc71" : "1px solid #333",
                    color: p.type === "human" ? "#2ecc71" : "#666",
                    fontSize: 14, cursor: p.type === "human" ? "pointer" : "not-allowed",
                  }}
                  onClick={() => onJoin(joinCode, i)}
                >
                  {p.name} {p.type === "ai" ? `(AI — ${p.difficulty})` : ""}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...styles.root, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={styles.setupCard}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 48, fontWeight: 900, letterSpacing: 8, color: "#f4c542", fontFamily: "Georgia, serif" }}>ACQUIRE</div>
          <div style={{ color: "#888", fontSize: 13, marginTop: 4 }}>The Classic Hotel Investment Game</div>
        </div>
        <button style={{ ...styles.btnPrimary, width: "100%", fontSize: 16, padding: "14px 0", marginBottom: 10 }} onClick={() => setMode("create")}>
          Create Game
        </button>
        <button style={{ ...styles.btnSecondary, width: "100%", fontSize: 16, padding: "14px 0" }} onClick={() => setMode("join")}>
          Join Game
        </button>
      </div>
    </div>
  );
}
function SetupScreen({ onStart, onBack, multiplayer }) {
  const [players, setPlayers] = useState([
    { name: "You", type: "human", difficulty: null },
    { name: "HAL", type: "ai", difficulty: "hobbyist" },
    { name: "DEEP", type: "ai", difficulty: "pro" },
  ]);

  function addPlayer() {
    if (players.length >= 6) return;
    setPlayers(p => [...p, { name: `Player ${p.length + 1}`, type: "human", difficulty: null }]);
  }

  function removePlayer(i) {
    if (players.length <= 2) return;
    setPlayers(p => p.filter((_, j) => j !== i));
  }

  function updatePlayer(i, fields) {
    setPlayers(pl => pl.map((pp, j) => j === i ? { ...pp, ...fields } : pp));
  }

  const difficultyLabels = { novice: "🟢 Novice", hobbyist: "🟡 Hobbyist", pro: "🔴 Pro" };

  return (
    <div style={{ ...styles.root, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={styles.setupCard}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 48, fontWeight: 900, letterSpacing: 8, color: "#f4c542", fontFamily: "Georgia, serif" }}>ACQUIRE</div>
          <div style={{ color: "#888", fontSize: 13, marginTop: 4 }}>The Classic Hotel Investment Game</div>
        </div>
        {multiplayer && (
          <div style={{ fontSize: 11, color: "#888", marginBottom: 14, lineHeight: 1.5, background: "#0d1a0d", border: "1px solid #1a2a1a", borderRadius: 4, padding: "8px 10px" }}>
            Add a "Human" slot for each person who'll join from their own phone. You'll be seat 1 automatically. Others pick their seat after entering the room code.
          </div>
        )}
        <div style={{ marginBottom: 16 }}>
          {players.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <input value={p.name} onChange={e => updatePlayer(i, { name: e.target.value })}
                style={{ ...styles.input, width: 90 }} placeholder="Name" />
              <select value={p.type} onChange={e => updatePlayer(i, { type: e.target.value, difficulty: e.target.value === "ai" ? "hobbyist" : null })}
                style={styles.select}>
                <option value="human">Human</option>
                <option value="ai">AI</option>
              </select>
              {p.type === "ai" && (
                <select value={p.difficulty || "hobbyist"} onChange={e => updatePlayer(i, { difficulty: e.target.value })}
                  style={{ ...styles.select, borderColor: p.difficulty === "pro" ? "#e74c3c" : p.difficulty === "novice" ? "#2ecc71" : "#f4c542" }}>
                  <option value="novice">🟢 Novice</option>
                  <option value="hobbyist">🟡 Hobbyist</option>
                  <option value="pro">🔴 Pro</option>
                </select>
              )}
              {players.length > 2 && <button style={{ ...styles.btnSecondary, padding: "4px 8px" }} onClick={() => removePlayer(i)}>✕</button>}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "#555", marginBottom: 12, lineHeight: 1.6 }}>
          🟢 Novice — random plays, sells on mergers<br/>
          🟡 Hobbyist — grows chains, spreads holdings<br/>
          🔴 Pro — hunts majorities, trades on mergers
        </div>
        {players.length < 6 && <button style={{ ...styles.btnSecondary, width: "100%", marginBottom: 12 }} onClick={addPlayer}>+ Add Player</button>}
        <button style={{ ...styles.btnPrimary, width: "100%", fontSize: 16, padding: "12px 0", marginBottom: multiplayer ? 10 : 0 }} onClick={() => onStart(players)}>
          {multiplayer ? "Create Room" : "Start Game"}
        </button>
        {multiplayer && onBack && (
          <button style={{ ...styles.btnSecondary, width: "100%" }} onClick={onBack}>← Back</button>
        )}
      </div>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const styles = {
  root: { background: "#12121f", minHeight: "100vh", color: "#fff", fontFamily: "'Courier New', monospace", display: "flex", flexDirection: "column" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid #1a2a1a", background: "#0d130d" },
  logo: { fontSize: 22, fontWeight: 900, letterSpacing: 6, color: "#f4c542", fontFamily: "Georgia, serif" },
  headerRight: { display: "flex", gap: 8 },
  body: { display: "flex", flex: 1, gap: 0, overflow: "hidden" },
  boardWrap: { flex: "0 0 auto", padding: "12px", display: "flex", flexDirection: "column", gap: 8 },
  boardGrid: { display: "grid", gridTemplateColumns: `repeat(${COLS}, 44px)`, gridTemplateRows: `repeat(${ROWS}, 36px)`, gap: 2 },
  cell: { display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 3, transition: "background 0.3s, transform 0.3s" },
  legend: { display: "flex", flexDirection: "column", gap: 3 },
  legendItem: { display: "flex", alignItems: "center", gap: 6, fontSize: 11 },
  sidebar: { flex: 1, display: "flex", flexDirection: "column", gap: 0, borderLeft: "1px solid #1a2a1a", overflowY: "auto", minWidth: 280, maxWidth: 380 },
  panel: { background: "#0d130d", border: "1px solid #1a2a1a", borderRadius: 0, padding: 12, margin: 8, marginBottom: 0 },
  playerTag: { display: "flex", gap: 12, alignItems: "center", marginBottom: 8, borderBottom: "1px solid #1a2a1a", paddingBottom: 6 },
  phaseLabel: { fontSize: 12, color: "#888", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 },
  label: { display: "flex", flexDirection: "column", gap: 2, fontSize: 11, color: "#ccc", marginBottom: 6 },
  tileBtn: { padding: "4px 8px", borderRadius: 4, fontSize: 11, fontFamily: "monospace", cursor: "pointer", transition: "all 0.15s" },
  btnPrimary: { background: "#f4c542", color: "#000", border: "none", borderRadius: 4, padding: "8px 16px", fontWeight: 700, cursor: "pointer", fontFamily: "monospace", fontSize: 13 },
  btnSecondary: { background: "transparent", color: "#888", border: "1px solid #333", borderRadius: 4, padding: "6px 12px", cursor: "pointer", fontFamily: "monospace", fontSize: 12 },
  qtyBtn: { background: "#1a2a1a", color: "#fff", border: "1px solid #333", borderRadius: 3, width: 22, height: 22, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" },
  th: { textAlign: "left", padding: "2px 4px", color: "#888", fontWeight: 600, fontSize: 10, borderBottom: "1px solid #1a2a1a" },
  td: { padding: "2px 4px", fontSize: 11, color: "#ccc" },
  logPanel: { flex: 1, overflowY: "auto", padding: 12, margin: 8, background: "#060a06", border: "1px solid #111", maxHeight: 220 },
  setupCard: { background: "#0d130d", border: "1px solid #1a2a1a", borderRadius: 8, padding: 32, width: "100%", maxWidth: 420 },
  input: { background: "#111", border: "1px solid #333", borderRadius: 4, padding: "6px 10px", color: "#fff", fontFamily: "monospace", flex: 1 },
  select: { background: "#111", border: "1px solid #333", borderRadius: 4, padding: "6px 10px", color: "#fff", fontFamily: "monospace" },
};
