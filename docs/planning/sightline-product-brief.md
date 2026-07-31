# Sightline — Product Brief

## Problem

On a given NFL Sunday, Kalshi lists dozens of binary player-performance contracts — will this receiver clear 40 yards, will this quarterback throw for 250, will this back score — each priced in cents between 1 and 99. William watches the entire slate, from the early window through the night game, and knows the league well: who is playing hurt, who lost their coordinator, which quarterback-receiver pair is out of sync. What he has no way to do is answer the only question that actually decides a trade: *is 55¢ a good price for this contract, or a bad one?*

That question is quantitative and his knowledge is qualitative, so the two never meet. Today he starts from nothing — no spreadsheet, no projection source, no process. The result is that he either passes on the market entirely or takes positions on instinct with no mechanism to learn from them. Across a season, the cost is not one bad trade; it is that every trade is uninformative. There is no accumulating record, no way to separate a good read from a lucky one, and no way to know whether his fandom is an edge or a liability. The market prices these contracts continuously and settles them publicly, which means the feedback exists — he simply has no instrument pointed at it.

## Target User

The primary user is William: a CS-trained software engineer who builds and operates his own software, and a serious NFL viewer who watches the full Sunday slate whether or not he has a position. He trades on Kalshi, a CFTC-regulated prediction market, rather than through sportsbooks or DFS apps. His technical level is high — he can read a reliability curve, and he wants the model's reasoning exposed rather than hidden behind a verdict. Context of use is Sunday morning before kickoff, checking the day's slate across phone, tablet, or desktop depending on where he is, which makes responsive web the only sensible target.

There is a small secondary audience: a handful of invited friends with view-only accounts. They see the same projections, prices, edges, and recommendations, but they do not trade through Sightline — they place their own positions on Kalshi directly. They are consumers of the product's output, not operators of it. No third audience exists and none is planned.

What William uses today is nothing. Public projection sites publish point estimates with no distribution, no uncertainty, and no connection to a live price, which makes them unusable for the decision he is actually facing.

## Why Now / Why This

Three conditions have converged, and at least one of them is temporary.

First, Kalshi's player-prop catalog is new. The exchange self-certified these contracts under the Commodity Exchange Act, meaning they list without prior approval, and the menu has been expanding through passing, rushing, and receiving yardage and touchdown markets. Volume on secondary markets is a small fraction of what flows through game winners, and the catalog remains thin next to a mature sportsbook's. Young, thin markets are priced less efficiently than old, deep ones. That inefficiency is the entire opening, and it will narrow as the venue matures — which is the argument for building now rather than in three seasons.

Second, the contract format is unusually friendly to a probabilistic model. Kalshi props are binary "will player X reach threshold Y" contracts, and a binary contract's price in cents *is* a probability. A model that outputs a distribution over a player's receiving yards can read off P(≥ 40) and compare it to the market's number directly — no line-to-probability conversion, no vig to strip out, no juice to model. The comparison that would be lossy and approximate against a sportsbook is exact here.

Third, the inputs are free and legally clean. Public NFL play-by-play, roster, depth-chart, and snap-count data covers the modern era; historical weather is available from open APIs; and Kalshi's own API costs nothing beyond the standard per-contract trading fee, providing both live prices and settled outcomes. Settlement is the quiet gift — it means every market Sightline ever evaluates eventually reports its own ground truth, building a private historical record of real prices that cannot be purchased anywhere.

What separates this from a projection site is that Sightline is not trying to predict a stat line. It is trying to find a disagreement between its own belief and a price, and to be honest about how often that disagreement was justified.

## Core Job

Sightline tells William which of today's Kalshi NFL player contracts are mispriced, how much to trust that judgment, and how much to stake on it — and it can act on that judgment autonomously, against simulated money first.

## Success Definition

At 90 days from first production slate, four signals:

**Calibration is the primary measure.** Across every prediction the model has made — not merely the ones traded — the contracts it assigned roughly 60% should hit roughly 60% of the time, and likewise across every probability bucket. Rendered as a reliability curve with a Brier score. This is the metric that matters because it converges: a few thousand predictions is enough to distinguish skill from noise, whereas a season of actual positions is not.

