# 🏥 GrantPath AI

**Multi-agent grant discovery and management platform for health-focused organizations.**

Built for **GHIS LLC** (Global Health Innovation Solutions) — a health innovation consultancy that has implemented $3.2M in health innovation projects across 14 states since 2020.

---

## 🚀 Overview

GrantPath AI automates the full grant lifecycle — from discovery to submission — using a coordinated system of AI agents with enforced Human-in-the-Loop (HIL) checkpoints.

```
Discovery → Assessment → Matching → Writing → Compliance → Review → Submission → Outcome Tracking
```

---

## 🤖 Agent Architecture (11 Backend Functions)

| Agent | GHIS Ticket | Description |
|-------|------------|-------------|
| `grantDiscoveryAgent` | GHIS-001/002 | Crawls Grants.gov every 6h, deduplication + fingerprinting |
| `matchingAgent` | — | Cosine similarity + GPT-4o scoring against org profile |
| `grantWritingAgent` | — | Section-level draft, refine, and full-application generation |
| `complianceAgent` | GHIS-009 | Eligibility + completeness + LLM content quality check |
| `budgetBuilderAgent` | — | IDC rates, fringe calculations, budget narrative |
| `deadlineAgent` | — | Workback scheduler, capacity conflict detection |
| `reviewAgent` | — | 3-persona panel (Technical Expert, Program Officer, Community Stakeholder) |
| `masterNarrativeAgent` | GHIS-005 | Versioned org narrative with diff, conflict detection, pack consistency |
| `hilAgent` | GHIS-007 | Tiered HIL: Tier 1 (blocking) / Tier 2 (48h review) / Tier 3 (auto-approve) |
| `scoringCalibrationAgent` | GHIS-006 | Bayesian weight calibration from real grant outcomes |
| `financialROIAgent` | GHIS-008 | Portfolio ROI, cost-per-award, funder/class analytics |

---

## 🗄️ Data Model (8 Entities)

| Entity | Purpose |
|--------|---------|
| `Grant` | Grants.gov opportunities with metadata, deadlines, eligibility |
| `OrgProfile` | Organization profile (mission, focus areas, compliance, capacity) |
| `GrantMatch` | AI-scored matches with rationale, strengths, concerns |
| `GrantApplication` | Full application workspace (sections, compliance, budget) |
| `MasterNarrative` | Versioned org narrative (GHIS-005) |
| `HILCheckpoint` | Human-in-the-loop decision log (GHIS-007) |
| `CalibrationSnapshot` | Scoring calibration history (GHIS-006) |
| `GrantOutcome` | Award/decline outcomes + ROI tracking (GHIS-008) |

---

## 📱 Pages

- **Dashboard** — Pipeline stats, top matches, urgent deadlines, quick actions
- **Grant Discovery** — Searchable grant database with detail panel + live discovery
- **Grant Matches** — AI-scored matches with score threshold slider + feedback
- **Applications** — Full workspace with section editor, AI draft/refine, compliance
- **Pipeline** — Kanban (11 stages) + list view with deadline alerts
- **Org Profile** — GHIS LLC profile, focus areas, compliance fields

---

## ⚙️ GHIS Engineering Tickets

| Ticket | Shortcoming | Status |
|--------|-------------|--------|
| GHIS-001 | Hallucinated Data | ✅ Addressed in discovery agent |
| GHIS-002 | Web Connectivity | ✅ Grants.gov live crawler |
| GHIS-003 | Error Recovery | ⚠️ Partial |
| GHIS-004 | Agent Redundancy | ❌ Not yet |
| GHIS-005 | Master Narrative Versioning | ✅ Deployed |
| GHIS-006 | Scoring Calibration | ✅ Deployed |
| GHIS-007 | HIL Checkpoint Overload | ✅ Deployed |
| GHIS-008 | Financial/ROI Tracking | ✅ Deployed |
| GHIS-009 | Compliance Framework | ❌ Not yet |
| GHIS-010 | Funder Relationship Mgmt | ❌ Not yet |
| GHIS-011 | Capacity Planning | ❌ Not yet |
| GHIS-012 | Database Fragmentation | ❌ Not yet |

---

## 🔐 Environment Variables Required

```env
OPENAI_API_KEY=sk-...   # Required for writing, matching, review, budget narrative agents
```

---

## 🏗️ Platform

Built on **[Base44](https://base44.com)** — no-code backend with managed entities, backend functions (Deno runtime), OAuth connectors, and scheduled automations.

---

## 📋 HIL Checkpoint Format

Every consequential agent action surfaces a structured checkpoint:

```
─── HIL CHECKPOINT: [STAGE NAME] ───
Action Required: [what the human must do]
Options:
  ✅ Approve & Advance
  ✏️ Edit Before Continuing
  🔄 Regenerate
  🔍 Flag for Verification
  ⏸️ Pause
  🚫 Block This Opportunity

⚠️ Pipeline cannot advance until you select an option.
```

**Tier 1** — Blocking. No timeout. Pipeline paused.  
**Tier 2** — 48h review window, then auto-escalates to Tier 1.  
**Tier 3** — Auto-approved. Notification only.

---

## 📊 Scoring Formula (SOP4)

```
Total Score (0–100):
  Mandate Alignment:    40% weight
  Eligibility Fit:      30% weight
  Deadline Feasibility: 20% weight
  Geographic Match:     10% weight

States:
  GO   ≥ 80  — Pursue immediately
  PREP ≥ 60  — Prepare with conditions
  DEF  ≥ 40  — Defer / monitor
  DECLINE < 40 — Do not pursue
```

Weights auto-calibrate via `scoringCalibrationAgent` as real outcomes accumulate.

---

*GHIS LLC · Health Equity · Digital Health · Workforce Development · Community Engagement*
