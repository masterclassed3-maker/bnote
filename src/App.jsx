// src/App.jsx
import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import BankNoteABI from "./BankNoteABI.json";

// charts
import {
  ResponsiveContainer,
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend, ReferenceLine,
  AreaChart, Area,
  LineChart, Line,
} from "recharts";

// ---------- Helpers ----------
const DECIMALS = 18;
const ONE_DAY = 86400;

function fmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  const num = typeof n === "string" ? Number(n) : n;
  if (num >= 1e12) return (num / 1e12).toFixed(d) + "T";
  if (num >= 1e9)  return (num / 1e9).toFixed(d)  + "B";
  if (num >= 1e6)  return (num / 1e6).toFixed(d)  + "M";
  if (num >= 1e3)  return (num / 1e3).toFixed(d)  + "k";
  return num.toFixed(d);
}
function pct(n) { return n == null ? "—" : `${Number(n).toFixed(2)}%`; }
function pctColor(n) { return n == null ? "inherit" : Number(n) >= 0 ? "#9EE493" : "#FF8DA1"; }
function fmtUnits(bn) { return ethers.utils.formatUnits(bn || "0", DECIMALS); }

// ---- Chain & Contract config ----
const CONTRACT_ADDRESS = "0x05b78c242619d49792B51F1001F56694BA66d6e9";
const TARGET_CHAIN = {
  chainId: "0x171", // PulseChain
  chainName: "PulseChain",
  rpcUrls: ["https://rpc.pulsechain.com"],
  nativeCurrency: { name: "Pulse", symbol: "PLS", decimals: 18 },
  blockExplorerUrls: ["https://otter.pulsechain.com/"],
};

