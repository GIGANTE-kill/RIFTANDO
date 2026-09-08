# Riftando

Análise tática de partidas de LoL: matchup de rota, prioridades e itemização de
counter — tudo por regras determinísticas, **sem nenhuma API de IA no back-end**.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind v4 + shadcn/ui · PostgreSQL + Drizzle

## Setup

```bash
npm install
npm run db:push                 # cria as 12 tabelas
npm run sync                    # baixa patch, campeões e itens
npm run tags:derive             # deriva as tags táticas
npm run db:seed                 # carrega as regras de matchup e contra-item
npm run dev
```

### Banco

Por padrão o projeto usa **PGlite** (`DATABASE_URL="file:./.pglite"`): o Postgres
compilado para WASM, embutido, sem instalar nada. Não é emulação — enums, arrays
e jsonb se comportam igual ao servidor.

> ⚠️ PGlite é **single-writer**: pare o `npm run dev` antes de rodar `sync`,
> `tags:derive` ou `db:seed`, senão o script não consegue abrir o banco.

Para um servidor de verdade: `docker compose up -d` e troque o `DATABASE_URL` no
`.env.local` pela linha comentada. Nenhuma query muda.

## Fontes de dados

| Dado | Fonte | Por quê |
|---|---|---|
| Versão do patch, stats e habilidades de campeão | Data Dragon (Riot) | oficial, atualiza a cada patch |
| Catálogo de itens (categorias, build tree, passivas) | CommunityDragon | 868 itens, categorias mantidas pela Riot |
| Stats numéricos de item | Data Dragon + parse do bloco `<stats>` | o DDragon não expõe Ability Haste/penetração/tenacidade |
| Nomes de campeões e itens | Data Dragon `pt_BR` | a tela fala português |
| Tipo de dano, dificuldade e estilo de jogo | CommunityDragon `champions/{id}.json` | é a própria classificação da Riot, melhor que inferir do texto |
| Em que rota cada campeão joga | Meraki `positions` | **única** fonte pública disso |

> **Sobre as rotas.** A Riot não publica em lugar nenhum que Lux joga meio e
> suporte. A única fonte pública é a Meraki, congelada em agosto de 2025. Isso é
> aceitável só aqui: a rota de um campeão muda devagar, enquanto os números de
> dano mudam todo patch — por isso os stats vêm do Data Dragon e apenas as rotas
> vêm dali. Campeão que a Meraki não conhece (hoje 2) tem a rota estimada pela
> classe, e o sync avisa quando isso acontece.

**Duas línguas, dois papéis.** `en_US` é a língua da *lógica*: o derivador lê os
marcadores e as palavras-chave dos tooltips em inglês (`<status>Stunned</status>`,
"Grievous Wounds"). `pt_BR` é a língua da *tela*. O sync busca as duas e usa cada
uma no seu lugar — trocar o idioma de exibição não quebra nenhuma heurística.

> A Meraki Analytics (`lolstaticdata`) foi descartada: o `champions.json` dela está
> congelado desde agosto de 2025 e serviria stats de um ano atrás.

