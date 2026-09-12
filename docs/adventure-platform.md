# The adventure platform — design contract

The game reached by right-clicking the User Guide window control. This
document is the source of truth for HOW THE GAME IS BUILT;
`src/escapeMenu/escapeMenuContract.ts` is the source of truth for how it
reaches the screen. Read both before changing either.

Two things are deliberately separated here, and conflating them is what went
wrong with the first attempt:

- The **platform** (`src/adventure/`) is a director and a set of stages. It
  knows about screens, choices, stacks, saves and effects. It contains no
  rules.
- The **game** is Thockquest (`src/adventure/content/thockquest.ts`), which
  is data. A second game would be a second content file, not a second
  engine.

## The ring is an input device

The escape-hold ring says how a choice is expressed — an icon and a few
words — and how many will fit. It says nothing about the bookkeeping
underneath, and the bookkeeping owes it nothing. There are exactly three
channels:

| Channel | Carries |
| --- | --- |
| the ring | one question's choices, as icon + short label |
| the tab bar | the stats readout — or, while a choice is focused, that choice's own effects |
| the chapter bar | narration: what just happened, and the frame for what is being asked |

State goes up and narration goes down, and that is a rule rather than a
layout convenience: a reader's eye goes up for "how am I doing" and down for
"what is going on", the same way it does for a note's tabs and its chapters.
`src/escapeMenu/EscapeMenuStatus.tsx` renders each half into the bar it
belongs to.

## Director and stages

```
                 ┌──────────── the director ─────────────┐
  player input ─►│  a stack of stage frames               │
                 │  + narration + rng + the core cells    │
                 └──┬─────────────────────────────────┬───┘
                    │ present(state)                  │ resolve(state, choice)
                    ▼                                 ▼
                 ┌── the stage on top ────────────────────┐
                 │  pure functions over JSON state        │
                 └────────────────────────────────────────┘
                                                      │ effects
                                                      ▼
                                     the save (model/gameState.ts)
```

A **stage** is a collection of pure functions the director calls with state
and gets results from. It owns one part of the game, emits one or more
**screens**, and hands off. It does not touch the ring, does not persist
anything, does not know another stage exists, and **never writes** — it
returns *effects* describing what should change, and the director applies
them. That is what keeps a stage testable without a database and keeps every
write in one place.

A **service** is a pure function a stage calls that never speaks to the
player: a stat check (`model/checks.ts`), an armor absorb (`model/armor.ts`),
stat resolution (`model/modifiers.ts`). Enemy generation and combat
resolution will be services.

### A stack, not a current stage

Looking at your traits is reachable from every screen and must give back the
screen you were on; a fight has decisions inside it that are not the fight.
One "current stage" could only express that by making every stage save and
restore its own suspended state — the same mechanism written once per stage
instead of once in the director.

### Three rules the types enforce

1. **Stage state is `JsonObject`.** No closures, no class instances, no Maps.
   The player can leave at *any* screen and come back to it, which is only
   true if every frame survives a round trip through disk.
2. **`present` receives no random state.** Every roll happens in `enter` or
   `resolve`, and its outcome is stored in stage state until it is shown. A
   stage that rolled while building its cells would make the draw order
   depend on how many times React re-rendered, and the game would stop being
   replayable with no symptom at all.
3. **`present` cannot return effects.** Looking at a screen changes nothing.

Rule 2 is also a design rule: **choices are pre-resolved.** "Dodge" appears
because the dodge roll already succeeded, so picking it cannot fail. The ring
tells you what is possible, which is how a stat point shows itself — as
options appearing, rather than as a number you are asked to trust.

### Determinism

A game is replayable from its seed plus the ordered list of choices taken,
which is what makes a defect *reportable* rather than merely describable. The
director owns the clock; no stage ever sees one. Tested as a property
(`core/director.test.ts`), including a separate test that `present` is pure —
the replay test alone does not catch a roll in `present`, because a screen is
not part of the save. (Verified by injecting one: it passes replay and fails
the purity test.)

## The ring is the game, so it cannot outlive it

A mode may declare `onDismiss` (`src/escapeMenu/escapeMenuContract.ts`). The
adventure wires it to leaving, because lowering the ring — Escape, or a cell
that does not keep the menu open — otherwise left the slot occupied by an
empty editor with the window control still lit: a view whose effects the
player can see but which they cannot reach.

