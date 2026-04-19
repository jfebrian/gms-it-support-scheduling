# `data/` — GMS App Data Directory

All files here are committed to git. This directory is the source of truth for app state.

## Layout

| Path | Format | Source | Purpose |
|------|--------|--------|---------|
| `settings.yaml` | YAML | hand-edited | App-level config (polling intervals, defaults, i18n) |
| `regions.yaml` | YAML | hand-edited | List of GMS regions |
| `churches.yaml` | YAML | hand-edited | Local churches + weekly service/shift templates |
| `volunteers.yaml` | YAML | hand-edited | IT Support roster with constraints |
| `youtube_channels.yaml` | YAML | hand-edited | Region-keyed YouTube channels |
| `schedules/YYYY-MM.yaml` | YAML | hybrid | Week overrides (human) + assignments (generated) |
| `unavailability/YYYY-MM.yaml` | YAML | hand-edited | Per-volunteer one-off unavailable dates |
| `events/YYYY-MM-DD-<slug>.yaml` | YAML | hand-edited | Ad-hoc event services with their own services/shifts/assignments |
| `fairness/YYYY-MM.json` | JSON | machine-generated | Hours-per-volunteer + running balance |
| `incidents/YYYY-MM-DD-<slug>.json` | JSON | machine-generated | Detected livestream issues |

## Rules

- **Never commit secrets** (API keys, credentials). Put those in `.env`.
- YAML files use LF line endings (enforced via `.gitattributes`).
- All files validate against Zod schemas in `src/lib/schemas.ts` on load and save.
- Never rename an entity `id` after data has been written against it.

## Canonical reference

See [`brain/context/data-model.md`](../../brain/context/data-model.md) at the workspace root for the full data-model specification.
