// src/App.jsx
import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import BankNoteABI from "./BankNoteABI.json";

// ---- Chain & Contract config ----
const CONTRACT_ADDRESS = "0x473EB99177965277275B3e83bCE3d4884473878D";
const TARGET_CHAIN = {
  chainId: "0x171", // PulseChain
  chainName: "PulseChain",
  rpcUrls: ["https://rpc.pulsechain.com"],
  nativeCurrency: { name: "Pulse", symbol: "PLS", decimals: 18 },
  blockExplorerUrls: ["https://otter.pulsechain.com/"],
};

const DECIMALS = 18;
const ONE_DAY = 86400;

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
  const [maxDays, setMaxDays] = useState(5555); // HEX-like max

  // Staking bits (APR/shareRate)
  const [aprBasis, setAprBasis] = useState(0); // e.g. 369 => 3.69%
  const aprPercent = useMemo(() => (aprBasis / 100).toFixed(2), [aprBasis]);
  const [shareRate, setShareRate] = useState("1");
  const [totalShares, setTotalShares] = useState("0");

  // HEX-like constants (bps)
  const [basis, setBasis] = useState(10000);
  const [lpbPerYearBps, setLpbPerYearBps] = useState(2000);
  const [lpbMaxYears, setLpbMaxYears] = useState(10);
  const [bpbMaxBps, setBpbMaxBps] = useState(1000);
  const [bpbCapHuman, setBpbCapHuman] = useState(210000); // in tokens, human units

  const [earlyPenaltyBps, setEarlyPenaltyBps] = useState(2500);
  const [latePenaltyBps, setLatePenaltyBps] = useState(2500);

  const earlyPenaltyPct = useMemo(() => (earlyPenaltyBps / basis) * 100, [earlyPenaltyBps, basis]);
  const latePenaltyPct  = useMemo(() => (latePenaltyBps / basis) * 100,  [latePenaltyBps, basis]);

  // Your stakes
  const [stakes, setStakes] = useState([]);
  const [walletShares, setWalletShares] = useState("0");
  const [nowTs, setNowTs] = useState(() => Math.floor(Date.now() / 1000));

  // Stake/Unstake forms
  const [stakeAmt, setStakeAmt] = useState("");   // in bNote (human)
  const [stakeDays, setStakeDays] = useState(""); // integer days
  const [unstakeIdx, setUnstakeIdx] = useState("");

  // Price / analytics (optional simple KPIs)
  const [priceUsd, setPriceUsd] = useState(null);
  const [priceNative, setPriceNative] = useState(null);
  const [liquidityUsd, setLiquidityUsd] = useState(null);
  const [fdvUsd, setFdvUsd] = useState(null);
  const [vol24hUsd, setVol24hUsd] = useState(null);
  const [chg1h, setChg1h] = useState(null);
  const [chg24h, setChg24h] = useState(null);
  const [txBuys24, setTxBuys24] = useState(null);
  const [txSells24, setTxSells24] = useState(null);

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
        _symbol,
        ts,
        is,
        metrics,
        tShares,
        _min,
        _max,
        bal,
        _basis,
        _lpbPerYear,
        _lpbMaxYears,
        _bpbMax,
        _bpbCap,
        _earlyBps,
        _lateBps,
      ] = await Promise.all([
        contract.symbol(),
        contract.totalSupply(),
        contract.INITIAL_SUPPLY(),
        contract.metrics?.() ?? Promise.resolve([aprBasis, ethers.utils.parseUnits(shareRate || "1", DECIMALS)]),
        contract.totalShares(),
        contract.MIN_STAKE_DAYS ? contract.MIN_STAKE_DAYS() : Promise.resolve(minDays),
        contract.MAX_STAKE_DAYS ? contract.MAX_STAKE_DAYS() : Promise.resolve(maxDays),
        addr ? contract.balanceOf(addr) : Promise.resolve("0"),
        contract.BASIS ? contract.BASIS() : Promise.resolve(10000),
        contract.LPB_PER_YEAR_BPS ? contract.LPB_PER_YEAR_BPS() : Promise.resolve(2000),
        contract.LPB_MAX_YEARS ? contract.LPB_MAX_YEARS() : Promise.resolve(10),
        contract.BPB_MAX_BPS ? contract.BPB_MAX_BPS() : Promise.resolve(1000),
        contract.BPB_CAP ? contract.BPB_CAP() : Promise.resolve(ethers.utils.parseUnits("210000", DECIMALS)),
        contract.EARLY_PENALTY_BASIS ? contract.EARLY_PENALTY_BASIS() : Promise.resolve(2500),
        contract.LATE_PENALTY_BASIS ? contract.LATE_PENALTY_BASIS() : Promise.resolve(2500),
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

      setBasis(Number(_basis));
      setLpbPerYearBps(Number(_lpbPerYear));
      setLpbMaxYears(Number(_lpbMaxYears));
      setBpbMaxBps(Number(_bpbMax));
      setBpbCapHuman(Number(ethers.utils.formatUnits(_bpbCap, DECIMALS)));

      setEarlyPenaltyBps(Number(_earlyBps));
      setLatePenaltyBps(Number(_lateBps));
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
        autoRenew: s.autoRenew ?? false,
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

  // Dexscreener price fetch
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

  // Helpers
  const fmt = (n, d = 2) => {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    const num = typeof n === "string" ? Number(n) : n;
    if (num >= 1e9) return (num / 1e9).toFixed(d) + "B";
    if (num >= 1e6) return (num / 1e6).toFixed(d) + "M";
    if (num >= 1e3) return (num / 1e3).toFixed(d) + "k";
    return num.toFixed(d);
  };
  const fmtUnits = (bn) => ethers.utils.formatUnits(bn || "0", DECIMALS);
  const fmtCompact = (n, d = 2) => {
    const num = Number(n);
    if (!isFinite(num)) return "—";
    try {
      return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: d }).format(num);
    } catch {
      return fmt(num, d);
    }
  };

  // CSV helpers (unchanged)
  const buildCSV = () => {
    const headers = [
      "index","amount_bNote","locked_days","start_timestamp","start_iso",
      "unlock_timestamp","unlock_iso","status","days_remaining",
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

  // ---- Write: Stake & Unstake ----
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
        const estEarlyPct = (earlyPenaltyBps * (dLeft / s.lockDays)) / basis * 100;
        confirmMsg = `Early by ${dLeft} day(s). Estimated penalty ~${estEarlyPct.toFixed(2)}% of principal.\n\nProceed?`;
      } else if (dLeft < 0) {
        const lateDays = -dLeft;
        const estLatePct = Math.min((latePenaltyBps * (lateDays / s.lockDays)) / basis * 100, (latePenaltyBps / basis) * 100);
        confirmMsg = `Late by ${lateDays} day(s). Estimated penalty ~${estLatePct.toFixed(2)}% (grows with lateness).\n\nProceed?`;
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

  // ---------- Estimates (off-chain guide) ----------
  const estimates = useMemo(() => {
    const amount = Number(stakeAmt);
    const days = Number(stakeDays);
    if (!isFinite(amount) || amount <= 0 || !Number.isInteger(days) || days < 1) {
      return null;
    }

    const years = Math.floor(days / 365);
    const lpbYears = Math.min(years, Number(lpbMaxYears || 0));
    const lpbFactor = 1 + (Number(lpbPerYearBps || 0) * lpbYears) / Number(basis || 10000);

    const cap = Number(bpbCapHuman || 0);
    const frac = cap > 0 ? Math.min(amount / cap, 1) : 0;
    const bpbFactor = 1 + (Number(bpbMaxBps || 0) * frac) / Number(basis || 10000);

    const sr = Number(shareRate || 1);
    const shares = sr > 0 ? (amount * lpbFactor * bpbFactor) / sr : 0;

    const apr = Number(aprBasis || 0) / Number(basis || 10000);
    const yieldAmt = amount * apr * (days / 365);

    const unlockDate = new Date(Date.now() + days * ONE_DAY * 1000);

    return {
      amount,
      days,
      lpbYears,
      lpbBonusPct: ((lpbFactor - 1) * 100),
      bpbBonusPct: ((bpbFactor - 1) * 100),
      shares,
      estYield: yieldAmt,
      unlockDate,
      earlyMaxPct: (earlyPenaltyBps / basis) * 100,
      lateMaxPct: (latePenaltyBps / basis) * 100,
    };
  }, [stakeAmt, stakeDays, lpbPerYearBps, lpbMaxYears, bpbMaxBps, bpbCapHuman, shareRate, aprBasis, basis, earlyPenaltyBps, latePenaltyBps]);

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
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => window.open("/docs.html", "_blank")} style={smallBtn}>Docs</button>
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
        <AnalyticsCard label="APR" value={`${aprPercent}%`} sub={`Share Rate: ${Number(shareRate).toFixed(6)}`} />
      </div>

      {/* Wallet Panel */}
      <div style={sectionStyle}>
        <div style={sectionHead}>Wallet</div>
        <Row label="Account" value={<span style={mono}>{addr ?? "—"}</span>} />
        <Row label="Balance" value={<span style={mono}>{fmt(Number(fmtUnits(balance || "0")))} {symbol}</span>} />
        <Row label="Total Shares (Wallet)" value={
          <span style={mono} title={fmtUnits(walletShares || "0")}>
            {fmtCompact(Number(fmtUnits(walletShares || "0")), 3)}
          </span>
        } />
        <Row label="Total Shares (Contract)" value={
          <span style={mono} title={fmtUnits(totalShares || "0")}>
            {fmtCompact(Number(fmtUnits(totalShares || "0")), 3)}
          </span>
        } />
      </div>

      {/* Stake / Unstake */}
      <div style={sectionStyle}>
        <div style={sectionHead}>Actions</div>

        <div style={{ ...cardStyle, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Start a Stake</div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <LabeledInput label={`Amount (${symbol})`} value={stakeAmt} setValue={setStakeAmt} placeholder="e.g. 1000" />
            <LabeledInput label={`Days locked (min ${minDays}, max ${maxDays})`} value={stakeDays} setValue={setStakeDays} placeholder={`${minDays}`} numeric />
          </div>

          {/* Estimates panel */}
          <div style={{ ...estimatesCard }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Estimates (off-chain)</div>
            {estimates ? (
              <div style={estGrid}>
                <KV k="LPB Bonus" v={`${estimates.lpbBonusPct.toFixed(2)}% (${estimates.lpbYears}y)`} />
                <KV k="BPB Bonus" v={`${estimates.bpbBonusPct.toFixed(2)}%`} />
                <KV k="Projected Shares" v={fmtCompact(estimates.shares, 3)} title={String(estimates.shares)} />
                <KV k="Est. Yield @ APR" v={`${fmt(estimates.estYield, 6)} ${symbol}`} />
                <KV k="Unlock Date" v={estimates.unlockDate.toLocaleDateString()} title={estimates.unlockDate.toISOString()} />
                <KV k="Max Early Penalty" v={`${earlyPenaltyPct.toFixed(2)}%`} />
                <KV k="Max Late Penalty" v={`${latePenaltyPct.toFixed(2)}%`} />
              </div>
            ) : (
              <div style={{ opacity: 0.8, fontSize: 13 }}>Enter an amount and integer days to preview shares & yield.</div>
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            <button onClick={startStake} style={primaryBtn}>Stake</button>
          </div>
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
            <strong>Note:</strong> Early penalties scale linearly with remaining days (max {earlyPenaltyPct.toFixed(2)}%).
            Late penalties grow after unlock (max {latePenaltyPct.toFixed(2)}%). Ending on the unlock day avoids late penalty.
          </div>
        </div>

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
          <div style={{ opacity: 0.8, textAlign: "center" }}>No stakes yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={table}>
              <colgroup>
                <col style={{ width: "8%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "10%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={thCell}>#</th>
                  <th style={thCell}>Amount</th>
                  <th style={thCell}>Shares</th>
                  <th style={thCell}>Lock (days)</th>
                  <th style={thCell}>Start</th>
                  <th style={thCell}>Unlock</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}></th>
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
                  const status = dLeft > 0 ? `Early (${dLeft}d)` : dLeft === 0 ? "Unlock today" : `Late (${Math.abs(dLeft)}d)`;
                  return (
                    <tr key={s._idx}>
                      <td style={tdCell}>{s._idx}</td>
                      <td style={tdCell} title={String(amount)}>{fmt(amount)}</td>
                      <td style={tdCell} title={String(sharesHuman)}>{fmtCompact(sharesHuman, 3)}</td>
                      <td style={tdCell}>{s.lockDays}</td>
                      <td style={tdCell} title={start.toISOString()}>{start.toLocaleDateString()}</td>
                      <td style={tdCell} title={unlock.toISOString()}>{unlock.toLocaleDateString()}</td>
                      <td style={tdCell}>{status}</td>
                      <td style={tdCell}>
                        <button onClick={() => endStake(s._idx)} style={tinyDanger}>End</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85, textAlign: "center" }}>
          <strong>Penalty rules:</strong> Early = before the full lock period elapses (up to {earlyPenaltyPct.toFixed(2)}%). Late = after unlock (up to {latePenaltyPct.toFixed(2)}%).
          Ending exactly on the unlock day has no late penalty. Guidance here is client-side; chain timing rules.
        </div>
      </div>

      <div style={{ opacity: 0.6, fontSize: 12, margin: "30px 0", textAlign: "center" }}>
        Prices & volumes from Dexscreener (top-liquidity pair on PulseChain). Market cap is an estimate. |
        bNote contract: {CONTRACT_ADDRESS}
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
function KV({ k, v, title }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div style={{ opacity: 0.8 }}>{k}</div>
      <div title={title} style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220, textAlign: "right" }}>
        {v}
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
const estimatesCard = {
  background: "rgba(10,14,26,0.65)",
  border: "1px solid rgba(132,234,255,0.20)",
  borderRadius: 12,
  padding: 12,
  marginTop: 12,
};
const estGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 10,
  alignItems: "center",
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
  marginLeft: 0,
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
const table = {
  width: "100%",
  borderCollapse: "separate",
  borderSpacing: 0,
  tableLayout: "fixed",
};
const thCell = {
  textAlign: "center",
  padding: "10px",
  borderBottom: "1px dashed rgba(132,234,255,0.25)",
  whiteSpace: "nowrap",
};
const tdCell = {
  textAlign: "center",
  padding: "10px",
  borderBottom: "1px dashed rgba(132,234,255,0.12)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