**The model beats naive baselines on backtest.** Chronological backtesting across multiple prior seasons, using only information available before each game, showing lower error than both a season-average and a trailing-five-game baseline. This is checkable before Week 1 ever happens and is the gate for shipping anything downstream of it.

**Positive edge against Kalshi where a market exists.** Treated as directional evidence only. Ninety days is too short a window for this number to be conclusive, and it should never be reported without its uncertainty attached.

**It gets used.** Sightline is open on Sunday mornings, and the override log has accumulated enough take/fade/skip records to begin answering whether William's own reads add value on top of the model. A personal tool that goes unopened has failed regardless of its error metrics.

**The autonomous paper system ran without incident.** Sizing produced no absurd stakes, exposure stayed within caps, circuit breakers behaved as specified, and the paper and live ledgers never touched. This is deliberately an operational and safety measure rather than a profitability one: a few weeks of paper trading yields too few positions for realised P&L to distinguish a working system from a lucky one, whereas comparing Sightline's probabilities against the market's across every contract it priced — traded or not — is far better powered over the same period. Real money is committed on that comparison plus calibration and simulated bankroll paths, never on a win rate.

## Non-Goals

Sightline will not integrate with sportsbooks or DFS platforms. PrizePicks, Underdog, DraftKings and their peers are out permanently — not deferred. Kalshi is the venue.

It will not become a public or commercial product. Access is invite-only to a small closed group, and there is no path contemplated toward open signup, subscriptions, or selling picks.

It will not support live in-game trading. Sightline operates on pre-game state; once the ball is kicked, its projections are stale by design.

It will not ingest film or tape-derived inputs. The model works from structured data — box scores, play-by-play, participation, injury designations, weather, rest, travel. Anything requiring human film study or computer vision is outside the product.

Friends will never trade through the application. Sightline will not store, encrypt, custody, or transmit another person's Kalshi signing credentials, because those credentials carry the authority to move money out of a funded account and a personal side project is the wrong place to operate a custody system. View-only means view-only.

It is not a general sports data browser. Production inference is deliberately scoped to players with live Kalshi markets on a given day. The model is trained and validated on the full historical player universe, but if there is no contract to price, Sightline has nothing to say.

## Riskiest Assumption

**That Sightline can be better calibrated than the market it is trading against.**

This is the belief the entire product rests on, and it is not the same as "can this model predict NFL statistics accurately." Models that comfortably beat a season-average baseline are common; models that beat a price are rare. Every contract Sightline evaluates has already been priced by participants with real money at stake, and the default outcome for a new entrant is to be slightly worse than the market while feeling slightly better than it.

The specific bet is that Kalshi's prop markets are young and thin enough to be exploitably inefficient. If that is true, a well-calibrated model finds real disagreements. If it is false — if these markets are already sharp, or become sharp quickly as volume grows — then Sightline is a well-engineered instrument for measuring its own lack of edge. That failure would still be legible, which is the argument for making calibration the primary success metric rather than profit: the product tells the truth about itself either way.

A compounding version of the same risk: the markets most likely to be mispriced are the thinnest ones, and the thinnest ones are precisely where liquidity may not support a position of meaningful size. Being right about a contract nobody will trade against is indistinguishable from being wrong.

## Open Questions

**Slate depth.** How many Kalshi player-prop contracts actually list on a typical Sunday is unverified. Coverage skews toward star players and the catalog is expanding, but the working number of daily candidates needs an empirical check against a live slate before the PRD commits to a display model. If it turns out to be six contracts, the product is different than if it is sixty.

**Liquidity at the edges.** Related but distinct: whether the mispriced markets are tradeable at size. Needs observation over several real slates rather than a decision now.

**Name availability.** Domain and trademark clearance for "Sightline" is unverified and should be confirmed before the brand work begins, since the rebrand cost compounds with every screen built.
