"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, RotateCcw, X } from "lucide-react";
import { ChampionSlot } from "@/components/champion-slot";
import { DraftPhase } from "@/components/draft-board";
import { SyncBar, useLeagueState } from "@/components/league-sync";
import { draftFromChampSelect, matchFromLive, type RolePrior } from "@/engine/league-sync";
import { EntityPicker, type PickerEntry } from "@/components/entity-picker";
import { analyze, itemFit, type Catalog } from "@/engine/itemization";
import { simulateCombat, simulateTeamCombat, type CombatSnapshot } from "@/engine/combat-sim";
import { recommendRunes, type RuneRecommendation } from "@/engine/runes-sim";
import { analyzeMatchup, verdictLabel, type MatchupCatalog, type Verdict } from "@/engine/matchup";
import {
  ROLES,
  ROLE_LABEL,
  ROLE_HINT,
  EMPTY_TEAM,
  PHASE_LABEL,
  PHASE_FOCUS,
  phaseAt,
  opponentsFor,
  analyzeTeam,
  type Role,
  type TeamSlots,
} from "@/engine/match";
import { buildGamePlan } from "@/engine/game-plan";
import { buildMatchDiagnosis } from "@/engine/prompt-builder";
import { tagLabel } from "@/engine/tag-catalog";
import { buildStatsIndex } from "@/engine/stats";
import type { CatalogPayload } from "@/db/queries/catalog";
import type { ChampionRef } from "@/engine/types";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "riftando:partida";
const MAX_ITEMS = 6;

type Session = {
  stage: "SELECAO" | "PARTIDA";
  role: Role;
  myChampionId: string | null;
  allies: TeamSlots;
  enemies: TeamSlots;
  bans: string[];
  minute: number;
  myLevel: number;
  myGold: number;
  /** itens por campeão aliado, para acompanhar quem comprou o quê */
  allyItems: Record<string, number[]>;
  /** itens por campeão inimigo, para acompanhar quem comprou o quê */
  enemyItems: Record<string, number[]>;
  /** campeões do seu time marcados para o cálculo de combate */
  activeFightAllies: string[];
  /** campeões do time inimigo marcados para o cálculo de combate */
  activeFightEnemies: string[];
  /** nível de cada campeão, quando o jogo informa; senão vale o seu */
  levels: Record<string, number>;
  /** ler seleção e partida do LoL aberto nesta máquina */
  sync: boolean;
};

const INITIAL: Session = {
  stage: "SELECAO",
  role: "MID",
  myChampionId: null,
  allies: { ...EMPTY_TEAM },
  enemies: { ...EMPTY_TEAM },
  bans: [],
  minute: 8, // Phase is static for now unless changed, we hide the input
  myLevel: 18,
  myGold: 100000,
  allyItems: {},
  enemyItems: {},
  activeFightAllies: [],
  activeFightEnemies: [],
  levels: {},
  sync: true,
};

const VERDICT_STYLE: Record<Verdict, string> = {
  MUITO_FAVORAVEL: "text-advantage",
  FAVORAVEL: "text-advantage",
  EQUILIBRADO: "text-even",
  DESFAVORAVEL: "text-disadvantage",
  MUITO_DESFAVORAVEL: "text-disadvantage",
};

