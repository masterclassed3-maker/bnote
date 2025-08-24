// src/components/Footer.jsx
import React from "react";

const TELEGRAM_URL = "https://t.me/bnotechat";
const X_URL = "https://x.com/bnotepls";

export default function Footer() {
  return (
    <footer style={{ marginTop: 32, textAlign: "center", opacity: 0.9 }}>
      <a
        href={TELEGRAM_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Telegram"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 34,
          height: 34,
          margin: "0 8px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.05)"
        }}
      >
        <svg viewBox="0 0 240 240" role="img" aria-hidden="true" style={{ width: 20, height: 20 }}>
          <circle cx="120" cy="120" r="120" fill="#229ED9" />
          <path d="M53 118l121-47c6-2 11 1 9 9l-21 99c-2 9-7 11-14 7l-41-30-20 19c-2 2-4 3-8 3l3-43 79-71c3-3-1-4-4-2l-97 61-42-13c-9-3-9-9 2-13z" fill="#fff" />
        </svg>
      </a>
      <a
        href={X_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="X"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 34,
          height: 34,
          margin: "0 8px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.05)"
        }}
      >
        <svg viewBox="0 0 1200 1227" role="img" aria-hidden="true" style={{ width: 20, height: 20 }}>
          <path d="M714 0h271L479 519l539 708H748L458 797 134 1227H0l461-542L0 0h322l254 348L714 0zm-94 110l-86 101 475 656h95L620 211z" fill="currentColor"/>
        </svg>
      </a>
    </footer>
  );
}