export default function App() {
  // Wallet / provider
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [addr, setAddr] = useState(null);

  // Contract
  const [contract, setContract] = useState(null);

  // Token basics
  const [symbol, setSymbol] = useState("bNote");
  const [balance, setBalance] = useState("0");
  const [totalSupply, setTotalSupply] = useState("0");
  const [initialSupply, setInitialSupply] = useState("0");

  // Limits (for form validation)
  const [minDays, setMinDays] = useState(1);
  const [maxDays, setMaxDays] = useState(3690);

  // Staking bits
  const [aprBasis, setAprBasis] = useState(0); // 414 => 4.14%
  const aprPercent = useMemo(() => (aprBasis / 100).toFixed(2), [aprBasis]);
  const [shareRate, setShareRate] = useState("1");
  const [totalShares, setTotalShares] = useState("0");
  const [earlyBasis, setEarlyBasis] = useState(25);
  const [lateBasis, setLateBasis] = useState(25);

  // HEX-like multipliers from contract
  const [LPB_PER_YEAR_BPS, setLPB_PER_YEAR_BPS] = useState(0);
  const [LPB_MAX_YEARS, setLPB_MAX_YEARS] = useState(0);
  const [BPB_MAX_BPS, setBPB_MAX_BPS] = useState(0);
  const [BPB_CAP, setBPB_CAP] = useState("0");

  // Your stakes
  const [stakes, setStakes] = useState([]);
  const [walletShares, setWalletShares] = useState("0");
  const [nowTs, setNowTs] = useState(() => Math.floor(Date.now() / 1000));

  // Stake/Unstake forms
  const [stakeAmt, setStakeAmt] = useState("");
  const [stakeDays, setStakeDays] = useState("");
  const [unstakeIdx, setUnstakeIdx] = useState("");

  // Price / analytics
  const [priceUsd, setPriceUsd] = useState(null);
  const [priceNative, setPriceNative] = useState(null);
  const [liquidityUsd, setLiquidityUsd] = useState(null);
  const [fdvUsd, setFdvUsd] = useState(null);
  const [vol24hUsd, setVol24hUsd] = useState(null);
  const [chg1h, setChg1h] = useState(null);
  const [chg24h, setChg24h] = useState(null);
  const [txBuys24, setTxBuys24] = useState(null);
  const [txSells24, setTxSells24] = useState(null);
  const [pairAddress, setPairAddress] = useState(null);

  // local session trend for ratio chart
  const [ratioHistory, setRatioHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("bnote_ratio_hist") || "[]"); } catch { return []; }
  });

  // Connect wallet
  const connect = async () => {
    if (!window.ethereum) {
      alert("No wallet found. Install MetaMask (or a compatible wallet) and try again.");
      return;
    }
    try {
      const curr = await window.ethereum.request({ method: "eth_chainId" });
      if (curr.toLowerCase() !== TARGET_CHAIN.chainId.toLowerCase()) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: TARGET_CHAIN.chainId }],
          });
        } catch (switchErr) {
          if (switchErr.code === 4902) {
            await window.ethereum.request({
              method: "wallet_addEthereumChain",
              params: [TARGET_CHAIN],
            });
          } else {
            throw switchErr;
          }
        }
      }
      const _provider = new ethers.providers.Web3Provider(window.ethereum);
      const _signer = _provider.getSigner();
      const _addr = await _signer.getAddress();

      setProvider(_provider);
      setSigner(_signer);
      setAddr(_addr);

      const c = new ethers.Contract(CONTRACT_ADDRESS, BankNoteABI, _signer);
      setContract(c);
    } catch (e) {
      console.error(e);
      alert("Failed to connect. See console for details.");
    }
  };

  // Basic reads
  const loadBasics = async () => {
    if (!contract) return;
    try {
      const [
        _symbol, ts, is, metrics, tShares, _min, _max, bal, epen, lpen,
        lpbYearBps, lpbMaxY, bpbMaxBps, bpbCap,
      ] = await Promise.all([
        contract.symbol(),
        contract.totalSupply(),
        contract.INITIAL_SUPPLY(),
        contract.metrics(), // (aprBasis, shareRate)
        contract.totalShares(),
        contract.MIN_STAKE_DAYS ? contract.MIN_STAKE_DAYS() : Promise.resolve(minDays),
        contract.MAX_STAKE_DAYS ? contract.MAX_STAKE_DAYS() : Promise.resolve(maxDays),
        addr ? contract.balanceOf(addr) : Promise.resolve("0"),
        contract.EARLY_PENALTY_BASIS ? contract.EARLY_PENALTY_BASIS() : Promise.resolve(earlyBasis),
        contract.LATE_PENALTY_BASIS ? contract.LATE_PENALTY_BASIS() : Promise.resolve(lateBasis),
        contract.LPB_PER_YEAR_BPS ? contract.LPB_PER_YEAR_BPS() : Promise.resolve(0),
        contract.LPB_MAX_YEARS ? contract.LPB_MAX_YEARS() : Promise.resolve(0),
        contract.BPB_MAX_BPS ? contract.BPB_MAX_BPS() : Promise.resolve(0),
        contract.BPB_CAP ? contract.BPB_CAP() : Promise.resolve("0"),
      ]);

      setSymbol(_symbol);
      setTotalSupply(ts.toString());
      setInitialSupply(is.toString());
      setAprBasis(Number(metrics[0].toString()));
      setShareRate(ethers.utils.formatUnits(metrics[1], DECIMALS));
      setTotalShares(tShares.toString());
      setBalance(bal.toString());
      if (_min) setMinDays(Number(_min));
      if (_max) setMaxDays(Number(_max));
      if (epen) setEarlyBasis(Number(epen));
      if (lpen) setLateBasis(Number(lpen));
      setLPB_PER_YEAR_BPS(Number(lpbYearBps || 0));
      setLPB_MAX_YEARS(Number(lpbMaxY || 0));
      setBPB_MAX_BPS(Number(bpbMaxBps || 0));
      setBPB_CAP(bpbCap?.toString?.() || "0");
    } catch (e) {
      console.error("loadBasics error:", e);
    }
  };

  // Your stakes + sum shares
  const loadStakes = async () => {
    if (!contract || !addr) return;
    try {
      const arr = await contract.stakesOf(addr);
      const normalized = arr.map((s, i) => ({
        _idx: i,
        startTimestamp: Number(s.startTimestamp),
        lockDays: Number(s.lockDays),
        amount: s.amount.toString(),
        shares: s.shares.toString(),
        rewardDebt: s.rewardDebt?.toString?.() ?? "0",
        autoRenew: s.autoRenew,
      }));
      setStakes(normalized);

      const sumShares = normalized.reduce(
        (acc, s) => acc.add(ethers.BigNumber.from(s.shares)),
        ethers.BigNumber.from(0)
      );
      setWalletShares(sumShares.toString());
    } catch (e) {
      console.error("loadStakes error:", e);
    }
  };

  // Price fetch (Dexscreener)
  const fetchPrices = async () => {
    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${CONTRACT_ADDRESS}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`dexscreener ${res.status}`);
      const json = await res.json();

      const pairs = (json.pairs || []).filter(p =>
        (p.chainId || p.chain || "").toLowerCase().includes("pulse")
      );
      if (!pairs.length) return;
      pairs.sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0));
      const top = pairs[0];

      setPairAddress(top.pairAddress || null);

      const pUsd = top.priceUsd ? Number(top.priceUsd) : null;
      const pNat = top.priceNative ? Number(top.priceNative) : null;
      setPriceUsd(pUsd);
      setPriceNative(pNat);
      setLiquidityUsd(top.liquidity?.usd ?? null);
      setFdvUsd(top.fdv ?? null);
      setVol24hUsd(top.volume?.h24 ?? null);
      setChg1h(top.priceChange?.h1 ?? null);
      setChg24h(top.priceChange?.h24 ?? null);
      setTxBuys24(top.txns?.h24?.buys ?? null);
      setTxSells24(top.txns?.h24?.sells ?? null);
    } catch (e) {
      console.warn("Price fetch failed:", e);
      setPriceUsd(null);
      setPriceNative(null);
      setVol24hUsd(null);
      setChg1h(null);
      setChg24h(null);
      setTxBuys24(null);
      setTxSells24(null);
    }
  };

  // Timers / refresh
  useEffect(() => {
    const id = setInterval(() => setNowTs(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!contract) return;
    loadBasics();
    fetchPrices();
    loadStakes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract, addr]);

  // session trend: priceNative ratio
  useEffect(() => {
    if (priceNative == null) return;
    const point = { t: Date.now(), v: priceNative };
    const next = [...ratioHistory, point].slice(-200);
    setRatioHistory(next);
    localStorage.setItem("bnote_ratio_hist", JSON.stringify(next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceNative]);

  // ---------- Derived data / Analytics ----------
  const stakedAmount = useMemo(() => {
    const init = Number(fmtUnits(initialSupply || "0"));
    const circ = Number(fmtUnits(totalSupply || "0"));
    return Math.max(0, init - circ);
  }, [initialSupply, totalSupply]);

  const donutData = useMemo(() => {
    const locked = stakedAmount;
    const circulating = Number(fmtUnits(totalSupply || "0"));
    return [
      { name: "Locked", value: locked },
      { name: "Circulating", value: circulating },
    ];
  }, [stakedAmount, totalSupply]);

  // Buckets
  const buckets = useMemo(() => ([
    { label: "1–7", min: 1, max: 7 },
    { label: "8–30", min: 8, max: 30 },
    { label: "31–90", min: 31, max: 90 },
    { label: "91–365", min: 91, max: 365 },
    { label: "366+", min: 366, max: 99999 },
  ]), []);
  const bucketData = useMemo(() => {
    const arr = buckets.map(b => ({ bucket: b.label, amount: 0, count: 0 }));
    for (const s of stakes) {
      const amt = Number(fmtUnits(s.amount));
      const b = buckets.find(b => s.lockDays >= b.min && s.lockDays <= b.max);
      const i = b ? buckets.indexOf(b) : -1;
      if (i >= 0) { arr[i].amount += amt; arr[i].count += 1; }
    }
    return arr;
  }, [stakes, buckets]);

  // Ladder (timeline-like)
  const ladderData = useMemo(() => {
    if (!stakes.length) return [];
    const startDays = stakes.map(s => Math.floor(s.startTimestamp / ONE_DAY));
    const minDay = Math.min(...startDays);
    return stakes.map(s => {
      const startDay = Math.floor(s.startTimestamp / ONE_DAY);
      return { name: `#${s._idx}`, offset: startDay - minDay, duration: s.lockDays };
    });
  }, [stakes]);

  // Unlocks next 90 days
  const unlocksData = useMemo(() => {
    const todayDay = Math.floor(nowTs / ONE_DAY);
    const map = new Map();
    for (const s of stakes) {
      const unlockDay = Math.floor((s.startTimestamp + s.lockDays * ONE_DAY) / ONE_DAY);
      if (unlockDay >= todayDay && unlockDay <= todayDay + 90) {
        const amt = Number(fmtUnits(s.amount));
        map.set(unlockDay, (map.get(unlockDay) || 0) + amt);
      }
    }
    const arr = [];
    for (let d = todayDay; d <= todayDay + 90; d++) {
      arr.push({ d, date: new Date(d * ONE_DAY * 1000).toLocaleDateString(), amount: map.get(d) || 0 });
    }
    return arr;
  }, [stakes, nowTs]);

  // Penalty curve preview
  const [selIdx, setSelIdx] = useState(null);
  const penaltyData = useMemo(() => {
    let L = 30;
    if (selIdx != null && stakes[selIdx]) L = Math.max(1, stakes[selIdx].lockDays);
    const data = [];
    for (let d = -L; d <= L; d++) {
      let p = 0;
      if (d < 0) { p = earlyBasis * ((-d) / L); if (p > earlyBasis) p = earlyBasis; }
      else if (d > 0) { p = lateBasis * (d / L); if (p > lateBasis) p = lateBasis; }
      data.push({ d, penalty: Number(p.toFixed(2)) });
    }
    return data;
  }, [selIdx, stakes, earlyBasis, lateBasis]);

  // Trends (ratio)
  const ratioTrendData = useMemo(
    () => ratioHistory.map(p => ({ time: new Date(p.t).toLocaleTimeString(), ratio: p.v })),
    [ratioHistory]
  );

  // KPIs
  const walletValueUsd = useMemo(
    () => (priceUsd ? Number(fmtUnits(balance)) * priceUsd : null),
    [balance, priceUsd]
  );
  const walletValuePls = useMemo(
    () => (priceNative ? Number(fmtUnits(balance)) * priceNative : null),
    [balance, priceNative]
  );
  const marketCapUsd = useMemo(() => {
    if (!priceUsd) return null;
    const circ = Number(fmtUnits(totalSupply || "0"));
    return circ * priceUsd;
  }, [priceUsd, totalSupply]);
  const stakedPct = useMemo(() => {
    const init = Number(fmtUnits(initialSupply || "0"));
    if (!init) return 0;
    return (stakedAmount / init) * 100;
  }, [stakedAmount, initialSupply]);

  // ---- CSV helpers ----
  const buildCSV = () => {
    const headers = ["index","amount_bNote","locked_days","start_timestamp","start_iso","unlock_timestamp","unlock_iso","status","days_remaining","est_penalty_percent"];
    const rows = stakes.map((s) => {
      const amount = fmtUnits(s.amount);
      const startTs = s.startTimestamp;
      const unlockTs = s.startTimestamp + s.lockDays * ONE_DAY;
      const daysStaked = Math.floor((nowTs - s.startTimestamp) / ONE_DAY);
      const dLeft = s.lockDays - Math.max(0, daysStaked);
      let status = dLeft > 0 ? "early" : dLeft === 0 ? "unlock_today" : "late";
      let estPct = 0;
      if (dLeft > 0) estPct = earlyBasis * (dLeft / s.lockDays);
      else if (dLeft < 0) estPct = Math.min(lateBasis * ((-dLeft) / s.lockDays), lateBasis);
      return [s._idx, amount, s.lockDays, startTs, new Date(startTs * 1000).toISOString(), unlockTs, new Date(unlockTs * 1000).toISOString(), status, dLeft, estPct.toFixed(2)];
    });
    const csv = headers.join(",") + "\n" + rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
    return csv;
  };
  const exportCSV = () => {
    const csv = buildCSV();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "bnote-stakes.csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };
  const copyCSV = async () => {
    try {
      const csv = buildCSV();
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(csv);
      else {
        const ta = document.createElement("textarea");
        ta.value = csv; ta.style.position = "fixed"; ta.style.top = "-9999px";
        document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand("copy"); ta.remove();
      }
      alert("CSV copied to clipboard ✅");
    } catch (e) {
      console.error(e);
      alert("Couldn’t copy CSV to clipboard");
    }
  };

  // ---- Write: Stake & Unstake ----
  const startStake = async () => {
    if (!contract || !signer || !addr) return alert("Connect your wallet first.");
    const amount = Number(stakeAmt);
    const days = Number(stakeDays);
    if (!amount || amount <= 0) return alert("Enter an amount > 0");
    if (!Number.isInteger(days)) return alert("Days must be an integer.");
    if (days < minDays || days > maxDays) return alert(`Days must be between ${minDays} and ${maxDays}.`);
    try {
      const amtWei = ethers.utils.parseUnits(String(amount), DECIMALS);
      const tx = await contract.stakeStart(amtWei, days, false); // autoRenew=false
      await tx.wait();
      setStakeAmt(""); setStakeDays("");
      await loadBasics(); await loadStakes();
      alert("Stake started ✅");
    } catch (e) {
      console.error(e);
      alert(e?.reason || e?.message || "Stake failed");
    }
  };

  const endStake = async (idx) => {
    if (!contract || !signer || !addr) return alert("Connect your wallet first.");
    if (idx === undefined || idx === null || idx === "") return alert("Provide a stake index.");
    const s = stakes.find(x => x._idx === Number(idx));
    let confirmMsg = "End this stake?";
    if (s) {
      const daysStaked = Math.floor((nowTs - s.startTimestamp) / ONE_DAY);
      const dLeft = s.lockDays - Math.max(0, daysStaked);
      if (dLeft > 0) {
        const estEarly = (earlyBasis * (dLeft / s.lockDays)).toFixed(2);
        confirmMsg = `Early by ${dLeft} day(s). Estimated penalty ~${estEarly}% of principal.\n\nProceed?`;
      } else if (dLeft < 0) {
        const lateDays = -dLeft;
        const estLate = Math.min(lateBasis * (lateDays / s.lockDays), lateBasis).toFixed(2);
        confirmMsg = `Late by ${lateDays} day(s). Estimated penalty ~${estLate}% (grows with lateness).\n\nProceed?`;
      } else {
        confirmMsg = "It's the unlock day. No late penalty expected. End stake?";
      }
    }
    if (!window.confirm(confirmMsg)) return;
    try {
      const tx = await contract.stakeEnd(Number(idx));
      await tx.wait();
      await loadBasics(); await loadStakes();
      setUnstakeIdx("");
      alert("Stake ended ✅");
    } catch (e) {
      console.error(e);
      alert(e?.reason || e?.message || "End stake failed");
    }
  };

  // ---------------- UI ----------------
  const connectBtn = (
    <button onClick={connect} style={connectStyle}>
      {addr ? "Reconnect" : "Connect Wallet"}
    </button>
  );

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={logoDot} />
          <div>
            <div style={{ fontWeight: 800, letterSpacing: 0.5 }}>BankNote dApp</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>PulseChain • {symbol}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {/* point to a real static page */}
          <a href="/docs.html" target="_blank" rel="noreferrer" style={docsLink}>Docs</a>
          {connectBtn}
        </div>
      </div>

      {/* KPIs */}
      <div style={kpiGrid}>
        <AnalyticsCard label="Price (USD)" value={priceUsd ? `$${fmt(priceUsd, 6)}` : "—"} sub={liquidityUsd ? `Liquidity $${fmt(liquidityUsd)}` : ""} />
        <AnalyticsCard label="Price (PLS)" value={priceNative ? `${fmt(priceNative, 6)} PLS` : "—"} sub={fdvUsd ? `FDV $${fmt(fdvUsd)}` : ""} />
        <AnalyticsCard label="Wallet Value" value={walletValueUsd !== null ? `$${fmt(walletValueUsd)}` : "—"} sub={walletValuePls !== null ? `${fmt(walletValuePls)} PLS` : ""} />
        <AnalyticsCard label="Market Cap (est.)" value={marketCapUsd !== null ? `$${fmt(marketCapUsd)}` : "—"} sub={`Circ: ${fmt(Number(fmtUnits(totalSupply || "0")))} ${symbol}`} />
        <AnalyticsCard label="Staked (burned)" value={`${fmt(stakedAmount)} ${symbol}`} sub={`${stakedPct.toFixed(2)}% of initial`} />
        <AnalyticsCard label="APR" value={`${aprPercent}%`} sub={`Share Rate: ${Number(shareRate).toFixed(4)}`} />
      </div>

      {/* Wallet Panel */}
      <div style={sectionStyle}>
        <div style={sectionHead}>Wallet</div>
        <Row label="Account" value={<span style={mono}>{addr ?? "—"}</span>} />
        <Row label="Balance" value={<span style={mono}>{fmt(Number(fmtUnits(balance || "0")))} {symbol}</span>} />
        <Row label="Total Shares (Wallet)" value={<span style={mono}>{fmt(Number(fmtUnits(walletShares || "0")))}</span>} />
        <Row label="Total Shares (Contract)" value={<span style={mono}>{fmt(Number(fmtUnits(totalShares || "0")))}</span>} />
      </div>

      {/* Stake / Unstake */}
      <div id="actions" style={sectionStyle}>
        <div style={sectionHead}>Actions</div>

        <div style={{ ...cardStyle, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Start a Stake</div>
          <div style={formGrid}>
            <LabeledInput
              label={`Amount (${symbol})`}
              value={stakeAmt}
              setValue={setStakeAmt}
              placeholder="e.g. 1000"
              type="number"
              step="any"
              min="0"
            />
            <LabeledInput
              label={`Days locked (min ${minDays}, max ${maxDays})`}
              value={stakeDays}
              setValue={setStakeDays}
              placeholder={`${minDays}`}
              type="number"
              min={minDays}
              max={maxDays}
              step="1"
            />
          </div>
          <Estimates
            stakeAmt={stakeAmt}
            stakeDays={stakeDays}
            aprPercent={aprPercent}
            estLPBBps={LPB_PER_YEAR_BPS && LPB_MAX_YEARS ? (Math.min(Math.floor((Number(stakeDays||0)/365)), LPB_MAX_YEARS) * LPB_PER_YEAR_BPS) : 0}
            estBPBBps={(() => {
              const amt = Number(stakeAmt||0);
              const cap = Number(fmtUnits(BPB_CAP||"0")) || 0;
              if (!amt || !cap) return 0;
              return Math.min(amt / cap, 1) * (BPB_MAX_BPS || 0);
            })()}
            estTotalBonusBps={0}
            earlyBasis={earlyBasis}
            lateBasis={lateBasis}
          />
          <div style={{ marginTop: 12 }}>
            <button onClick={startStake} style={primaryBtn}>Stake</button>
          </div>
        </div>

        <div style={{ ...cardStyle }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>End a Stake</div>
          <div style={formGrid}>
            <LabeledInput
              label="End by index…"
              value={unstakeIdx}
              setValue={setUnstakeIdx}
              placeholder="e.g. 0"
              type="number"
              min="0"
              step="1"
            />
          </div>
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
            Tip: You can also end directly from the table below.
          </div>
          <div style={{ marginTop: 12 }}>
            <button onClick={() => endStake(Number(unstakeIdx))} style={dangerBtn}>End Stake</button>
          </div>
        </div>
      </div>

      {/* Stakes Panel */}
      <div style={sectionStyle}>
        <div style={sectionHead}>
          Your Stakes
          <div>
            <button onClick={exportCSV} style={smallBtn}>Export CSV</button>
            <button onClick={copyCSV} style={smallBtn}>Copy CSV</button>
            <button onClick={() => { loadStakes(); loadBasics(); fetchPrices(); }} style={smallBtn}>Refresh</button>
          </div>
        </div>

        {stakes.length === 0 ? (
          <div style={{ opacity: 0.8, textAlign: "center" }}>No stakes yet.</div>
        ) : (
          <div style={stakesWrap}>
            <div style={stakesInner}>
              <table style={stakesTable}>
                <thead>
                  <tr>
                    <th style={thCellNarrow}>#</th>
                    <th style={thCell}>Amount</th>
                    <th style={thCell}>Shares</th>
                    <th style={thCell}>Lock (days)</th>
                    <th style={thCell}>Start</th>
                    <th style={thCell}>Unlock</th>
                    <th style={thCell}>Status</th>
                    <th style={thCell}>Days Left</th>
                    <th style={thCell}> </th>
                  </tr>
                </thead>
                <tbody>
                  {stakes.map((s) => {
                    const amount = Number(fmtUnits(s.amount));
                    const sharesHuman = Number(fmtUnits(s.shares));
                    const start = new Date(s.startTimestamp * 1000);
                    const unlockTs = s.startTimestamp + s.lockDays * ONE_DAY;
                    const unlock = new Date(unlockTs * 1000);
                    const daysStaked = Math.floor((nowTs - s.startTimestamp) / ONE_DAY);
                    const dLeft = s.lockDays - Math.max(0, daysStaked);
                    const status = dLeft > 0 ? "Early" : dLeft === 0 ? "Unlock today" : "Late";
                    return (
                      <tr key={s._idx}>
                        <td style={tdCellNarrow}>{s._idx}</td>
                        <td style={tdCell} title={String(amount)}>{fmt(amount)}</td>
                        <td style={tdCell} title={String(sharesHuman)}>
                          <span style={ellipsisCell}>{fmt(sharesHuman)}</span>
                        </td>
                        <td style={tdCell}>{s.lockDays}</td>
                        <td style={tdCell} title={start.toISOString()}>{start.toLocaleDateString()}</td>
                        <td style={tdCell} title={unlock.toISOString()}>{unlock.toLocaleDateString()}</td>
                        <td style={tdCell}>{status}</td>
                        <td style={tdCell}>{dLeft}</td>
                        <td style={tdCell}>
                          <button onClick={() => endStake(s._idx)} style={tinyDanger}>End</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85, textAlign:"center" }}>
          <strong>Penalty rules:</strong> Early = before the full lock period elapses (penalty scales up to {earlyBasis}% at start).
          Late = any time after the unlock day; penalty grows the longer you wait (up to {lateBasis}%).
          Ending on the unlock day has no late penalty.
          <br />
          <em>Note:</em> “Days left” and estimates shown here are client-side guidance only; on-chain results depend on exact block timestamps.
        </div>
      </div>

      {/* ----------- Analytics Section ----------- */}
      <div style={sectionStyle}>
        <div style={sectionHead}>Analytics</div>

        {/* Row A: Price widget + Donut */}
        <div style={analyticsGrid}>
          <div style={chartCard}>
            <div style={chartTitle}>Price Chart (Dexscreener)</div>
            {pairAddress ? (
              <iframe
                src={`https://dexscreener.com/pulsechain/${pairAddress}?embed=1&theme=dark`}
                style={{ width: "100%", height: "100%", border: 0, borderRadius: 12 }}
                allow="clipboard-write; clipboard-read"
                title="price"
              />
            ) : (
              <div style={{ opacity: 0.7 }}>No pair data yet.</div>
            )}
          </div>

          <div style={chartCard}>
            <div style={chartTitle}>Locked vs Circulating</div>
            <ResponsiveContainer width="100%" height="85%">
              <PieChart>
                <Pie data={donutData} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%">
                  <Cell fill="#7ee0ff" />
                  <Cell fill="#8c7eff" />
                </Pie>
                <RTooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Row B: Ladder + Buckets */}
        <div style={analyticsGrid}>
          <div style={chartCard}>
            <div style={chartTitle}>Staking Ladder (timeline)</div>
            <ResponsiveContainer width="100%" height="85%">
              <BarChart data={ladderData} stackOffset="expand" margin={{ left: 20, right: 20, top: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="name" />
                <YAxis hide />
                <RTooltip />
                <Legend />
                <Bar dataKey="offset" stackId="a" fill="rgba(0,0,0,0)" />
                <Bar dataKey="duration" stackId="a" fill="#7ee0ff" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={chartCard}>
            <div style={chartTitle}>Maturity Buckets (amount)</div>
            <ResponsiveContainer width="100%" height="85%">
              <BarChart data={bucketData} margin={{ left: 20, right: 20, top: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="bucket" />
                <YAxis />
                <RTooltip />
                <Bar dataKey="amount" fill="#8c7eff" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Row C: Unlocks + Penalty curve */}
        <div style={analyticsGrid}>
          <div style={chartCard}>
            <div style={chartTitle}>Unlocks (next 90 days)</div>
            <ResponsiveContainer width="100%" height="85%">
              <AreaChart data={unlocksData} margin={{ left: 20, right: 20, top: 10, bottom: 20 }}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7ee0ff" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#7ee0ff" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis />
                <RTooltip />
                <Area type="monotone" dataKey="amount" stroke="#7ee0ff" fill="url(#g1)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div style={chartCard}>
            <div style={chartTitle}>
              Penalty Curve Preview{" "}
              <span style={{ fontWeight: 400, opacity: 0.8 }}>
                (select stake index:&nbsp;
                <select
                  value={selIdx ?? ""}
                  onChange={(e) => setSelIdx(e.target.value === "" ? null : Number(e.target.value))}
                  style={{ background: "rgba(10,14,26,0.9)", color: "#E8F1FF", border: "1px solid rgba(132,234,255,0.25)", borderRadius: 8 }}
                >
                  <option value="">(none)</option>
                  {stakes.map(s => <option key={s._idx} value={s._idx}>#{s._idx} ({s.lockDays}d)</option>)}
                </select>
                )
              </span>
            </div>
            <ResponsiveContainer width="100%" height="80%">
              <LineChart data={penaltyData} margin={{ left: 20, right: 20, top: 10, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="d" tickFormatter={(t) => `${t}`} />
                <YAxis tickFormatter={(v) => `${v}%`} />
                <RTooltip formatter={(v) => [`${v}%`, "Penalty"]} />
                <ReferenceLine x={0} stroke="#aaa" />
                <Line type="monotone" dataKey="penalty" stroke="#ff8da1" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Row D: ratio trend */}
        <div style={analyticsGrid}>
          <div style={chartCard}>
            <div style={chartTitle}>bNote / PLS ratio (session)</div>
            <ResponsiveContainer width="100%" height="85%">
              <LineChart data={ratioTrendData} margin={{ left: 20, right: 20, top: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="time" />
                <YAxis />
                <RTooltip />
                <Line type="monotone" dataKey="ratio" stroke="#8c7eff" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div style={{ opacity: 0.6, fontSize: 12, margin: "30px 0" }}>
        Prices & volumes from Dexscreener (top-liquidity pair on PulseChain). Market cap is an estimate.
        &nbsp;bNote contract: {CONTRACT_ADDRESS}.
      </div>
    </div>
  );
}

/* ---------- Small components ---------- */
function AnalyticsCard({ label, value, sub, valueColor }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 12, opacity: 0.8 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6, color: valueColor || "inherit" }}>
        {value}
      </div>
      {sub ? <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{sub}</div> : null}
    </div>
  );
}
function Row({ label, value }) {
  return (
    <div style={rowStyle}>
      <div>{label}</div>
      <div>{value}</div>
    </div>
  );
}
function LabeledInput({ label, value, setValue, placeholder, type = "text", step, min, max }) {
  return (
    <div>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{label}</div>
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={placeholder}
        style={input}
        type={type}
        step={step}
        min={min}
        max={max}
        inputMode={type === "number" ? "numeric" : "decimal"}
      />
    </div>
  );
}
function Estimates({
  stakeAmt, stakeDays, aprPercent,
  estLPBBps, estBPBBps, estTotalBonusBps,
  earlyBasis, lateBasis
}) {
  const amt = Number(stakeAmt || 0);
  const days = Number(stakeDays || 0);
  const apr = Number(aprPercent || 0);
  const baseYieldPct = days > 0 ? (apr * (days / 365)) : 0;
  const lpbPct = (estLPBBps || 0) / 100;
  const bpbPct = (estBPBBps || 0) / 100;

  const rows = [
    ["Amount", amt ? fmt(amt) + " bNote" : "—"],
    ["Days", days || "—"],
    ["Base APR", `${fmt(apr, 2)}%`],
    ["Base yield (period)", `${fmt(baseYieldPct, 2)}%`],
    ["LPB bonus", `${fmt(lpbPct, 2)}%`],
    ["BPB bonus", `${fmt(bpbPct, 2)}%`],
    ["Total bonus (est.)", `${fmt((lpbPct + bpbPct), 2)}%`],
    ["Early penalty max", `${earlyBasis}%`],
    ["Late penalty max", `${lateBasis}%`],
  ];

  return (
    <div style={{ ...cardStyle, marginTop: 10 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Estimates (guidance)</div>
      <div style={estGrid}>
        {rows.map(([k, v]) => (
          <div key={k} style={estRow}>
            <div style={{ opacity: 0.85 }}>{k}</div>
            <div style={{ textAlign: "right", fontFamily: mono.fontFamily }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
        These are client-side estimates for convenience. Actual on-chain results may vary.
      </div>
    </div>
  );
}

/* ---------------- Styles ---------------- */
const pageStyle = {
  minHeight: "100vh",
  background:
    "radial-gradient(1200px 600px at 20% -10%, rgba(132,234,255,0.15), transparent), radial-gradient(1200px 600px at 80% 110%, rgba(255,132,234,0.12), transparent), #0a0e1a",
  color: "#E8F1FF",
  fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  padding: 20,
};
const headerStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 18,
};
const logoDot = {
  width: 14,
  height: 14,
  borderRadius: 999,
  background: "linear-gradient(135deg, #88f, #8ff)",
  boxShadow: "0 0 18px rgba(136,136,255,0.6)",
};
const docsLink = {
  color: "#9fdcff",
  textDecoration: "none",
  padding: "8px 10px",
  border: "1px solid rgba(132,234,255,0.25)",
  borderRadius: 10,
  fontSize: 13,
};
const connectStyle = {
  background: "linear-gradient(135deg, rgba(136,136,255,0.25), rgba(136,255,255,0.25))",
  border: "1px solid rgba(136,200,255,0.35)",
  padding: "10px 14px",
  borderRadius: 12,
  color: "#E8F1FF",
  cursor: "pointer",
};
const kpiGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
  margin: "10px 0 20px",
};
const cardStyle = {
  background: "rgba(20,28,48,0.85)",
  border: "1px solid rgba(132,234,255,0.15)",
  borderRadius: 16,
  padding: 14,
  boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
};
const sectionStyle = {
  background: "rgba(12,16,30,0.85)",
  border: "1px solid rgba(132,234,255,0.12)",
  borderRadius: 16,
  padding: 16,
  marginTop: 14,
  boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
};
const sectionHead = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  fontWeight: 700,
  marginBottom: 10,
  gap: 10,
};
const rowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 0",
  borderBottom: "1px dashed rgba(132,234,255,0.15)",
};
const mono = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};
const smallBtn = {
  marginLeft: 8,
  background: "rgba(132,234,255,0.12)",
  color: "#8ff",
  border: "1px solid rgba(132,234,255,0.3)",
  borderRadius: 10,
  padding: "6px 10px",
  cursor: "pointer",
};
const input = {
  width: "100%",
  background: "rgba(10,14,26,0.9)",
  color: "#E8F1FF",
  border: "1px solid rgba(132,234,255,0.25)",
  borderRadius: 10,
  padding: "10px 12px",
  outline: "none",
};
const formGrid = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
};
const primaryBtn = {
  background: "linear-gradient(135deg, #5fa8ff55, #5fffe255)",
  border: "1px solid rgba(132,234,255,0.4)",
  padding: "10px 14px",
  borderRadius: 12,
  color: "#E8F1FF",
  cursor: "pointer",
  fontWeight: 700,
};
const dangerBtn = {
  background: "linear-gradient(135deg, #ff5f7a55, #ffcf5f55)",
  border: "1px solid rgba(255,120,150,0.4)",
  padding: "10px 14px",
  borderRadius: 12,
  color: "#FFEFF1",
  cursor: "pointer",
  fontWeight: 700,
};
const tinyDanger = {
  background: "rgba(255,120,150,0.15)",
  border: "1px solid rgba(255,120,150,0.4)",
  padding: "6px 10px",
  borderRadius: 10,
  color: "#FFEFF1",
  cursor: "pointer",
  fontSize: 12,
};

// Stakes table centering + ellipsis for huge numbers
const stakesWrap = { display: "flex", justifyContent: "center", width: "100%", overflowX: "auto" };
const stakesInner = { width: "100%", maxWidth: 1040 };
const stakesTable = { width: "100%", borderCollapse: "collapse", tableLayout: "fixed", margin: "0 auto", textAlign: "center" };
const thCell = { padding: "10px 8px", borderBottom: "1px solid rgba(132,234,255,0.18)", fontWeight: 700, whiteSpace: "nowrap" };
const thCellNarrow = { ...thCell, width: 56 };
const tdCell = { padding: "10px 8px", borderBottom: "1px dashed rgba(132,234,255,0.12)", verticalAlign: "middle", whiteSpace: "nowrap" };
const tdCellNarrow = { ...tdCell, width: 56 };
const ellipsisCell = { display: "inline-block", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", verticalAlign: "middle" };

// Analytics layout
const analyticsGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, marginTop: 10 };
const chartCard = { ...cardStyle, height: 360, display: "flex", flexDirection: "column" };
const chartTitle = { fontWeight: 700, marginBottom: 8 };
const estGrid = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 };
const estRow = { display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px dashed rgba(132,234,255,0.12)", paddingBottom: 6 };