export function MatchAnalyzer({ payload }: { payload: CatalogPayload }) {
  const [session, setSession] = useState<Session>(INITIAL);
  const [loaded, setLoaded] = useState(false);

  // a partida continua depois de recarregar a página — você está jogando
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setSession({ ...INITIAL, ...JSON.parse(saved) });
    } catch {
      /* localStorage indisponível: começa do zero, sem quebrar */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      /* ignora cota cheia */
    }
  }, [session, loaded]);

  const championMap = useMemo(
    () => new Map(payload.champions.map((c) => [c.id, c])),
    [payload.champions],
  );
  const itemCatalog: Catalog = useMemo(
    () => ({
      items: new Map(payload.items.map((i) => [i.id, i])),
      champions: championMap,
      rules: payload.rules,
    }),
    [payload, championMap],
  );
  const matchupCatalog: MatchupCatalog = useMemo(
    () => ({
      champions: championMap,
      tagRules: payload.matchupRules,
      overrides: payload.matchupOverrides,
      stats: payload.stats ? buildStatsIndex(payload.stats) : undefined,
    }),
    [payload, championMap],
  );

  // --- sincronização com o LoL aberto nesta máquina
  const league = useLeagueState(loaded && session.sync);
  const itemMap = itemCatalog.items;
  const rolePrior: RolePrior | undefined = useMemo(() => {
    if (!payload.stats?.roleStats.length) return undefined;
    const games = new Map<string, number>();
    const totals = new Map<string, number>();
    for (const r of payload.stats.roleStats) {
      games.set(`${r.championId}|${r.role}`, r.games);
      totals.set(r.championId, (totals.get(r.championId) ?? 0) + r.games);
    }
    return (championId, role) => {
      const total = totals.get(championId);
      // abaixo de 20 partidas a frequência é ruído — melhor a classe decidir
      if (!total || total < 20) return undefined;
      return (games.get(`${championId}|${role}`) ?? 0) / total;
    };
  }, [payload.stats]);
  const lastPhase = useRef<string | null>(null);

  useEffect(() => {
    if (!league) return;
    const phase = league.champSelect ? "ChampSelect" : league.live ? "InProgress" : league.phase;
    const entering = phase !== lastPhase.current;
    lastPhase.current = phase;

    if (league.champSelect) {
      const draft = draftFromChampSelect(league.champSelect, championMap, rolePrior);
      setSession((prev) => {
        // seleção nova: a partida anterior não vale mais nada
        const base = entering ? { ...INITIAL, sync: prev.sync } : prev;
        const role = draft.myRole ?? base.role;
        return {
          ...base,
          stage: "SELECAO",
          role,
          // slot vazio no cliente não apaga o que você está testando aqui (o seu
          // pick ou uma resposta escolhida no "forte e fraco contra"); o que o
          // cliente informa sempre vence. `base` já foi zerado ao entrar na
          // seleção, então nada de uma partida anterior sobrevive.
          allies: Object.fromEntries(
            ROLES.map((r) => [r, draft.allies[r] ?? base.allies[r]]),
          ) as TeamSlots,
          enemies: draft.enemies,
          bans: draft.bans,
        };
      });
      return;
    }

    if (league.live) {
      const match = matchFromLive(league.live, championMap, itemMap, rolePrior);
      if (!match) return;
      setSession((prev) => {
        const present = new Set([...Object.values(match.allies), ...Object.values(match.enemies)]);
        return {
          ...prev,
          stage: "PARTIDA",
          role: match.myRole,
          allies: match.allies,
          enemies: match.enemies,
          allyItems: match.allyItems,
          enemyItems: match.enemyItems,
          levels: match.levels,
          minute: match.minute,
          myLevel: match.myLevel,
          myGold: match.myGold,
          activeFightAllies: prev.activeFightAllies.filter((id) => present.has(id)),
          activeFightEnemies: prev.activeFightEnemies.filter((id) => present.has(id)),
        };
      });
    }
  }, [league, championMap, itemMap, rolePrior]);

  const liveSynced = Boolean(session.sync && league?.live);

  // seu campeão é sempre o do seu slot no time: uma fonte de verdade só,
  // compartilhada entre a fase de seleção e a de partida
  const myChampionId = session.allies[session.role];
  const me = myChampionId ? championMap.get(myChampionId) : undefined;
  const opponents = opponentsFor(session.role, session.enemies);

  const championEntries: PickerEntry[] = useMemo(
    () =>
      payload.champions.map((c) => ({
        id: c.id,
        name: c.name,
        iconUrl: c.iconUrl,
        subtitle: c.classes.join("/"),
      })),
    [payload.champions],
  );

  const itemEntries: PickerEntry[] = useMemo(
    () => {
      const dmgType = me?.officialDamageType ?? "PHYSICAL";
      return payload.items
        .filter((i) => i.totalGold > 0)
        .map((i) => ({
          item: i,
          fit: itemFit(i, me, dmgType, itemCatalog, session.role),
        }))
        .sort((a, b) => b.fit - a.fit)
        .map(({ item: i }) => ({
          id: i.id,
          name: i.name,
          iconUrl: i.iconUrl,
          subtitle: `${i.totalGold} de ouro`,
        }));
    },
    [payload.items, me, itemCatalog, session.role],
  );
  const phase = phaseAt(session.minute);

  const enemyTeam = useMemo(
    () => analyzeTeam(ROLES.map((r) => session.enemies[r]), championMap, me),
    [session.enemies, championMap, me],
  );

  const matchup = useMemo(
    () =>
      analyzeMatchup(
        {
          selfChampionId: myChampionId,
          enemyChampionId: opponents.primary,
          allyJungleId: session.allies.JUNGLE,
          enemyJungleId: session.enemies.JUNGLE,
        },
        matchupCatalog,
      ),
    [myChampionId, opponents.primary, session.allies.JUNGLE, session.enemies.JUNGLE, matchupCatalog],
  );

  // alvo principal de rotação e recomendações gerais
  const biggestThreatId = enemyTeam.threats[0]?.champion.id ?? null;
  const focusId = opponents.primary ?? biggestThreatId;
  const focusChampion = focusId ? championMap.get(focusId) : undefined;

  const matchState = useMemo(() => {
    const levelOf = (id: string) => session.levels[id] ?? session.myLevel;
    return {
      selfRole: session.role,
      self: {
        championId: myChampionId,
        level: session.myLevel,
        itemIds: myChampionId ? (session.allyItems[myChampionId] ?? []) : [],
        gold: session.myGold,
      },
      threat: {
        championId: focusId,
        level: focusId ? levelOf(focusId) : session.myLevel,
        itemIds: focusId ? (session.enemyItems[focusId] ?? []) : [],
      },
      enemyTeam: ROLES.map((r) => session.enemies[r])
        .filter((id): id is string => Boolean(id) && id !== focusId)
        .map((id) => ({
          championId: id,
          level: levelOf(id),
          itemIds: session.enemyItems[id] ?? [],
        })),
      allyTeam: ROLES.map((r) => session.allies[r])
        .filter((id): id is string => Boolean(id) && id !== myChampionId)
        .map((id) => ({
          championId: id,
          level: levelOf(id),
          itemIds: session.allyItems[id] ?? [],
        })),
    };
  }, [session, myChampionId, focusId]);

  const itemization = useMemo(
    () => {
      const allyIds = ROLES
        .filter((r) => r !== session.role)
        .map((r) => session.allies[r])
        .filter((id): id is string => Boolean(id));

      return analyze(matchState, itemCatalog, 6, allyIds);
    },
    [matchState, session.role, session.allies, itemCatalog],
  );

  const combatSnapshot = useMemo(() => {
    const levelFor = (id: string) => session.levels[id] ?? session.myLevel;
    const activeAlliesState = session.activeFightAllies.map(id => ({
      championId: id,
      level: levelFor(id),
      itemIds: session.allyItems[id] ?? []
    }));
    const activeEnemiesState = session.activeFightEnemies.map(id => ({
      championId: id,
      level: levelFor(id),
      itemIds: session.enemyItems[id] ?? []
    }));
    return simulateTeamCombat(activeAlliesState, activeEnemiesState, itemCatalog);
  }, [session.activeFightAllies, session.activeFightEnemies, session.myLevel, session.levels, session.allyItems, session.enemyItems, itemCatalog]);

  const threatRadar = useMemo(() => {
    if (!myChampionId) return null;
    const targets = ROLES.map(r => session.enemies[r]).filter(id => Boolean(id)) as string[];
    
    const analyses = targets.map(enemyId => {
      // Mock matchState against each enemy
      const tempState = {
        ...matchState,
        threat: {
          championId: enemyId,
          level: session.levels[enemyId] ?? session.myLevel,
          itemIds: session.enemyItems[enemyId] ?? []
        }
      };
      // We don't have the matchup score against everyone easily computed here, 
      // but simulateCombat mainly uses items and base stats. Let's pass neutral gank/score.
      const snapshot = simulateCombat(tempState, itemCatalog, 0, "MÉDIO");
      return {
        championId: enemyId,
        champion: championMap.get(enemyId)!,
        winChance: snapshot.winChance,
        posture: snapshot.posture,
        postureLabel: snapshot.postureLabel
      };
    }).sort((a, b) => b.winChance - a.winChance); // Easiest (highest win chance) first

    if (analyses.length === 0) return null;

    const easiestTarget = analyses[0];
    const hardestTarget = analyses[analyses.length - 1];

    return { easiestTarget, hardestTarget, all: analyses };
  }, [matchState, session.enemies, session.myLevel, session.levels, session.enemyItems, itemCatalog, championMap, myChampionId]);

  const plan = useMemo(
    () => buildGamePlan({ phase, role: session.role, me, matchup, enemyTeam }),
    [phase, session.role, me, matchup, enemyTeam],
  );

  const ready = Boolean(myChampionId && opponents.primary);

  const update = (patch: Partial<Session>) => setSession((s) => ({ ...s, ...patch }));
  const setEnemy = (role: Role) => (id: string | null) =>
    setSession((s) => ({ ...s, enemies: { ...s.enemies, [role]: id } }));
  const setAlly = (role: Role) => (id: string | null) =>
    setSession((s) => ({ ...s, allies: { ...s.allies, [role]: id } }));

  return (
    <div className="space-y-8">
      <SyncBar
        enabled={session.sync}
        state={league}
        onToggle={(sync) => update({ sync })}
      />

      <StageTabs
        stage={session.stage}
        ready={ready}
        onStage={(stage) => update({ stage })}
      />

      {session.stage === "SELECAO" ? (
        <>
          <DraftPhase
            catalog={matchupCatalog}
            entries={championEntries}
            myRole={session.role}
            allies={session.allies}
            enemies={session.enemies}
            bans={session.bans}
            onRole={(role) => update({ role })}
            onAlly={(role, id) => setAlly(role)(id)}
            onEnemy={(role, id) => setEnemy(role)(id)}
            onBans={(bans) => update({ bans })}
          />

          {ready && (
            <button
              type="button"
              onClick={() => update({ stage: "PARTIDA" })}
              className="border-gold/60 text-gold hover:bg-gold/10 h-11 w-full rounded-sm border text-sm font-medium"
            >
              Seleção pronta — acompanhar a partida →
            </button>
          )}
        </>
      ) : (
        <>
          <StepOne
            session={session}
            me={me}
            entries={championEntries}
            onRole={(role) => update({ role })}
            onChampion={(id) => setAlly(session.role)(id)}
            onAlly={setAlly}
            allies={session.allies}
            championMap={championMap}
          />

          <StepTwo
            enemies={session.enemies}
            championMap={championMap}
            entries={championEntries}
            onEnemy={setEnemy}
            myRole={session.role}
            explanation={opponents.explanation}
            primaryId={opponents.primary}
            secondaryId={opponents.secondary}
          />
        </>
      )}

      {session.stage === "PARTIDA" && ready && (
        <>
          <StepThree
            session={session}
            phase={phase}
            itemEntries={itemEntries}
            itemCatalog={itemCatalog}
            focusChampion={focusChampion}
            biggestThreat={enemyTeam.threats[0]?.champion}
            primaryOpponent={opponents.primary ? championMap.get(opponents.primary) : undefined}
            enemies={session.enemies}
            championMap={championMap}
            liveSynced={liveSynced}
            onUpdate={update}
          />

          <Result
            phase={phase}
            minute={session.minute}
            matchup={matchup}
            enemyTeam={enemyTeam}
            itemization={itemization}
            combatSnapshot={combatSnapshot}
            threatRadar={threatRadar}
            runes={recommendRunes(me, focusChampion)}
            plan={plan}
            focusChampion={focusChampion}
            diagnosis={() =>
              buildMatchDiagnosis({
                patch: payload.patch,
                minute: session.minute,
                phase,
                role: session.role,
                matchup,
                enemyTeam,
                plan,
                itemization,
                catalog: itemCatalog,
                state: matchState,
              })
            }
            onReset={() => {
              setSession({ ...INITIAL, sync: session.sync });
              try {
                localStorage.removeItem(STORAGE_KEY);
              } catch {
                /* ignora */
              }
            }}
            onEquip={(itemId) => {
              if (myChampionId) {
                const currentIds = session.allyItems[myChampionId] ?? [];
                if (currentIds.length < MAX_ITEMS) {
                  update({ allyItems: { ...session.allyItems, [myChampionId]: [...currentIds, itemId] } });
                }
              }
            }}
          />
        </>
      )}
    </div>
  );
}

