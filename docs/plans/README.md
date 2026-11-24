# Implementation Roadmap

Source of truth for requirements and architecture:
[`docs/architecture/platform-plan.md`](../architecture/platform-plan.md).

The platform is too large for one implementation plan, and later phases
depend on Phase 0 measurements (Keepa coverage, US stock observability,
ASIN match rate, listing-restriction split). Work is therefore split into
one plan per phase or subsystem. Each plan produces working, tested
software on its own. A plan is written in full, with task-level steps,
only when its phase is about to start, so it can use what earlier phases
learned.

## Plans

| # | Plan | Platform-plan phase | Status | Depends on |
|---|------|---------------------|--------|------------|
| 0 | Discovery and technical validation (non-code checklist + spike scripts) | Phase 0 | Not written | — |
| 1 | [Platform foundation](2026-11-23-phase-1-platform-foundation.md) | Phase 1 | **Done (staging deploy pending)** | — |
| 2 | Product research: Keepa provider, CA/MX storefront discovery, US matching, eligibility filters, research UI | Phase 2 | Not written | 1, Phase 0 Keepa findings |
| 3 | Pricing and FX: CurrencyAPI provider, fee/tax/duty rules, rate cards, pricing engine, competitor monitoring via SP-API notifications (SQS), dry-run review UI | Phase 3 | Not written | 1, 2 |
| 4 | Inventory and listings: stock signals and buffer rules, JSON listings feeds, Listings Restrictions checks, standing attestations, approval queue | Phase 4 | Not written | 2, 3 |
| 5 | Orders and purchasing: SP-API order intake, order state machine, buyer-PII storage and purging, Amazon Business Ordering API, transactional outbox | Phase 5 | Not written | 4 |
| 6 | Warehouse and shipping: receiving, matching, consolidation, carrier/Buy Shipping providers, labels, tracking, shipment confirmation | Phase 6 | Not written | 5 |
| 7 | Financial reporting: Finances API ingestion, order/daily P&L, Statistics UI, daily email | Phase 7 | Not written | 5, 6 |
| 8 | Production hardening and Canada rollout | Phase 8 | Not written | 1–7 |

Plan 0 can run in parallel with Plan 1. Plan 0's spike scripts can be
built on Plan 1's provider and integration-log foundations once Task 5
of Plan 1 is done.

## Conventions shared by all plans

- Plans live in `docs/plans/YYYY-MM-DD-<name>.md` and use checkbox
  steps so progress can be tracked in the file.
- TDD: write the failing test, run it to see it fail, implement, rerun,
  commit.
- One commit per task at minimum. Commit messages use the
  `feat:`/`fix:`/`chore:`/`docs:`/`test:` prefixes.
- At the end of each plan: run `pnpm lint && pnpm build && pnpm typecheck && pnpm test`,
  update this table's status, and report completed work, limitations,
  and next tasks (platform plan §13 rule 19).