**Filtro de itens.** O CDragon lista 696 itens "na loja", incluindo Arena, Swarm e
itens já removidos do jogo (Deathfire Grasp, Prowler's Claw). Recomendar um deles
seria um bug grave, então cruzamos com o `maps["11"]` do Data Dragon e ficamos com
os **218 itens reais do Summoner's Rift** — 105 deles lendários.

## Assistente de seleção

A primeira aba é a fase de escolha: bans, os 5 contra 5 por rota e, a cada pick
do inimigo, **quem pegar em resposta**. A lista dentro de cada slot já vem
filtrada pela rota e ordenada pela recomendação — o draft dura segundos.

**O que este motor não é: um tier list.** Taxa de vitória real só existe em API
paga ou raspagem de site, e nenhuma das duas entra aqui. "Melhor escolha"
significa *melhor resposta ao que já está no quadro*, somando quatro coisas:

| Componente | O que responde |
|---|---|
| Confronto direto | quem vence a rota contra o campeão que o inimigo já pegou |
| Pick cego | quando o inimigo ainda não escolheu: média do confronto contra **todos** os campeões da rota — literalmente "seguro de pegar sem saber o que vem" |
| Buraco na composição | falta dano mágico, frente de batalha, iniciação ou controle |
| Dupla de rota | atirador frágil pede suporte que protege; atirador de all-in pede suporte que inicia |

O peso do confronto muda por rota, e isso importa: topo e meio **são** um duelo,
mas suporte joga 2 contra 2 e vale pela utilidade. Sem essa distinção a lista de
suportes vinha encabeçada por Camille e Shaco. Os eixos de utilidade, controle e
mobilidade são os oficiais da Riot (`playstyleInfo`), não palpite.

O mesmo cuidado vale para o atirador: o motor de duelo dizia — corretamente —
que Yasuo vence Caitlyn no 1 contra 1, e por isso o colocava como melhor
atirador. Péssimo conselho: a rota de baixo não é um duelo. Quem aparece em três
rotas está de passagem na rota de baixo, e o motor agora sabe disso.

**Chances de composição** somam os confrontos das cinco rotas (com o peso de cada
uma) mais o equilíbrio de frente de batalha, controle e escalonamento. O
resultado fica preso entre 25% e 75% de propósito: composição pesa, mas quem joga
melhor ainda ganha.

## A tela

Uma tela só, em três passos: **você** (rota + campeão), **time inimigo** (os 5 por
rota) e **como está a partida agora** (minuto, nível, ouro, itens seus e do
inimigo). Abaixo, a leitura: situação da rota, o que fazer agora, próximos itens
e a composição deles.

- **Quem é seu inimigo principal sai da rota.** Topo, selva e meio enfrentam a
  mesma rota; a rota de baixo é 2 contra 2, então o atirador tem o atirador
  inimigo como confronto direto e o suporte como segunda ameaça (`opponentsFor`).
- **O plano muda com o minuto.** Antes dos 14 é o confronto de rota; até os 26 é
  visão e objetivo; depois disso é luta em grupo e Barão (`buildGamePlan`).
- **A partida sobrevive ao F5**: o estado fica no `localStorage`, porque você está
  jogando enquanto usa.
- **Nada de sigla na tela.** Toda tag tem um `label` em português no
  `tag-catalog.ts`; o `slug` nunca aparece para o jogador.

## Arquitetura

- `src/db/schema/` — 12 tabelas. Stats são **versionados por patch** (PK composta
  `(entidade, patch)`), então o diff entre versões é um `JOIN` entre dois `patchId`.
- `src/engine/` — núcleo determinístico, TypeScript puro, sem React nem DB.
  Recebe estado, devolve recomendação. É o que dá para testar unitariamente.
- `scripts/` — ingestão, derivação de tags e seed de regras. Todos idempotentes.

### Motor de itemização

`src/engine/itemization.ts` transforma o estado da partida num contexto de
métricas (`threat.totalHealth`, `self.primaryDamageType`, `enemyTeam.healingSources`),
avalia as regras do banco via o DSL e ranqueia os próximos itens. O score de cada
item é o produto de quatro fatores:

| Fator | Por quê |
|---|---|
| `priority` da regra | urgência do problema (corta-cura 95 > tenacidade 70) |
| `finality` | item final vale mais que componente |
| `fit` | afinidade item↔campeão — sem isso o motor sugere Thornmail para a Lux |
| `magnitude` | 80 de RM resolve mais que 25; sem isso o desempate cai no mais barato |

Roda no cliente (é TS puro), então a recomendação recalcula a cada clique sem
ida ao servidor. `npm run engine:smoke` roda cenários reais contra o banco.

**Nem todo item do catálogo é recomendável.** Os 218 itens do Summoner's Rift
incluem poção, sentinela, bugiganga, item de selva, item de renda de suporte e a
Lança Negra da Kalista — e todos podiam ser sugeridos, porque uma Poção de Vida
tem vida e a regra de vida a aceitava. `isRecommendable` corta por categoria, por
exclusividade de campeão e por preço mínimo (abaixo de 700 é item inicial).

Itens de suporte não se declaram: o Berrante do Guardião não tem categoria que o
denuncie. Mas todos descendem do Atlas Mundial, que tem `GoldPer` — então o
motor sobe a árvore de construção para descobrir.

**O tipo de dano vem da Riot, não das tags.** A ultimate da Ashe causa dano
mágico, o que fazia a inferência classificá-la como "dano misto" e recomendar
Morellonomicon para uma atiradora. `officialDamageType` (do CommunityDragon)
resolveu isso.

**Item que só rende batendo, para quem não bate.** O Coração de Aço é
`[Health, HealthRegen]` para a Riot — a categoria `OnHit` não o cobre — e todo o
efeito dele é *"seu próximo Ataque contra o alvo causa..."*. Como item de vida
qualquer, ele era oferecido a magos. O motor agora lê o texto da passiva, mas com
uma lista de exclusão antes: Armadura de Espinhos diz *"When struck by an
Attack"*, e apanhar não é atacar.

**Crítico para tanque.** Crítico só compensa acumulado com velocidade de ataque
e mais crítico; um tanque com 25% de chance está jogando ouro fora. Era por isso
que o Sion recebia Lembrete Mortal.

**A rota importa mais que a classe.** A Lux é `Mage/Support` para a Riot, então
recebia Bênção de Mikael jogando no meio. O motor passou a receber a sua rota:
mesma campeã, no meio recebe Véu da Banshee; de suporte, recebe Mikael.

`npm run items:audit` roda o motor para os 173 campeões contra 4 tipos de ameaça
— 688 análises — e denuncia toda recomendação que não serve àquele campeão. Foi
assim que os problemas acima apareceram, e é o teste que impede a volta deles.

Os stats da ameaça usam a **fórmula oficial de crescimento por nível** da Riot,
que não é linear: `base + growth × (n−1) × (0.7025 + 0.0175 × (n−1))`. A
aproximação linear erra ~14% no nível 18 e jogaria os limiares das regras
(3000 de vida, 120 de armadura) fora.

### Motor de matchup

`src/engine/matchup.ts` cruza as tags dos dois campeões contra as 24 regras de
confronto do banco e devolve um placar de -10 a +10, as contribuições que o
formaram, o risco de gank e um plano em 3 passos (rota → wave → mapa).

Três correções vieram de rodar `npm run matchup:smoke` contra confrontos de
resposta conhecida:

- **Contagem dupla.** `RANGED_LONG contra MELEE_SHORT` e a diferença numérica de
  alcance eram o mesmo fato somado duas vezes. Lux x Zed saía como "+4.9 muito
  favorável" para a Lux. Pares de tag de alcance agora são ignorados: o número é
  mais preciso.
- **Alcance sem contexto.** Um atirador assedia com auto-ataque; um mago, com
  habilidade. O alcance agora é escalado pela dependência de auto-ataque.
- **Ameaça que não alcança.** "SQUISHY contra ALL_IN" contava cheio mesmo com 325
  de diferença de alcance e nenhum dash do outro lado. `reachFactor` reduz as
  contribuições do lado mais curto conforme a distância — e um dash as devolve.

**Onde o motor para.** Depois disso, 3 dos 5 confrontos canônicos ainda saíam
errados por mecânica que nenhuma tag captura (a cegueira do Teemo anula os autos
do Darius). Esses vivem em `champion_matchup_overrides`, semeados em
`scripts/seed-rules.ts` — uma linha por confronto, e o override substitui o
placar inteiro. A UI marca quando o resultado veio de curadoria.

### Tags: derivação + curadoria

`npm run tags:derive` infere tags a partir da marcação semântica dos tooltips da
Riot (`<status>Stunned</status>`, `<healing>`, `<physicalDamage>`) e das
`categories` oficiais dos itens. Ele reescreve **apenas** as linhas com
`source='derived'`; qualquer tag marcada como `manual` sobrevive a todo re-sync.
Campeões novos entram sozinhos; suas correções são permanentes.

`npm run sources:smoke` roda o derivador contra as fontes reais sem tocar no banco.