function StageTabs({
  stage,
  ready,
  onStage,
}: {
  stage: Session["stage"];
  ready: boolean;
  onStage: (stage: Session["stage"]) => void;
}) {
  const tabs: { id: Session["stage"]; label: string; hint: string }[] = [
    { id: "SELECAO", label: "Seleção", hint: "bans e escolhas" },
    { id: "PARTIDA", label: "Partida", hint: "itens e plano" },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onStage(tab.id)}
          disabled={tab.id === "PARTIDA" && !ready}
          className={cn(
            "rounded-sm border px-3 py-2.5 text-left transition-colors disabled:opacity-40",
            stage === tab.id
              ? "border-gold/70 bg-gold/10"
              : "border-border hover:border-gold/40",
          )}
        >
          <span
            className={cn(
              "block text-sm font-medium",
              stage === tab.id ? "text-gold" : "text-muted-foreground",
            )}
          >
            {tab.label}
          </span>
          <span className="text-muted-foreground/70 block text-[10px]">{tab.hint}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- passo 1 */

function StepOne({
  session,
  me,
  entries,
  onRole,
  onChampion,
  onAlly,
  allies,
  championMap,
}: {
  session: Session;
  me?: ChampionRef;
  entries: PickerEntry[];
  onRole: (role: Role) => void;
  onChampion: (id: string | null) => void;
  onAlly: (role: Role) => (id: string | null) => void;
  allies: TeamSlots;
  championMap: Map<string, ChampionRef>;
}) {
  const [showAllies, setShowAllies] = useState(false);

  return (
    <section className="space-y-3">
      <h2 className="rule-heading">1 · Você</h2>

      <div className="panel space-y-4 p-4">
        <div>
          <p className="text-muted-foreground mb-2 text-xs">Em que rota você está jogando?</p>
          <div className="grid grid-cols-5 gap-1.5">
            {ROLES.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => onRole(role)}
                title={ROLE_HINT[role]}
                className={cn(
                  "rounded-sm border px-2 py-2 text-xs font-medium transition-colors",
                  session.role === role
                    ? "border-gold/70 bg-gold/12 text-gold"
                    : "border-border hover:border-gold/40 text-muted-foreground",
                )}
              >
                {ROLE_LABEL[role]}
              </button>
            ))}
          </div>
          <p className="text-muted-foreground/80 mt-2 text-[11px]">{ROLE_HINT[session.role]}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,240px)_1fr]">
          <ChampionSlot
            label="Seu campeão"
            hint="Quem você pegou"
            champion={me}
            entries={entries}
            onChange={onChampion}
            tone="ally"
          />

          {me && (
            <div className="text-muted-foreground space-y-1 text-xs">
              <p className="text-foreground text-sm font-medium">Como ele joga</p>
              <div className="flex flex-wrap gap-1">
                {me.tags.slice(0, 6).map((t) => (
                  <span
                    key={t.slug}
                    className="border-border-strong rounded-sm border px-1.5 py-0.5 text-[10px]"
                  >
                    {tagLabel(t.slug)}
                  </span>
                ))}
              </div>
              <p className="pt-1 text-[11px]">
                Alcance de ataque: {me.attackRange}{" "}
                {me.attackType === "MELEE" ? "(corpo a corpo)" : "(à distância)"}
              </p>
            </div>
          )}
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowAllies((v) => !v)}
            className="text-muted-foreground hover:text-gold text-[11px] underline underline-offset-2"
          >
            {showAllies ? "esconder meu time" : "informar meu time (opcional)"}
          </button>
          {showAllies && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {ROLES.filter((r) => r !== session.role).map((role) => (
                <ChampionSlot
                  key={role}
                  label={ROLE_LABEL[role]}
                  hint="Aliado"
                  size="sm"
                  tone="ally"
                  champion={allies[role] ? championMap.get(allies[role]!) : undefined}
                  entries={entries}
                  onChange={onAlly(role)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- passo 2 */

function StepTwo({
  enemies,
  championMap,
  entries,
  onEnemy,
  myRole,
  explanation,
  primaryId,
  secondaryId,
}: {
  enemies: TeamSlots;
  championMap: Map<string, ChampionRef>;
  entries: PickerEntry[];
  onEnemy: (role: Role) => (id: string | null) => void;
  myRole: Role;
  explanation: string;
  primaryId: string | null;
  secondaryId: string | null;
}) {
  return (
    <section className="space-y-3">
      <h2 className="rule-heading">2 · Time inimigo</h2>

      <div className="panel space-y-3 p-4">
        <p className="text-muted-foreground text-xs">
          Preencha na ordem em que aparecem na seleção. Quanto mais completo, melhor a leitura da
          composição.
        </p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {ROLES.map((role) => {
            const id = enemies[role];
            const isPrimary = Boolean(id) && id === primaryId;
            const isSecondary = Boolean(id) && id === secondaryId;
            return (
              <div key={role} className="relative">
                <ChampionSlot
                  label={ROLE_LABEL[role]}
                  hint={role === myRole ? "Seu oponente" : "Inimigo"}
                  size="sm"
                  tone="enemy"
                  champion={id ? championMap.get(id) : undefined}
                  entries={entries}
                  onChange={onEnemy(role)}
                />
                {(isPrimary || isSecondary) && (
                  <span
                    className={cn(
                      "absolute -top-1 right-0 rounded-sm px-1.5 py-0.5 text-[9px] font-semibold",
                      isPrimary
                        ? "bg-disadvantage/20 text-disadvantage"
                        : "bg-even/20 text-even",
                    )}
                  >
                    {isPrimary ? "confronto direto" : "2ª ameaça"}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <p className="border-border-strong text-muted-foreground border-t pt-3 text-xs leading-relaxed">
          {explanation}
        </p>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- passo 3 */

function StepThree({
  session,
  phase,
  itemEntries,
  itemCatalog,
  focusChampion,
  biggestThreat,
  primaryOpponent,
  enemies,
  championMap,
  liveSynced,
  onUpdate,
}: {
  session: Session;
  phase: ReturnType<typeof phaseAt>;
  itemEntries: PickerEntry[];
  itemCatalog: Catalog;
  focusChampion?: ChampionRef;
  biggestThreat?: ChampionRef;
  primaryOpponent?: ChampionRef;
  enemies: TeamSlots;
  championMap: Map<string, ChampionRef>;
  liveSynced: boolean;
  onUpdate: (patch: Partial<Session>) => void;
}) {
  const handleToggleFight = (team: "ALLY" | "ENEMY", championId: string) => {
    if (team === "ALLY") {
      const active = new Set(session.activeFightAllies);
      if (active.has(championId)) active.delete(championId);
      else active.add(championId);
      onUpdate({ activeFightAllies: Array.from(active) });
    } else {
      const active = new Set(session.activeFightEnemies);
      if (active.has(championId)) active.delete(championId);
      else active.add(championId);
      onUpdate({ activeFightEnemies: Array.from(active) });
    }
  };

  const renderTeam = (team: "ALLY" | "ENEMY") => {
    const isAlly = team === "ALLY";
    const teamSlots = isAlly ? session.allies : session.enemies;
    const activeList = isAlly ? session.activeFightAllies : session.activeFightEnemies;
    const title = isAlly ? "Seu Time" : "Time Inimigo";

    return (
      <div className="flex-1 min-w-[200px] space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          {title}
        </p>
        {ROLES.map((role) => {
          const championId = teamSlots[role];
          if (!championId) return null;
          const c = championMap.get(championId);
          const isMe = isAlly && session.role === role;
          const isParticipating = activeList.includes(championId);
          const itemIds = isAlly
            ? session.allyItems[championId] ?? []
            : session.enemyItems[championId] ?? [];

          return (
            <div
              key={role}
              className={cn(
                "rounded-sm border p-3 transition-colors flex flex-col gap-3",
                isParticipating
                  ? (isAlly ? "border-advantage/50 bg-advantage/5" : "border-disadvantage/50 bg-disadvantage/5")
                  : "border-border/50 bg-background/50"
              )}
            >
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={isParticipating}
                  onChange={() => handleToggleFight(team, championId)}
                  className="size-4 shrink-0 rounded border-input cursor-pointer"
                  title="Incluir na simulação de luta"
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={c?.iconUrl ?? ""}
                  alt=""
                  className="size-8 rounded-sm shrink-0 border border-border"
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-xs font-bold",
                      isMe && "text-gold"
                    )}
                  >
                    {c?.name} {isMe && "(Você)"}
                  </p>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider">
                    {ROLE_LABEL[role]}
                    {session.levels[championId] ? ` · nível ${session.levels[championId]}` : ""}
                  </p>
                </div>
              </div>

              <ItemRow
                title=""
                ids={itemIds}
                catalog={itemCatalog}
                entries={itemEntries}
                onChange={(ids) => {
                  if (isAlly) {
                    onUpdate({ allyItems: { ...session.allyItems, [championId]: ids } });
                  } else {
                    onUpdate({ enemyItems: { ...session.enemyItems, [championId]: ids } });
                  }
                }}
              />
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <section className="space-y-3">
      <h2 className="rule-heading">3 · Como está a partida agora</h2>

      <div className="panel p-4">
        <div className="mb-4 grid grid-cols-3 gap-3 border-b border-border/50 pb-4">
          <NumberField
            label="Minuto"
            value={session.minute}
            min={0}
            max={90}
            hint={liveSynced ? "lido do jogo" : PHASE_LABEL[phase]}
            readOnly={liveSynced}
            onChange={(minute) => onUpdate({ minute })}
          />
          <NumberField
            label="Seu nível"
            value={session.myLevel}
            min={1}
            max={18}
            hint={liveSynced ? "lido do jogo" : undefined}
            readOnly={liveSynced}
            onChange={(myLevel) => onUpdate({ myLevel })}
          />
          <NumberField
            label="Seu ouro"
            value={session.myGold}
            min={0}
            step={50}
            hint={liveSynced ? "lido do jogo" : "decide o que dá para comprar agora"}
            readOnly={liveSynced}
            onChange={(myGold) => onUpdate({ myGold })}
          />
        </div>

        <p className="text-[11px] text-muted-foreground mb-4">
          {liveSynced && "Itens e níveis são lidos do jogo a cada 2 segundos. "}
          Marque os campeões (<span className="font-mono text-foreground font-bold">[x]</span>) que estão envolvidos na luta atual para calcular quem ganha. Adicione os itens diretamente abaixo deles.
        </p>

        <div className="flex flex-wrap gap-6 mb-6">
          {renderTeam("ALLY")}
          {renderTeam("ENEMY")}
        </div>
      </div>
    </section>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  hint,
  readOnly,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max?: number;
  step?: number;
  hint?: string;
  readOnly?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
        {label}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        readOnly={readOnly}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isNaN(n)) return;
          onChange(Math.max(min, max !== undefined ? Math.min(max, n) : n));
        }}
        className={cn(
          "border-input bg-background/60 focus-visible:border-gold/60 mt-1 h-9 w-full rounded-sm border px-2.5 font-mono text-sm tabular-nums outline-none",
          readOnly && "text-advantage border-advantage/40",
        )}
      />
      {hint && <span className="text-muted-foreground/80 mt-1 block text-[10px]">{hint}</span>}
    </label>
  );
}

function ItemRow({
  title,
  ids,
  catalog,
  entries,
  onChange,
}: {
  title: string;
  ids: number[];
  catalog: Catalog;
  entries: PickerEntry[];
  onChange: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      {title && <p className="mb-2 text-xs font-medium">{title}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {ids.map((id, index) => {
          const item = catalog.items.get(id);
          return (
            <button
              key={`${id}-${index}`}
              type="button"
              onClick={() => onChange(ids.filter((_, i) => i !== index))}
              title={`Remover ${item?.name ?? id}`}
              className="hover:border-disadvantage/70 rounded-sm border border-transparent p-0.5"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item?.iconUrl ?? ""} alt={item?.name ?? ""} className="portrait size-10" />
            </button>
          );
        })}

        {ids.length < MAX_ITEMS && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={cn(
              "portrait-empty text-muted-foreground/70 size-10 text-lg transition-colors",
              open ? "border-gold/60 text-gold" : "hover:border-gold/50",
            )}
            aria-label="Adicionar item"
          >
            {open ? <X className="size-4" /> : "+"}
          </button>
        )}
      </div>

      {open && (
        <div className="panel-plain mt-2 p-2">
          <EntityPicker
            entries={entries}
            onPick={(id) => {
              onChange([...ids, Number(id)].slice(0, MAX_ITEMS));
              setOpen(false);
            }}
            placeholder="Nome do item…"
            columns={8}
            autoFocus
          />
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- resultado */

function Result({
  phase,
  minute,
  matchup,
  enemyTeam,
  itemization,
  combatSnapshot,
  threatRadar,
  runes,
  plan,
  focusChampion,
  diagnosis,
  onReset,
  onEquip,
}: {
  phase: ReturnType<typeof phaseAt>;
  minute: number;
  matchup: ReturnType<typeof analyzeMatchup>;
  enemyTeam: ReturnType<typeof analyzeTeam>;
  itemization: ReturnType<typeof analyze>;
  combatSnapshot: CombatSnapshot;
  threatRadar: {
    easiestTarget: { champion: ChampionRef; winChance: number; postureLabel: string };
    hardestTarget: { champion: ChampionRef; winChance: number; postureLabel: string };
  } | null;
  runes: RuneRecommendation | null;
  plan: { title: string; detail: string }[];
  focusChampion?: ChampionRef;
  diagnosis: () => string;
  onReset: () => void;
  onEquip: (itemId: number) => void;
}) {
  const [copied, setCopied] = useState(false);
  const barPosition = ((matchup.score + 10) / 20) * 100;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="rule-heading flex-1">
          Análise Tática Global
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onReset}
            className="border-border text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-sm border px-2.5 text-[11px]"
          >
            <RotateCcw className="size-3" />
            Nova partida
          </button>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(diagnosis());
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="border-gold/60 text-gold hover:bg-gold/10 inline-flex h-8 items-center gap-1.5 rounded-sm border px-2.5 text-[11px] font-medium"
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? "Copiado" : "Copiar diagnóstico"}
          </button>
        </div>
      </div>

      {/* situação da rota */}
      <div className="panel space-y-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-muted-foreground text-[10px] tracking-wider uppercase">
              Sua rota contra {matchup.enemy?.name}
            </p>
            <p className={cn("font-display text-2xl", VERDICT_STYLE[matchup.verdict])}>
              {verdictLabel(matchup.verdict)}
            </p>
          </div>
          <p className="text-muted-foreground font-mono text-sm tabular-nums">
            {matchup.score > 0 ? "+" : ""}
            {matchup.score} <span className="text-xs">de 10</span>
          </p>
        </div>

        <div className="bg-background/70 relative h-2 overflow-hidden rounded-full">
          <div className="bg-border-strong absolute inset-y-0 left-1/2 w-px" />
          <div
            className={cn(
              "absolute inset-y-0 w-1.5 rounded-full",
              matchup.score > 1.5
                ? "bg-advantage"
                : matchup.score < -1.5
                  ? "bg-disadvantage"
                  : "bg-even",
            )}
            style={{ left: `calc(${barPosition}% - 3px)` }}
          />
        </div>

        {matchup.isOverride && (
          <p className="text-muted-foreground text-[11px]">
            Confronto revisado à mão: as características gerais não capturam a mecânica que decide
            essa rota.
          </p>
        )}

        <div className="border-border-strong grid gap-3 border-t pt-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium">
              Risco de gank:{" "}
              <span
                className={cn(
                  matchup.gankRisk.level === "ALTO" && "text-disadvantage",
                  matchup.gankRisk.level === "MÉDIO" && "text-even",
                  matchup.gankRisk.level === "BAIXO" && "text-advantage",
                )}
              >
                {matchup.gankRisk.level}
              </span>
            </p>
            <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
              {matchup.gankRisk.reason}
            </p>
          </div>

          {/* A lista de contribuições matemáticas ('Sem fuga vs Prende de verdade') foi removida para simplificar a UI */}
        </div>
      </div>

      {/* termômetro de combate ao vivo */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Termômetro de Combate</h3>
        <div className="panel p-4">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p
                className={cn(
                  "text-lg font-bold",
                  combatSnapshot.posture === "AGRESSIVO" && "text-advantage",
                  combatSnapshot.posture === "NEUTRO" && "text-gold",
                  combatSnapshot.posture === "RECUADO" && "text-even",
                  combatSnapshot.posture === "PERIGOSO" && "text-disadvantage",
                )}
              >
                {combatSnapshot.postureLabel}
              </p>
              <p className="text-muted-foreground mt-1 max-w-xl text-[11px] leading-relaxed">
                {combatSnapshot.postureDetail}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                Poder Relativo
              </p>
              <p className="font-mono text-sm">
                <span className="text-advantage">{combatSnapshot.selfPower}</span>
                <span className="text-muted-foreground mx-1.5">vs</span>
                <span className="text-disadvantage">{combatSnapshot.enemyPower}</span>
              </p>
            </div>
          </div>

          <div className="relative mb-2 h-2.5 w-full overflow-hidden rounded-full bg-background">
            <div
              className={cn(
                "h-full transition-all duration-500",
                combatSnapshot.winChance >= 65 ? "bg-advantage" : combatSnapshot.winChance >= 50 ? "bg-gold" : combatSnapshot.winChance >= 35 ? "bg-even" : "bg-disadvantage"
              )}
              style={{ width: `${combatSnapshot.winChance}%` }}
            />
            <div className="absolute inset-y-0 left-1/2 w-px bg-border/50" />
          </div>
          <div className="flex justify-between text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            <span>Chance de Vitória</span>
            <span>{combatSnapshot.winChance}%</span>
          </div>
        </div>
      </div>

      {/* radar de ameaças */}
      {threatRadar && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Radar de Ameaças 5v5</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="panel p-4 border-advantage/50">
              <p className="text-advantage text-[10px] font-semibold tracking-wider uppercase mb-1">
                Foque nele
              </p>
              <div className="flex items-center gap-2 mb-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={threatRadar.easiestTarget.champion.iconUrl ?? ""} alt="" className="size-6 rounded-sm border border-border" />
                <p className="text-sm font-bold text-foreground">{threatRadar.easiestTarget.champion.name}</p>
              </div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                Você tem a maior vantagem matemática aqui ({threatRadar.easiestTarget.winChance}% chance de vitória). <strong>{threatRadar.easiestTarget.postureLabel}</strong>.
              </p>
            </div>
            
            <div className="panel p-4 border-disadvantage/50">
              <p className="text-disadvantage text-[10px] font-semibold tracking-wider uppercase mb-1">
                Evite Bater de Frente
              </p>
              <div className="flex items-center gap-2 mb-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={threatRadar.hardestTarget.champion.iconUrl ?? ""} alt="" className="size-6 rounded-sm border border-border" />
                <p className="text-sm font-bold text-foreground">{threatRadar.hardestTarget.champion.name}</p>
              </div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                Ele é o inimigo mais perigoso no momento ({threatRadar.hardestTarget.winChance}% chance de vitória). <strong>{threatRadar.hardestTarget.postureLabel}</strong>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* runas */}
      {runes && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Runas Recomendadas</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="panel p-4">
              <p className="text-gold-dim text-[10px] font-semibold tracking-wider uppercase mb-1">
                Primária: {runes.primaryTree}
              </p>
              <p className="text-sm font-bold text-gold">{runes.keystone}</p>
              <p className="text-muted-foreground mt-1.5 text-[11px] leading-relaxed">
                {runes.keystoneReason}
              </p>
            </div>
            <div className="panel-plain p-4">
              <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase mb-1">
                Secundária: {runes.secondaryTree}
              </p>
              <p className="text-sm font-bold text-foreground">Defensiva / Utilidade</p>
              <p className="text-muted-foreground mt-1.5 text-[11px] leading-relaxed">
                {runes.secondaryReason}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* plano */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">O que fazer agora</h3>
        <ol className="grid gap-3 sm:grid-cols-3">
          {plan.map((step, i) => (
            <li key={i} className="panel-plain p-4">
              <p className="text-gold-dim text-[10px] font-semibold tracking-wider uppercase">
                Passo {i + 1}
              </p>
              <p className="mt-1 text-sm font-medium">{step.title}</p>
              <p className="text-muted-foreground mt-1.5 text-[11px] leading-relaxed">
                {step.detail}
              </p>
            </li>
          ))}
        </ol>
      </div>

      {/* direção de build */}
      {itemization.buildPath.paths[0]?.score > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Direção de build recomendada</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {itemization.buildPath.paths.map((p) => {
              const isTop = p.path === itemization.buildPath.recommended;
              return (
                <div
                  key={p.path}
                  className={cn(
                    "panel-plain rounded-sm p-3 transition-colors",
                    isTop && "panel border-gold/60",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={cn("text-xs font-semibold", isTop ? "text-gold" : "text-muted-foreground")}>
                      {isTop && "★ "}{p.label}
                    </p>
                    <span className={cn("font-mono text-[11px] tabular-nums", isTop ? "text-gold" : "text-muted-foreground/60")}>
                      {p.score}
                    </span>
                  </div>
                  {p.reasons.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {p.reasons.map((r, j) => (
                        <li key={j} className="text-muted-foreground text-[10px] leading-snug">· {r}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* itens */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">
          Build Completa Recomendada{focusChampion ? ` contra ${focusChampion.name}` : ""}
        </h3>
        {itemization.recommendations.length === 0 ? (
          <p className="panel-plain text-muted-foreground border-dashed p-5 text-center text-xs">
            Nada urgente a comprar por causa do inimigo — siga sua build de sempre. Adicione os itens
            que ele comprar e isso muda.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {itemization.recommendations.map((rec, i) => (
              <article key={rec.item.id} className={cn("panel-plain flex flex-col p-4", i === 0 && "panel")}>
                <div className="flex items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={rec.item.iconUrl ?? ""} alt="" className="portrait size-12" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{rec.item.name}</p>
                    <p className="text-muted-foreground text-[11px]">
                      {rec.item.totalGold} de ouro
                    </p>
                  </div>
                </div>

                <ul className="mt-3 flex-1 space-y-1.5">
                  {rec.reasons.map((reason) => (
                    <li key={reason.slug} className="text-[11px] leading-relaxed">
                      <span className="text-gold font-medium">{reason.title}: </span>
                      <span className="text-muted-foreground">{reason.explanation}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-4 pt-3 border-t border-border/50">
                  <button
                    type="button"
                    onClick={() => onEquip(rec.item.id)}
                    className="w-full rounded-sm bg-gold/10 hover:bg-gold/20 text-gold transition-colors py-1.5 text-xs font-semibold"
                  >
                    + Equipar
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}

        {focusChampion && (
          <div className="panel-plain grid grid-cols-2 gap-3 p-3 text-center sm:grid-cols-5">
            <Stat label="Vida dele" value={itemization.context.threat.totalHealth} />
            <Stat
              label="Armadura"
              value={itemization.context.threat.armor}
              hint="defesa dele contra dano de ataque"
            />
            <Stat
              label="Resistência mágica"
              value={itemization.context.threat.magicResist}
              hint="defesa dele contra dano mágico"
            />
            <Stat
              label="Aguenta de ataque"
              value={itemization.context.threat.effectiveHpVsPhysical}
              hint="dano físico necessário para derrubá-lo"
            />
            <Stat
              label="Aguenta de magia"
              value={itemization.context.threat.effectiveHpVsMagic}
              hint="dano mágico necessário para derrubá-lo"
            />
          </div>
        )}
      </div>

      {/* composição */}
      {enemyTeam.champions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">O time deles</h3>
          <div className="panel-plain space-y-4 p-4">
            <div>
              <div className="mb-1.5 flex justify-between text-[11px]">
                <span className="text-disadvantage">
                  Dano de ataque {enemyTeam.physicalShare}%
                </span>
                <span className="text-hex">Dano mágico {100 - enemyTeam.physicalShare}%</span>
              </div>
              <div className="bg-hex/40 h-2 overflow-hidden rounded-full">
                <div
                  className="bg-disadvantage/70 h-full"
                  style={{ width: `${enemyTeam.physicalShare}%` }}
                />
              </div>
              <p className="text-muted-foreground mt-2 text-[11px] leading-relaxed">
                {enemyTeam.damageVerdict}
              </p>
            </div>

            {enemyTeam.warnings.length > 0 && (
              <ul className="border-border-strong space-y-1.5 border-t pt-3">
                {enemyTeam.warnings.map((w, i) => (
                  <li key={i} className="text-even text-[11px] leading-relaxed">
                    ⚠ {w}
                  </li>
                ))}
              </ul>
            )}

            {enemyTeam.threats.length > 0 && (
              <div className="border-border-strong border-t pt-3">
                <p className="text-muted-foreground mb-2 text-[10px] tracking-wider uppercase">
                  Quem mais te ameaça
                </p>
                <ul className="space-y-1.5">
                  {enemyTeam.threats.slice(0, 3).map((t) => (
                    <li key={t.champion.id} className="flex items-center gap-2.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={t.champion.iconUrl ?? ""} alt="" className="portrait size-8" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium">{t.champion.name}</p>
                        <p className="text-muted-foreground text-[10px]">{t.why}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div title={hint}>
      <p className="text-muted-foreground text-[10px] leading-tight">{label}</p>
      <p className="font-mono text-sm tabular-nums">{value}</p>
    </div>
  );
}
