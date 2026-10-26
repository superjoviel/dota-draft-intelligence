# Dota Draft Intelligence

A local-first web MVP for estimating a Dota 2 match outcome from a pre-match draft and historical team, player, and hero results.

## Run it

Open `index.html` in a modern browser. No installation, account, server, or network access is required. Import a CSV of completed matches, enter the two teams' names, five players, and five drafted heroes, then select **Estimate outcome**.

Imported match data stays in browser memory and is not uploaded or saved. Reloading the page clears it.

## Historical match CSV

The app expects one completed match per row with these columns:

| Column | Value |
| --- | --- |
| `radiant_team`, `dire_team` | Team names |
| `radiant_players`, `dire_players` | Five player names, separated by semicolons |
| `radiant_heroes`, `dire_heroes` | Five hero names, separated by semicolons |
| `radiant_win` | `true` / `false`, `1` / `0`, or `radiant` / `dire` |

Names are matched without regard to letter case or extra spaces. The CSV may have additional columns, which are ignored. Use **Download CSV template** in the app to get a header-only template. The input must contain at least one valid completed match.

## How the estimate works

This first version is a transparent, smoothed statistical baseline, not a trained machine-learning model or a guarantee of match outcome. It combines each team's historical win rate, the entered players' historical win rates, drafted heroes' historical win rates, and observed results for opposing hero pairs. Team, player, and hero win rates are smoothed toward 50%; hero matchup results are smoothed toward the dataset's Radiant win rate to reduce the impact of small samples. The estimate shows evidence counts and is limited to a 5%-95% range to avoid implying certainty.

Data quality and sample coverage matter: use completed matches played under reasonably comparable conditions, keep team/player/hero names consistent, and ensure each historical row reflects the correct pre-match draft and result. This MVP does not fetch data from OpenDota or another provider; an API-backed ingestion pipeline and a model evaluated on held-out matches are future work.
