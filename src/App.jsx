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

/* ---------------- Chain & Contract ---------------- */
const CONTRACT_ADDRESS = "0x473EB99177965277275B3e83bCE3d4884473878D"; // deployed BankNote
const TARGET_CHAIN = {
  chainId: "0x171", // PulseChain
  chainName: "PulseChain",
  rpcUrls: ["https://rpc.pulsechain.com"],
  nativeCurrency: { name: "Pulse", symbol: "PLS", decimals: 18 },
  blockExplorerUrls: ["https://otter.pulsechain.com/"],
};

const DECIMALS = 18;
const ONE_DAY = 86400;

/* ---------------- Component ---------------- */
export default function App() {
  /* Wallet / provider */
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [addr, setAddr] = useState(null);

  /* Contract */
  const [contract, setContract] = useState(null);

  /* Token basics */
  const [symbol, setSymbol] = useState("bNote");
  const [balance, setBalance] = useState("0");
  const [totalSupply, setTotalSupply] = useState("0");
  const [initialSupply, setInitialSupply] = useState("0");

  /* Limits (for form validation) */
  const [minDays, setMinDays] = useState(1);
  const [maxDays, setMaxDays] = useState(3690);

  /* Staking params */
  const [aprBasis, setAprBasis] = useState(369); // 3.69% default
  const aprPercent = useMemo(() => (aprBasis / 100).toFixed(2), [aprBasis]);
  const [shareRate, setShareRate] = useState("1");
  const [totalShares, setTotalShares] = useState("0");
  const [earlyBasis, setEarlyBasis] = useState(25);
  const [lateBasis, setLateBasis] = useState(25);

  // HEX-like bonus params (if available from contract)
  const [lpbPerYearBps, setLpbPerYearBps] = useState(2000);
  const [lpbMaxYears, setLpbMaxYears] = useState(10);
  const [bpbMaxBps, setBpbMaxBps] = useState(1000);
  const [bpbCap, setBpbCap] = useState(210_000 * 10 ** DECIMALS);

  /* Your stakes */
  const [stakes, setStakes] = useState([]);
  const [walletShares, setWalletShares] = useState("0");
  const [nowTs, setNowTs] = useState(() => Math.floor(Date.now() / 1000));

  /* Stake/Unstake forms */
  const [stakeAmt, setStakeAmt] = useState("");
  const [stakeDays, setStakeDays] = useState("");
  const [unstakeIdx, setUnstakeIdx] = useState("");

  /* Price / analytics */
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

  /* local session trends */
  const [sharesHistory, setSharesHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("bnote_shares_hist") || "[]"); } catch { return []; }
  });
  const [ratioHistory, setRatioHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("bnote_ratio_hist") || "[]"); } catch { return []; }
  });

  /* Docs overlay */
  const [docsOpen, setDocsOpen] = useState(false);

  /* viewport (for responsive tweaks) */
  const [vw, setVw] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1200
  );
  useEffect(() => {
    const onR = () => setVw(window.innerWidth);
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);
  const isNarrow = vw < 520;

  /* Derived: wallet values & supply */
  const walletValueUsd = useMemo(
    () => (priceUsd ? Number(ethers.utils.formatUnits(balance, DECIMALS)) * priceUsd : null),
    [balance, priceUsd]
  );
  const walletValuePls = useMemo(
    () => (priceNative ? Number(ethers.utils.formatUnits(balance, DECIMALS)) * priceNative : null),
    [balance, priceNative]
  );

  const marketCapUsd = useMemo(() => {
    if (!priceUsd) return null;
    const circ = Number(ethers.utils.formatUnits(totalSupply || "0", DECIMALS));
    return circ * priceUsd;
  }, [priceUsd, totalSupply]);

  const stakedAmount = useMemo(() => {
    const init = Number(ethers.utils.formatUnits(initialSupply || "0", DECIMALS));
    const circ = Number(ethers.utils.formatUnits(totalSupply || "0", DECIMALS));
    return Math.max(0, init - circ);
  }, [initialSupply, totalSupply]);
  const stakedPct = useMemo(() => {
    const init = Number(ethers.utils.formatUnits(initialSupply || "0", DECIMALS));
    if (!init) return 0;
    return (stakedAmount / init) * 100;
  }, [stakedAmount, initialSupply]);

  /* ------ Connect wallet ------ */
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

  /* ------ Reads ------ */
  const loadBasics = async () => {
    if (!contract) return;
    try {
      const [
        _symbol,
        ts,
        is,
        metrics,
        tShares,
        _min,
        _max,
        bal,
        epen,
        lpen,
        _lpbYear,
        _lpbMax,
        _bpbMax,
        _bpbCap,
      ] = await Promise.all([
        contract.symbol(),
        contract.totalSupply(),
        contract.INITIAL_SUPPLY(),
        contract.metrics(), // (_aprBasis, _shareRate)
        contract.totalShares(),
        contract.MIN_STAKE_DAYS ? contract.MIN_STAKE_DAYS() : Promise.resolve(minDays),
        contract.MAX_STAKE_DAYS ? contract.MAX_STAKE_DAYS() : Promise.resolve(maxDays),
        addr ? contract.balanceOf(addr) : Promise.resolve("0"),
        contract.EARLY_PENALTY_BASIS ? contract.EARLY_PENALTY_BASIS() : Promise.resolve(earlyBasis * 100),
        contract.LATE_PENALTY_BASIS ? contract.LATE_PENALTY_BASIS() : Promise.resolve(lateBasis * 100),
        contract.LPB_PER_YEAR_BPS ? contract.LPB_PER_YEAR_BPS() : Promise.resolve(2000),
        contract.LPB_MAX_YEARS ? contract.LPB_MAX_YEARS() : Promise.resolve(10),
        contract.BPB_MAX_BPS ? contract.BPB_MAX_BPS() : Promise.resolve(1000),
        contract.BPB_CAP ? contract.BPB_CAP() : Promise.resolve(ethers.BigNumber.from(bpbCap.toString())),
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
      if (epen) setEarlyBasis(Number(epen) / 100);
      if (lpen) setLateBasis(Number(lpen) / 100);

      setLpbPerYearBps(Number(_lpbYear));
      setLpbMaxYears(Number(_lpbMax));
      setBpbMaxBps(Number(_bpbMax));
      setBpbCap(Number(ethers.utils.formatUnits(_bpbCap, DECIMALS)));
    } catch (e) {
      console.error("loadBasics error:", e);
    }
  };

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

  /* ------ Dexscreener prices ------ */
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

  /* ------ Timers & initial loads ------ */
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

  /* ------ Session trends ------ */
  useEffect(() => {
    if (!totalShares) return;
    const point = {
      t: Date.now(),
      v: Number(ethers.utils.formatUnits(totalShares || "0", DECIMALS)),
    };
    const next = [...sharesHistory, point].slice(-200);
    setSharesHistory(next);
    localStorage.setItem("bnote_shares_hist", JSON.stringify(next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalShares]);

  useEffect(() => {
    if (priceNative == null) return;
    const point = { t: Date.now(), v: priceNative };
    const next = [...ratioHistory, point].slice(-200);
    setRatioHistory(next);
    localStorage.setItem("bnote_ratio_hist", JSON.stringify(next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceNative]);

  /* ------ Helpers ------ */
  const fmt = (n, d = 2) => {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    const num = typeof n === "string" ? Number(n) : n;
    if (num >= 1e12) return (num / 1e12).toFixed(d) + "T";
    if (num >= 1e9) return (num / 1e9).toFixed(d) + "B";
    if (num >= 1e6) return (num / 1e6).toFixed(d) + "M";
    if (num >= 1e3) return (num / 1e3).toFixed(d) + "k";
    return num.toFixed(d);
  };
  const pct = (n) => (n === null || n === undefined ? "—" : `${Number(n).toFixed(2)}%`);
  const pctColor = (n) =>
    n === null || n === undefined ? "inherit" : Number(n) >= 0 ? "#9EE493" : "#FF8DA1";
  const fmtUnits = (bn) => ethers.utils.formatUnits(bn || "0", DECIMALS);

  // big-number safe compact string for shares
  function compactDecimalStr(decStr) {
    if (decStr == null) return "—";
    const s = String(decStr);
    const [rawInt, rawFrac = ""] = s.split(".");
    const neg = rawInt.startsWith("-");
    const int = (neg ? rawInt.slice(1) : rawInt).replace(/^0+/, "") || "0";
    const len = int.length;

    const pick = (pow, suf) => {
      const cut = len - pow;
      const whole = int.slice(0, cut);
      const frac = int.slice(cut, cut + 2);
      return (neg ? "-" : "") + whole + (frac ? "." + frac : "") + suf;
    };

    if (len > 12) return pick(12, "T");
    if (len > 9)  return pick(9,  "B");
    if (len > 6)  return pick(6,  "M");
    if (len > 3)  return pick(3,  "k");
    return (neg ? "-" : "") + int + (rawFrac ? "." + rawFrac.slice(0, 2) : "");
  }

  /* ------ CSV ------ */
  const buildCSV = () => {
    const headers = [
      "index","amount_bNote","locked_days","start_timestamp","start_iso",
      "unlock_timestamp","unlock_iso","status","days_remaining","est_penalty_percent",
    ];
    const rows = stakes.map((s) => {
      const amount = ethers.utils.formatUnits(s.amount, DECIMALS);
      const startTs = s.startTimestamp;
      const unlockTs = s.startTimestamp + s.lockDays * ONE_DAY;
      const daysStaked = Math.floor((nowTs - s.startTimestamp) / ONE_DAY);
      const dLeft = s.lockDays - Math.max(0, daysStaked);
      let status = "ready";
      if (dLeft > 0) status = "early";
      else if (dLeft === 0) status = "unlock_today";
      else status = "late";
      let estPct = 0;
      if (dLeft > 0) estPct = earlyBasis * (dLeft / s.lockDays);
      else if (dLeft < 0) estPct = Math.min(lateBasis * ((-dLeft) / s.lockDays), lateBasis);
      return [
        s._idx,
        amount,
        s.lockDays,
        startTs,
        new Date(startTs * 1000).toISOString(),
        unlockTs,
        new Date(unlockTs * 1000).toISOString(),
        status,
        dLeft,
        estPct.toFixed(2),
      ];
    });

    const csv =
      headers.join(",") + "\n" +
      rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
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
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(csv);
      } else {
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

  /* ------ Estimates (LPB/BPB + APR) ------ */
  const est = useMemo(() => {
    const amt = Number(stakeAmt || 0);
    const days = Number(stakeDays || 0);
    if (!amt || !days || !shareRate) return null;

    // Bonuses
    const years = Math.min(days / 365, lpbMaxYears);
    const lpbBps = Math.floor(years * lpbPerYearBps);
    const bpbScale = bpbCap > 0 ? Math.min(amt / bpbCap, 1) : 0;
    const bpbBps = Math.floor(bpbMaxBps * bpbScale);
    const bonusFactor = 1 + (lpbBps + bpbBps) / 10000;

    // Shares estimate (front-end approximation)
    const sr = Number(shareRate || 1);
    const estShares = (amt * bonusFactor) / (sr || 1);

    // Yield (simple APR * prorata days)
    const apr = aprBasis / 10000;
    const estYield = amt * apr * (days / 365);

    const unlockTs = Math.floor(Date.now() / 1000) + days * ONE_DAY;
    return {
      lpbBps, bpbBps, bonusFactor,
      estShares,
      estYield,
      unlockTs,
    };
  }, [stakeAmt, stakeDays, shareRate, aprBasis, lpbMaxYears, lpbPerYearBps, bpbCap, bpbMaxBps]);

  /* ------ Writes ------ */
  const startStake = async () => {
    if (!contract || !signer || !addr) return alert("Connect your wallet first.");
    const amount = Number(stakeAmt);
    const days = Number(stakeDays);

    if (!amount || amount <= 0) return alert("Enter an amount > 0");
    if (!Number.isInteger(days)) return alert("Days must be an integer.");
    if (days < minDays || days > maxDays) {
      return alert(`Days must be between ${minDays} and ${maxDays}.`);
    }

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

  /* ---------- Analytics derived ---------- */
  const donutData = useMemo(() => {
    const locked = stakedAmount;
    const circulating = Number(ethers.utils.formatUnits(totalSupply || "0", DECIMALS));
    return [
      { name: "Locked", value: locked },
      { name: "Circulating", value: circulating },
    ];
  }, [stakedAmount, totalSupply]);

  const ladderData = useMemo(() => {
    if (!stakes.length) return [];
    const startDays = stakes.map(s => Math.floor(s.startTimestamp / ONE_DAY));
    const minDay = Math.min(...startDays);
    return stakes.map(s => {
      const startDay = Math.floor(s.startTimestamp / ONE_DAY);
      return {
        name: `#${s._idx}`,
        offset: startDay - minDay,
        duration: s.lockDays,
      };
    });
  }, [stakes]);

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
      const amt = Number(ethers.utils.formatUnits(s.amount, DECIMALS));
      const b = buckets.find(b => s.lockDays >= b.min && s.lockDays <= b.max);
      const i = buckets.indexOf(b);
      if (i >= 0) { arr[i].amount += amt; arr[i].count += 1; }
    }
    return arr;
  }, [stakes, buckets]);

  const unlocksData = useMemo(() => {
    const todayDay = Math.floor(nowTs / ONE_DAY);
    const map = new Map();
    for (const s of stakes) {
      const unlockDay = Math.floor((s.startTimestamp + s.lockDays * ONE_DAY) / ONE_DAY);
      if (unlockDay >= todayDay && unlockDay <= todayDay + 90) {
        const amt = Number(ethers.utils.formatUnits(s.amount, DECIMALS));
        map.set(unlockDay, (map.get(unlockDay) || 0) + amt);
      }
    }
    const arr = [];
    for (let d = todayDay; d <= todayDay + 90; d++) {
      arr.push({
        d,
        date: new Date(d * ONE_DAY * 1000).toLocaleDateString(),
        amount: map.get(d) || 0
      });
    }
    return arr;
  }, [stakes, nowTs]);

  const [selIdx, setSelIdx] = useState(null);
  const penaltyData = useMemo(() => {
    let L = 30;
    if (selIdx != null && stakes[selIdx]) L = Math.max(1, stakes[selIdx].lockDays);
    const data = [];
    for (let d = -L; d <= L; d++) {
      let p = 0;
      if (d < 0) { // early
        p = earlyBasis * ((-d) / L);
        if (p > earlyBasis) p = earlyBasis;
      } else if (d > 0) { // late
        p = lateBasis * (d / L);
        if (p > lateBasis) p = lateBasis;
      }
      data.push({ d, penalty: Number(p.toFixed(2)) });
    }
    return data;
  }, [selIdx, stakes, earlyBasis, lateBasis]);

  const sharesTrendData = useMemo(
    () => sharesHistory.map(p => ({ time: new Date(p.t).toLocaleTimeString(), shares: p.v })),
    [sharesHistory]
  );
  const ratioTrendData = useMemo(
    () => ratioHistory.map(p => ({ time: new Date(p.t).toLocaleTimeString(), ratio: p.v })),
    [ratioHistory]
  );

  /* ---------------- UI ---------------- */
  const connectBtn = (
    <button onClick={connect} style={connectStyle}>
      {addr ? "Reconnect" : "Connect Wallet"}
    </button>
  );

  return (
    <div style={pageStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={logoDot} />
          <div>
            <div style={{ fontWeight: 800, letterSpacing: 0.5 }}>BankNote dApp</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>PulseChain • {symbol}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setDocsOpen(true)} style={smallBtn}>Docs</button>
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

      {/* Actions */}
      <div style={sectionStyle}>
        <div style={sectionHead}>Actions</div>

        {/* Start a Stake */}
        <div style={{ ...cardStyle, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Start a Stake</div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <LabeledInput label={`Amount (${symbol})`} value={stakeAmt} setValue={setStakeAmt} placeholder="e.g. 1000" />
            <LabeledInput label={`Days locked (min ${minDays}, max ${maxDays})`} value={stakeDays} setValue={setStakeDays} placeholder={`${minDays}`} numeric />
          </div>

          {/* Estimates */}
          {est ? (
            <div style={estimatesBox}>
              <div style={estRow}><span>Unlock Date</span><span>{new Date(est.unlockTs * 1000).toLocaleDateString()}</span></div>
              <div style={estRow}><span>LPB Bonus</span><span>{(est.lpbBps/100).toFixed(2)}%</span></div>
              <div style={estRow}><span>BPB Bonus</span><span>{(est.bpbBps/100).toFixed(2)}%</span></div>
              <div style={estRow}><span>Est. Shares</span><span title={String(est.estShares)}>{fmt(est.estShares)}</span></div>
              <div style={estRow}><span>Est. Yield (APR prorata)</span><span>{fmt(est.estYield)} {symbol}</span></div>
            </div>
          ) : (
            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
              Tip: enter amount & days to see estimated shares, bonuses, and unlock date.
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
            <strong>Note:</strong> Ending early applies a penalty that scales with remaining days (up to {earlyBasis}%).
            Ending late can also incur a growing penalty (up to {lateBasis}%). Ending on the unlock day has no late penalty.
          </div>
          <div style={{ marginTop: 12 }}>
            <button onClick={startStake} style={primaryBtn}>Stake</button>
          </div>
        </div>

        {/* End a Stake */}
        <div style={{ ...cardStyle }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>End a Stake</div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <LabeledInput label="End by index…" value={unstakeIdx} setValue={setUnstakeIdx} placeholder="e.g. 0" numeric />
          </div>
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>Tip: You can also end directly from the table below.</div>
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
          <div style={{ opacity: 0.8 }}>No stakes yet.</div>
        ) : (
          <div style={tableWrap}>
            <table style={stakesTable}>
              <colgroup>
                <col style={{ width: 60 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 180 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 110 }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={thCell}>#</th>
                  <th style={thCell}>Amount</th>
                  <th style={thCell}>Shares</th>
                  <th style={thCell}>Lock&nbsp;(days)</th>
                  <th style={thCell}>Start</th>
                  <th style={thCell}>Unlock</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}>Days&nbsp;Left</th>
                  <th style={thCell}></th>
                </tr>
              </thead>
              <tbody>
                {stakes.map((s) => {
                  const amountStr = ethers.utils.formatUnits(s.amount, DECIMALS);
                  const sharesStr = ethers.utils.formatUnits(s.shares, DECIMALS);
                  const start = new Date(s.startTimestamp * 1000);
                  const unlockTs = s.startTimestamp + s.lockDays * ONE_DAY;
                  const unlock = new Date(unlockTs * 1000);
                  const daysStaked = Math.floor((nowTs - s.startTimestamp) / ONE_DAY);
                  const dLeft = s.lockDays - Math.max(0, daysStaked);
                  const status = dLeft > 0 ? "Early" : dLeft === 0 ? "Unlock today" : "Late";
                  return (
                    <tr key={s._idx}>
                      <td style={tdCell}>{s._idx}</td>
                      <td style={tdCell} title={amountStr}>{fmt(Number(amountStr))}</td>
                      <td style={tdCell} title={sharesStr}>{compactDecimalStr(sharesStr)}</td>
                      <td style={tdCell}>{s.lockDays}</td>
                      <td style={tdCell} title={start.toISOString()}>{start.toLocaleDateString()}</td>
                      <td style={tdCell} title={unlock.toISOString()}>{unlock.toLocaleDateString()}</td>
                      <td style={tdCell}>{status}</td>
                      <td style={tdCell}>{dLeft}</td>
                      <td style={endBtnCell}>
                        <button onClick={() => endStake(s._idx)} style={tinyDanger}>End</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
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
                <Pie
                  data={donutData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="55%"
                  outerRadius="80%"
                >
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
              <BarChart data={ladderData} stackOffset="expand" margin={{ left: 20, right: 20 }}>
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
              <BarChart data={bucketData} margin={{ left: 20, right: 20 }}>
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
              <AreaChart data={unlocksData} margin={{ left: 20, right: 20 }}>
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
              <LineChart data={penaltyData} margin={{ left: 20, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="d" tickFormatter={(t) => `${t}`} label={{ value: "Days from unlock (– early / + late)", position: "insideBottom", offset: -5, fill: "#9fb3d9" }} />
                <YAxis tickFormatter={(v) => `${v}%`} />
                <RTooltip formatter={(v) => [`${v}%`, "Penalty"]} />
                <ReferenceLine x={0} stroke="#aaa" />
                <Line type="monotone" dataKey="penalty" stroke="#ff8da1" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Row D: session trend (price ratio) */}
        <div style={analyticsGrid}>
          <div style={chartCard}>
            <div style={chartTitle}>bNote / PLS ratio (session)</div>
            <ResponsiveContainer width="100%" height="85%">
              <LineChart data={ratioTrendData} margin={{ left: 20, right: 20 }}>
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

      {/* Footer */}
      <div style={{ opacity: 0.6, fontSize: 12, margin: "30px 0" }}>
        Prices & volumes from Dexscreener (top-liquidity pair on PulseChain). Market cap is an estimate.
        &nbsp; bNote contract: {CONTRACT_ADDRESS}
      </div>

      {/* -------- Docs Overlay (iframe + auto-close on nav) -------- */}
      {docsOpen && (
        <div style={docsOverlay} onClick={() => setDocsOpen(false)}>
          <div style={docsPanel} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontWeight: 800 }}>Docs</div>
              <button style={smallBtn} onClick={() => setDocsOpen(false)}>Close</button>
            </div>
            <iframe
              src="/docs.html"
              title="docs"
              style={{ width: "100%", height: "80vh", border: 0, borderRadius: 12, background: "transparent" }}
            />
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
              Tip: Use the table of contents inside the page; the panel will close automatically when you follow a link within docs (use back to return).
            </div>
          </div>
        </div>
      )}
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
    <div style={row}>
      <div>{label}</div>
      <div>{value}</div>
    </div>
  );
}
function LabeledInput({ label, value, setValue, placeholder, numeric }) {
  return (
    <div>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{label}</div>
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={placeholder}
        style={input}
        inputMode={numeric ? "numeric" : "decimal"}
      />
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
const row = {
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

/* --- Stakes table alignment & mobile scroll --- */
const tableWrap = {
  overflowX: "auto",
  marginTop: 8,
};
const stakesTable = {
  width: "100%",
  minWidth: 980,               // keep columns aligned on small screens
  borderCollapse: "separate",
  borderSpacing: 0,
  tableLayout: "fixed",        // header/body alignment locked
};
const thCell = {
  textAlign: "center",
  padding: "12px 10px",
  borderBottom: "1px dashed rgba(132,234,255,0.15)",
  whiteSpace: "nowrap",
  fontWeight: 700,
};
const tdCell = {
  textAlign: "center",
  padding: "12px 10px",
  borderBottom: "1px solid rgba(132,234,255,0.08)",
  verticalAlign: "middle",
};
const endBtnCell = { ...tdCell, width: 110 };

/* --- Estimates panel --- */
const estimatesBox = {
  marginTop: 10,
  padding: 10,
  borderRadius: 12,
  border: "1px solid rgba(132,234,255,0.25)",
  background: "rgba(10,14,26,0.65)",
};
const estRow = {
  display: "flex",
  justifyContent: "space-between",
  padding: "6px 0",
  borderBottom: "1px dashed rgba(132,234,255,0.12)",
};

/* --- Analytics --- */
const analyticsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: 14,
  marginTop: 10,
};
const chartCard = {
  ...cardStyle,
  height: 360,
  display: "flex",
  flexDirection: "column",
};
const chartTitle = {
  fontWeight: 700,
  marginBottom: 8,
};

/* --- Docs overlay --- */
const docsOverlay = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};
const docsPanel = {
  width: "min(980px, 96vw)",
  background: "rgba(12,16,30,0.95)",
  border: "1px solid rgba(132,234,255,0.2)",
  borderRadius: 16,
  padding: 14,
  boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
};
