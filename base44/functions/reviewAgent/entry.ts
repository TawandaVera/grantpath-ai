import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";

const REVIEWER_PERSONAS = [
  {
    name: "Technical Expert",
    focus: "Scientific/technical rigor, methodology, innovation, evidence base",
    style: "Detail-oriented, evidence-focused, skeptical of unsupported claims",
  },
  {
    name: "Program Officer",
    focus: "Alignment with funder priorities, broader impacts, strategic fit",
    style: "Strategic, mission-alignment focused, looking for organizational credibility",
  },
  {
    name: "Community Stakeholder",
    focus: "Community impact, equity, sustainability, real-world feasibility",
    style: "Practical, outcomes-focused, concerned with who benefits and how",
  },
];

async function runPersonaReview(persona: typeof REVIEWER_PERSONAS[0], proposal: string, grant: any, criteria: string[]): Promise<any> {
  if (!OPENAI_API_KEY) {
    return {
      reviewer: persona.name,
      score: 70,
      max_score: 100,
      strengths: ["Proposal structure is present"],
      weaknesses: ["Configure OpenAI API key for detailed review"],
      suggestions: ["Add OPENAI_API_KEY to enable AI-powered review"],
    };
  }

  const prompt = `You are a grant reviewer with the following persona:
Name: ${persona.name}
Focus: ${persona.focus}
Style: ${persona.style}

Review this grant proposal and provide detailed feedback.

GRANT OPPORTUNITY:
Title: ${grant.title}
Funder: ${grant.funder}
Description: ${grant.description?.slice(0, 400)}
Award: $${grant.funding_amount_min?.toLocaleString()} - $${grant.funding_amount_max?.toLocaleString()}

SCORING CRITERIA (each worth ~${Math.round(100 / Math.max(criteria.length, 1))} points):
${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}

PROPOSAL SECTIONS:
${proposal}

Provide your review as JSON:
{
  "overall_score": <number 0-100>,
  "summary": "2-3 sentence overall assessment",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "weaknesses": ["weakness 1", "weakness 2"],
  "suggestions": ["actionable suggestion 1", "actionable suggestion 2"],
  "criterion_scores": [
    {"criterion": "...", "score": <0-100>, "comment": "..."}
  ]
}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 1000,
        temperature: 0.8,
      }),
    });
    const data = await res.json();
    const content = JSON.parse(data.choices[0].message.content);
    return { reviewer: persona.name, ...content };
  } catch {
    return { reviewer: persona.name, overall_score: 0, strengths: [], weaknesses: ["Review failed"], suggestions: [] };
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { application_id, custom_criteria } = body;

    if (!application_id) return Response.json({ error: "application_id is required" }, { status: 400 });

    const apps = await base44.asServiceRole.entities.GrantApplication.filter({ id: application_id });
    if (!apps?.length) return Response.json({ error: "Application not found" }, { status: 404 });
    const app = apps[0];

    const grants = await base44.asServiceRole.entities.Grant.filter({ grant_id: app.grant_id });
    const grant = grants?.[0] || {};
    const sections = app.sections || {};

    if (!Object.keys(sections).length) {
      return Response.json({ error: "No drafted sections found. Use the Writing Agent to draft sections first." }, { status: 400 });
    }

    // Default scoring criteria if none provided
    const criteria = custom_criteria || [
      "Clarity and strength of need statement",
      "Feasibility and quality of project design/methodology",
      "Measurability of goals and outcomes",
      "Organizational capacity and track record",
      "Budget reasonableness and justification",
      "Sustainability beyond the grant period",
      "Alignment with funder priorities",
    ];

    // Format proposal text
    const proposalText = Object.entries(sections)
      .map(([name, content]) => `[${name}]\n${String(content).slice(0, 600)}`)
      .join("\n\n");

    // Run all 3 persona reviews (sequential to avoid rate limits)
    const reviewerResults = [];
    for (const persona of REVIEWER_PERSONAS) {
      const review = await runPersonaReview(persona, proposalText, grant, criteria);
      reviewerResults.push(review);
    }

    // Aggregate scores
    const avgScore = reviewerResults.reduce((sum, r) => sum + (r.overall_score || 0), 0) / reviewerResults.length;
    
    // Collect all suggestions, deduplicate top priorities
    const allSuggestions = reviewerResults.flatMap((r) => r.suggestions || []);
    const strengthsCombined = reviewerResults.flatMap((r) => r.strengths || []);
    const weaknessesCombined = reviewerResults.flatMap((r) => r.weaknesses || []);

    // Aggregate criterion scores
    const criterionMap: Record<string, { total: number; count: number; comments: string[] }> = {};
    for (const review of reviewerResults) {
      for (const cs of review.criterion_scores || []) {
        if (!criterionMap[cs.criterion]) criterionMap[cs.criterion] = { total: 0, count: 0, comments: [] };
        criterionMap[cs.criterion].total += cs.score || 0;
        criterionMap[cs.criterion].count++;
        if (cs.comment) criterionMap[cs.criterion].comments.push(`[${review.reviewer}] ${cs.comment}`);
      }
    }
    const aggregatedCriteria = Object.entries(criterionMap).map(([criterion, data]) => ({
      criterion,
      avg_score: parseFloat((data.total / data.count).toFixed(1)),
      max_score: 100,
      reviewer_comments: data.comments,
    }));

    // Percentile estimate
    const percentile = avgScore >= 90 ? "Top 10%" : avgScore >= 75 ? "Top 25%" : avgScore >= 60 ? "Top 50%" : "Bottom 50%";

    // Save review to application
    await base44.asServiceRole.entities.GrantApplication.update(application_id, {
      review_score: parseFloat(avgScore.toFixed(1)),
      review_max_score: 100,
    });

    return Response.json({
      ok: true,
      application_id,
      overall_score: parseFloat(avgScore.toFixed(1)),
      max_possible_score: 100,
      percentile_estimate: percentile,
      criterion_scores: aggregatedCriteria,
      reviewer_comments: reviewerResults.map((r) => ({ reviewer: r.reviewer, summary: r.summary, score: r.overall_score })),
      top_strengths: strengthsCombined.slice(0, 5),
      top_weaknesses: weaknessesCombined.slice(0, 5),
      priority_improvements: allSuggestions.slice(0, 5),
    });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
