"use client";

import { useId, useState } from "react";

/**
 * Diferença de ouro do seu time minuto a minuto.
 *
 * É uma grandeza com polaridade (à frente / atrás), então a cor é divergente:
 * verde acima de zero, vermelho abaixo, e o zero em cinza neutro. Uma série só
 * — o título diz o que é, sem legenda.
 */
export function GoldChart({
  points,
  marks = [],
}: {
  points: { minute: number; diff: number }[];
  /** minutos a destacar no eixo (suas mortes) */
  marks?: { minute: number; label: string }[];
}) {
  const clipId = useId();
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return null;

  const W = 640;
  const H = 180;
  const pad = { top: 12, right: 12, bottom: 22, left: 48 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const maxAbs = Math.max(1000, ...points.map((p) => Math.abs(p.diff)));
  // teto redondo: 1.000, 2.000, 5.000, 10.000…
  const step = [1000, 2000, 2500, 5000, 10000, 20000].find((s) => s * 2 >= maxAbs) ?? 20000;
  const top = Math.ceil(maxAbs / step) * step;
  const lastMinute = points[points.length - 1].minute;

  const x = (minute: number) => pad.left + (minute / lastMinute) * innerW;
  const y = (diff: number) => pad.top + innerH / 2 - (diff / top) * (innerH / 2);
  const zeroY = y(0);

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.minute)},${y(p.diff)}`).join("");
  const area = `${line}L${x(lastMinute)},${zeroY}L${x(0)},${zeroY}Z`;
  const ticks = [top, top / 2, 0, -top / 2, -top];
  const minuteTicks = points.filter((p) => p.minute % 5 === 0).map((p) => p.minute);

  const fmt = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString("pt-BR")}`;
  const hovered = hover !== null ? points[hover] : null;
  const last = points[points.length - 1];

  return (
    <figure className="space-y-2">
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label={`Diferença de ouro do seu time: terminou em ${fmt(last.diff)} no minuto ${last.minute}`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * W;
            const minute = Math.round(((px - pad.left) / innerW) * lastMinute);
            setHover(Math.max(0, Math.min(points.length - 1, minute)));
          }}
        >
          <defs>
            <clipPath id={`${clipId}-up`}>
              <rect x={0} y={0} width={W} height={zeroY} />
            </clipPath>
            <clipPath id={`${clipId}-down`}>
              <rect x={0} y={zeroY} width={W} height={H - zeroY} />
            </clipPath>
          </defs>

          {/* grade e eixo y: fio de cabelo, recessivo */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={pad.left}
                x2={W - pad.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--border)"
                strokeWidth={t === 0 ? 1.5 : 1}
                opacity={t === 0 ? 1 : 0.5}
              />
              <text
                x={pad.left - 6}
                y={y(t)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground text-[10px] tabular-nums"
              >
                {fmt(t)}
              </text>
            </g>
          ))}
          {minuteTicks.map((m) => (
            <text
              key={m}
              x={x(m)}
              y={H - 6}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px] tabular-nums"
            >
              {m}&apos;
            </text>
          ))}

          {/* suas mortes, marcadas na base */}
          {marks.map((m, i) => (
            <line
              key={i}
              x1={x(m.minute)}
              x2={x(m.minute)}
              y1={H - pad.bottom - 5}
              y2={H - pad.bottom}
              stroke="var(--muted-foreground)"
              strokeWidth={2}
              strokeLinecap="round"
            >
              <title>{m.label}</title>
            </line>
          ))}

          {/* à frente: verde; atrás: vermelho — o mesmo traço cortado no zero */}
          <g clipPath={`url(#${clipId}-up)`}>
            <path d={area} fill="var(--advantage)" opacity={0.12} />
            <path d={line} fill="none" stroke="var(--advantage)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </g>
          <g clipPath={`url(#${clipId}-down)`}>
            <path d={area} fill="var(--disadvantage)" opacity={0.12} />
            <path d={line} fill="none" stroke="var(--disadvantage)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </g>

          {/* ponto final com anel na cor da superfície */}
          <circle
            cx={x(last.minute)}
            cy={y(last.diff)}
            r={4}
            fill={last.diff >= 0 ? "var(--advantage)" : "var(--disadvantage)"}
            stroke="var(--card)"
            strokeWidth={2}
          />

          {hovered && (
            <g pointerEvents="none">
              <line
                x1={x(hovered.minute)}
                x2={x(hovered.minute)}
                y1={pad.top}
                y2={H - pad.bottom}
                stroke="var(--border-strong)"
                strokeWidth={1}
              />
              <circle
                cx={x(hovered.minute)}
                cy={y(hovered.diff)}
                r={4}
                fill={hovered.diff >= 0 ? "var(--advantage)" : "var(--disadvantage)"}
                stroke="var(--card)"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>

        {hovered && (
          <div
            className="bg-popover border-border-strong pointer-events-none absolute top-1 rounded-sm border px-2 py-1 text-[11px] shadow-lg"
            style={{
              left: `${(x(hovered.minute) / W) * 100}%`,
              transform: `translateX(${hovered.minute > lastMinute / 2 ? "-105%" : "5%"})`,
            }}
          >
            <p className="text-muted-foreground">Minuto {hovered.minute}</p>
            <p className="font-mono tabular-nums">{fmt(hovered.diff)} de ouro</p>
          </div>
        )}
      </div>

      <details className="text-muted-foreground text-[11px]">
        <summary className="hover:text-foreground cursor-pointer">Ver em tabela</summary>
        <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-0.5 font-mono tabular-nums sm:grid-cols-6">
          {points.map((p) => (
            <span key={p.minute}>
              {p.minute}&apos; {fmt(p.diff)}
            </span>
          ))}
        </div>
      </details>
    </figure>
  );
}