And the ring cannot be missing while the game is up either: a mode owning a
slot IS an open ring, derived rather than arranged by whoever opened it
(`App.tsx`'s `isEscapeRingUp`). Reloading mid-game is what exposed the
difference — the overlay is persisted and came back, "the reader raised the
ring" is transient and did not, so the slot returned occupied with nothing
in it.

The converse holds too, and it is the same observation from the other side:
**a note arriving in a slot lowers the ring.** In a note the text is the
content and the ring is a menu over it; for a mode the ring *is* the content.
So a ring left up over a note the reader just chose is a menu they did not
ask for, sitting on top of the thing they did. Only an arriving note counts —
opening the adventure empties its slot and raises the ring in one gesture,
and treating that as a switch would close the ring on the way in.

Which slot is showing what is not the game's business at all. It is one
record and one derivation, shared with the User Guide and undocked notes —
see `src/shared/slotOverlay.ts`, whose invariant is that stored state may
never contradict the screen.

## Two stores

- **Content** (`content/`) ships with the app, is never written, and changes
  every release. TypeScript data, validated by a test.
- **Save** (`model/gameState.ts`) belongs to the player and is migrated.

Save refers to content **by id** and tolerates an id content no longer has —
dropped, never crashed on. That is what lets an item or a region be deleted
without breaking somebody's game.

The save is shaped as **tables** — `profile` is a row, `games` are rows,
`holdings` and `outcomes` are rows keyed by game id — even though it is
currently written as one JSON document through the app-state path
(`electron/stateService.ts`'s `sanitizeMenu`, per CLAUDE.md's two halves).
Moving it into `electron/databaseService.ts` is then an insert loop per array
rather than a redesign. The one deliberate exception is the director's stack,
which holds opaque stage state and is a blob wherever it lives.

**Outcomes gain rows, not columns.** New content introduces a new `outcome`
kind and touches no schema; a column per content addition would make content
the opposite of additive.

## The model

**Six stats**, declared in `model/stats.ts`: Might, Agility, Perception,
Intellect, Charisma, Luck. Base stats cap at **6**; items and traits are what
carry you past it, which is why effective stats resolve in one documented
order (`model/modifiers.ts`):

```
clamp(base, 0..6) → + stat deltas → derive → × scales → + deltas → normalize
```

**Stat checks**: roll a D6, add the Difficulty Rating, pass if the stat
matches or exceeds the total. The die is the *opposition*, not the player's
contribution — the inverse of the common tabletop convention, and it reads
identically in prose, so it is worth stating. A check also reports a **tier**,
because some content reads in degrees: a track gives "some sort of creature"
at a bare pass and "a hulking orc warrior" at a wide one.

**Modifier effects are declarative data, not code.** The tab bar shows an
item's effect while its cell is focused, and that text has to be *live* —
"Avid Collector: +30% damage (3 items)" is true only if the number comes from
the same declaration the resolver applies. One vocabulary produces both the
maths and the words. `tag` is the escape hatch for effects the vocabulary
cannot express; that one carries written prose, because nothing else can.

Effects come in two kinds, and the distinction is load-bearing: **passive**
(re-applied whenever the profile resolves) and **on-acquire** (fired once,
changes state). Armor is the reason.

**Armor is not a stat.** Every other stat is static for a level; armor is
*spent*. Two pools — `fromItems`, which decay can touch, and `natural` from
traits, which it cannot — because one number could not express a trait that
grants armor decay cannot reach. It is rebuilt at the start of each level, so
an item carried over counts as a fresh acquisition.

## What is built, and what is not

Built and exercised end to end: the director, the stack, the effect
vocabulary, the save and its sanitizer, stats, modifiers, armor, checks,
determinism, and the stages for welcome, character creation, region select,
the encounter hub, and the two acquired-\* interludes.

**Not built, on purpose**: hunting, exploring, chance encounters, combat and
loot. Their rules are still being written — the action economy, what the
damage multiplier multiplies, what a region's pools contain — and the
platform routes them to a stage that says so *in the game* rather than
stubbing them with plausible behaviour. That is how the previous draft
acquired numbers nobody chose and then defended them.

Content is perhaps a third written. Every placeholder is labelled: an entry
that exists by name but whose effect is undecided carries a `tag` effect
saying exactly that, so it shows up in the tab bar as unspecified rather than
as a number somebody would have to guess was real. **Do not fill these in.**

## Open questions

These block a playable game and want answers rather than guesses.

1. **The tab bar is not focus-sensitive yet.** A choice's `detail` is computed
   and carried on every `Choice`, but the escape-menu contract has no way to
   show it: `EscapeMenuModeStatus` is static for as long as a mode is up.
   Needs an additive field on the shared contract.
2. **Readouts have no icons.** The design's status line is written in icons;
   the contract's readout is a short label and a value.
3. **Motes: spent or banked?** Experience buys traits at the start of a level
   *and* accumulates toward a stat point at `10 + 5 × points acquired`.
   Whether spending on a trait also consumes progress toward the threshold is
   undecided, so the tab bar does not show "motes until next point".
4. **Resilience.** The design writes hit points as `50 + 15 × Resilience`, and
   Resilience is not one of the six stats — but the formula is written under
   Might, and is read against Might here. Seventh stat, or a slip?
5. **Player base damage.** The damage *multiplier* is specified; what it
   multiplies is not.
6. **Intellect and Charisma** have unlocks (spells, charisma actions) rather
   than curves, and neither list is written. They are declared stats with real
   effects pending.
7. **Enemy scaling, fame, experience and gold rates, and the action economy.**
   All unwritten.
8. **Ring capacity.** Nine stage choices plus the three the director always
   adds is the working cap (`core/screen.ts`). Not yet checked against the
   rendered dial at twelve cells.
9. **Regions** currently carry a name and nothing else: which encounters and
    monsters each brings into scope is unspecified.
10. **A second game slot.** The save is shaped for it (`games` is a list,
    `activeGameId` says which is live), and "Continue previous adventure"
    re-enters at the encounter hub rather than at the exact screen left,
    because leaving a game currently discards its stack rather than
    suspending it into its row.
11. **Armor decay's curve.** "A chance based on luck" is specified; the curve
    is not. `ARMOR_DECAY_TUNING` is a labelled placeholder, not a tuned value.
