/**
 * GHIS-005: Master Narrative Versioning Agent
 * Manages versioned org narrative with conflict detection,
 * section diffing, and pack consistency checking.
 */
import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";

const REQUIRED_SECTIONS = [
  "organization_overview",
  "need_statement",
  "program_description",
  "organizational_capacity",
  "outcomes_and_impact",
  "partnerships",
  "equity_and_inclusion",
  "evaluation",
  "sustainability",
  "budget_logic",
  "leadership_bios",
  "prior_traction",
];

function computeHash(content: object): string {
  const str = JSON.stringify(content, Object.keys(content).sort());
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

function incrementVersion(current: string): string {
  const parts = current.split(".");
  if (parts.length !== 3) return "1.0.0";
  const [major, minor] = parts.map(Number);
  return `${major}.${minor + 1}.0`;
}

function diffSections(
  oldContent: Record<string, unknown>,
  newContent: Record<string, unknown>
): { added: string[]; removed: string[]; modified: string[]; unchanged: string[] } {
  const allSections = new Set([...Object.keys(oldContent), ...Object.keys(newContent)]);
  const result = { added: [] as string[], removed: [] as string[], modified: [] as string[], unchanged: [] as string[] };

  for (const sec of allSections) {
    if (!(sec in oldContent)) result.added.push(sec);
    else if (!(sec in newContent)) result.removed.push(sec);
    else if (JSON.stringify(oldContent[sec]) === JSON.stringify(newContent[sec])) result.unchanged.push(sec);
    else result.modified.push(sec);
  }
  return result;
}

function detectConflicts(content: Record<string, unknown>): Array<{ type: string; section?: string; detail: string; severity: string }> {
  const conflicts: Array<{ type: string; section?: string; detail: string; severity: string }> = [];
  const fullText = JSON.stringify(content).toLowerCase();

  // Language contradiction pairs
  const contradictions = [
    ["first-of-its-kind", "well-established"],
    ["startup", "decades of experience"],
    ["emerging", "proven track record"],
    ["pilot", "at scale"],
    ["new organization", "long history"],
  ];

  for (const [termA, termB] of contradictions) {
    if (fullText.includes(termA) && fullText.includes(termB)) {
      conflicts.push({
        type: "language_contradiction",
        detail: `Contains both '${termA}' and '${termB}' — review for consistent positioning`,
        severity: "low",
      });
    }
  }

  // Temporal consistency
  const orgOverview = content["organization_overview"] as Record<string, unknown> | undefined;
  const foundedYear = orgOverview?.founded_year as number | undefined;
  if (foundedYear) {
    for (const [secName, secContent] of Object.entries(content)) {
      const secText = JSON.stringify(secContent);
      const years = secText.match(/\b20\d{2}\b/g) || [];
      for (const year of years) {
        if (parseInt(year) < foundedYear) {
          conflicts.push({
            type: "temporal_inconsistency",
            section: secName,
            detail: `References year ${year} but org founded in ${foundedYear}`,
            severity: "medium",
          });
        }
      }
    }
  }

  // Number inconsistency (same dollar amount referenced differently)
  const amounts: Record<string, string[]> = {};
  for (const [secName, secContent] of Object.entries(content)) {
    const matches = JSON.stringify(secContent).match(/\$[\d,]+(?:\.\d{2})?/g) || [];
    amounts[secName] = matches;
  }

  return conflicts;
}

async function callLLM(prompt: string): Promise<string> {
  if (!OPENAI_API_KEY) return "";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 800 }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { action = "get_current", content, change_log, changed_by = "system" } = body;

    // ─── GET CURRENT ───
    if (action === "get_current") {
      const versions = await base44.asServiceRole.entities.MasterNarrative.filter({ is_current: true });
      if (!versions.length) return Response.json({ ok: false, error: "No Master Narrative found. Use action=create to initialize." });
      return Response.json({ ok: true, narrative: versions[0] });
    }

    // ─── CREATE (first time) ───
    if (action === "create") {
      if (!content) return Response.json({ error: "content is required" }, { status: 400 });

      const missing = REQUIRED_SECTIONS.filter((s) => !(s in content));
      if (missing.length > 0) {
        return Response.json({ ok: false, error: "Missing required sections", missing_sections: missing, required: REQUIRED_SECTIONS });
      }

      const conflicts = detectConflicts(content);
      const hash = computeHash(content);

      // Deactivate any existing current
      const existing = await base44.asServiceRole.entities.MasterNarrative.filter({ is_current: true });
      for (const e of existing) {
        await base44.asServiceRole.entities.MasterNarrative.update(e.id, { is_current: false });
      }

      const narrative = await base44.asServiceRole.entities.MasterNarrative.create({
        version: "1.0.0",
        content_hash: hash,
        content,
        change_log: change_log || "Initial version",
        changed_by,
        sections_updated: REQUIRED_SECTIONS,
        is_current: true,
        conflicts_detected: conflicts,
        diff_from_previous: "Initial version — no previous",
      });

      return Response.json({ ok: true, action: "created", version: "1.0.0", conflicts_detected: conflicts.length, narrative });
    }

    // ─── UPDATE (new version) ───
    if (action === "update") {
      if (!content) return Response.json({ error: "content is required" }, { status: 400 });

      const missing = REQUIRED_SECTIONS.filter((s) => !(s in content));
      if (missing.length > 0) {
        return Response.json({ ok: false, error: "Missing required sections", missing_sections: missing });
      }

      const current = await base44.asServiceRole.entities.MasterNarrative.filter({ is_current: true });
      if (!current.length) return Response.json({ error: "No current version found. Use action=create first." }, { status: 400 });

      const prev = current[0];
      const newVersion = incrementVersion(prev.version);
      const hash = computeHash(content);
      const diff = diffSections(prev.content || {}, content);
      const conflicts = detectConflicts(content);

      // Archive previous
      await base44.asServiceRole.entities.MasterNarrative.update(prev.id, { is_current: false });

      // Create new version
      const narrative = await base44.asServiceRole.entities.MasterNarrative.create({
        version: newVersion,
        content_hash: hash,
        content,
        change_log: change_log || `Updated from ${prev.version}`,
        changed_by,
        sections_updated: diff.modified,
        is_current: true,
        conflicts_detected: conflicts,
        diff_from_previous: JSON.stringify(diff),
      });

      // Flag any applications using outdated narrative
      const applications = await base44.asServiceRole.entities.GrantApplication.filter({});
      let flagged = 0;
      for (const app of applications) {
        if (["Drafting", "Internal Review", "Final Review"].includes(app.pipeline_stage)) {
          await base44.asServiceRole.entities.GrantApplication.update(app.id, {
            notes: `[MN-OUTDATED v${prev.version}→v${newVersion}: sections ${diff.modified.join(", ")} changed] ${app.notes || ""}`,
          });
          flagged++;
        }
      }

      return Response.json({
        ok: true,
        action: "updated",
        previous_version: prev.version,
        new_version: newVersion,
        sections_changed: diff.modified,
        sections_added: diff.added,
        sections_removed: diff.removed,
        conflicts_detected: conflicts.length,
        applications_flagged: flagged,
        narrative,
      });
    }

    // ─── LIST VERSIONS ───
    if (action === "list_versions") {
      const all = await base44.asServiceRole.entities.MasterNarrative.list();
      return Response.json({
        ok: true,
        total: all.length,
        current: all.find((n: any) => n.is_current)?.version,
        versions: all.map((n: any) => ({
          id: n.id, version: n.version, is_current: n.is_current,
          changed_by: n.changed_by, change_log: n.change_log,
          created_date: n.created_date, sections_updated: n.sections_updated,
          conflicts: n.conflicts_detected?.length || 0,
        })),
      });
    }

    // ─── CHECK CONSISTENCY (for a specific application) ───
    if (action === "check_consistency") {
      const { application_id } = body;
      if (!application_id) return Response.json({ error: "application_id required" }, { status: 400 });

      const current = await base44.asServiceRole.entities.MasterNarrative.filter({ is_current: true });
      if (!current.length) return Response.json({ error: "No Master Narrative found" }, { status: 404 });

      const apps = await base44.asServiceRole.entities.GrantApplication.filter({ id: application_id });
      if (!apps.length) return Response.json({ error: "Application not found" }, { status: 404 });

      const app = apps[0];
      const mn = current[0];
      const isOutdated = app.notes?.includes("[MN-OUTDATED");

      return Response.json({
        ok: true,
        application_id,
        current_narrative_version: mn.version,
        is_outdated: isOutdated,
        needs_review: isOutdated,
        pipeline_stage: app.pipeline_stage,
        recommendation: isOutdated
          ? "Review and update application sections affected by narrative changes"
          : "Application is aligned with current Master Narrative",
      });
    }

    // ─── VALIDATE CONTENT ───
    if (action === "validate") {
      if (!content) return Response.json({ error: "content is required" }, { status: 400 });
      const missing = REQUIRED_SECTIONS.filter((s) => !(s in content));
      const conflicts = detectConflicts(content);

      let qualityNote = "";
      if (OPENAI_API_KEY && Object.keys(content).length > 0) {
        qualityNote = await callLLM(`You are a grant writing expert. Review this org narrative summary and identify the top 3 quality issues in 2 sentences each.\n\nNarrative sections: ${Object.keys(content).join(", ")}\n\nSample: ${JSON.stringify(content).slice(0, 800)}\n\nReturn plain text, no JSON.`);
      }

      return Response.json({
        ok: true,
        valid: missing.length === 0,
        missing_sections: missing,
        present_sections: Object.keys(content),
        conflicts_detected: conflicts,
        quality_notes: qualityNote,
        completeness_score: Math.round(((REQUIRED_SECTIONS.length - missing.length) / REQUIRED_SECTIONS.length) * 100),
      });
    }

    return Response.json({ error: "Invalid action. Use: get_current | create | update | list_versions | check_consistency | validate" }, { status: 400 });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
