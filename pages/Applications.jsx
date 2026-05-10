import { useState, useEffect } from "react";
import { GrantApplication } from "@/api/entities";
import { Grant } from "@/api/entities";
import { OrgProfile } from "@/api/entities";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

const SECTIONS = [
  "Executive Summary",
  "Statement of Need",
  "Project Description",
  "Goals and Objectives",
  "Methods and Approach",
  "Evaluation Plan",
  "Organizational Capacity",
  "Sustainability Plan",
  "Budget Narrative",
  "Logic Model",
];

const STAGES = ["Discovered","Evaluating","Preparing","Drafting","Internal Review","Final Review","Submitted","Awaiting Decision","Awarded","Declined","Reporting"];

export default function Applications() {
  const [applications, setApplications] = useState([]);
  const [grants, setGrants] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState(null);
  const [agentRunning, setAgentRunning] = useState(null);
  const [agentResult, setAgentResult] = useState(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newApp, setNewApp] = useState({ grant_id: "", org_profile_id: "", deadline: "", pipeline_stage: "Discovered" });

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [apps, grantList, profileList] = await Promise.all([
        GrantApplication.list(),
        Grant.list(),
        OrgProfile.list(),
      ]);
      setApplications(apps);
      setGrants(grantList);
      setProfiles(profileList);
      if (apps.length > 0) setSelected(apps[0]);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function createApplication() {
    if (!newApp.grant_id || !newApp.org_profile_id) return;
    const created = await GrantApplication.create({ ...newApp, sections: {} });
    setApplications((prev) => [created, ...prev]);
    setSelected(created);
    setShowNewModal(false);
    setNewApp({ grant_id: "", org_profile_id: "", deadline: "", pipeline_stage: "Discovered" });
  }

  async function runAgent(agentName, payload) {
    setAgentRunning(agentName);
    setAgentResult(null);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_BASE44_BACKEND_URL}/api/apps/${import.meta.env.VITE_BASE44_APP_ID}/functions/${agentName}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
      );
      const data = await res.json();
      setAgentResult({ agent: agentName, data });
      // Reload selected app
      const updated = await GrantApplication.filter({ id: selected.id });
      if (updated.length > 0) {
        setSelected(updated[0]);
        setApplications((prev) => prev.map((a) => a.id === updated[0].id ? updated[0] : a));
      }
    } catch (e) {
      setAgentResult({ agent: agentName, error: e.message });
    } finally {
      setAgentRunning(null);
    }
  }

  const grantMap = {};
  grants.forEach((g) => { grantMap[g.grant_id] = g; grantMap[g.id] = g; });

  const complianceColors = { ready: "text-emerald-600 bg-emerald-50", needs_attention: "text-yellow-600 bg-yellow-50", not_ready: "text-red-600 bg-red-50" };

  const grantForApp = (app) => grantMap[app.grant_id] || null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-emerald-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">GP</span>
            </div>
            <h1 className="text-lg font-bold text-gray-900">Grant Path AI</h1>
          </div>
          <nav className="flex gap-1">
            {[
              { label: "Dashboard", page: "Dashboard" },
              { label: "Discover", page: "GrantDiscovery" },
              { label: "Matches", page: "GrantMatches" },
              { label: "Applications", page: "Applications" },
              { label: "Pipeline", page: "Pipeline" },
              { label: "Org Profile", page: "OrgProfileSetup" },
            ].map((item) => (
              <Link key={item.page} to={createPageUrl(item.page)}
                className={`px-3 py-2 text-sm rounded-lg transition-colors ${item.page === "Applications" ? "bg-emerald-50 text-emerald-700 font-medium" : "text-gray-600 hover:text-emerald-700 hover:bg-emerald-50"}`}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 flex gap-6">
        {/* Application List */}
        <div className="w-72 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Applications</h3>
            <button onClick={() => setShowNewModal(true)}
              className="text-xs bg-emerald-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-emerald-700">+ New</button>
          </div>
          <div className="space-y-2">
            {loading ? (
              <p className="text-sm text-gray-400 text-center py-8">Loading...</p>
            ) : applications.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <p className="text-4xl mb-3">📋</p>
                <p className="text-sm">No applications yet</p>
                <button onClick={() => setShowNewModal(true)} className="text-emerald-600 text-sm underline mt-1">Create one →</button>
              </div>
            ) : (
              applications.map((app) => {
                const g = grantForApp(app);
                const days = app.deadline ? Math.round((new Date(app.deadline) - new Date()) / 86400000) : null;
                return (
                  <div key={app.id} onClick={() => { setSelected(app); setAgentResult(null); }}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${selected?.id === app.id ? "border-emerald-500 bg-emerald-50" : "bg-white border-gray-200 hover:border-gray-300"}`}>
                    <p className="font-medium text-sm text-gray-900 truncate">{g?.title || app.grant_id}</p>
                    <p className="text-xs text-gray-500 truncate mt-0.5">{g?.funder || "—"}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{app.pipeline_stage}</span>
                      {days !== null && (
                        <span className={`text-xs font-medium ${days < 7 ? "text-red-500" : days < 30 ? "text-orange-500" : "text-gray-500"}`}>
                          {days < 0 ? "Overdue" : `${days}d`}
                        </span>
                      )}
                    </div>
                    {app.compliance_score !== undefined && (
                      <div className="mt-2 flex items-center gap-1">
                        <div className="flex-1 bg-gray-200 rounded-full h-1">
                          <div className="bg-emerald-500 h-1 rounded-full" style={{ width: `${app.compliance_score}%` }} />
                        </div>
                        <span className="text-xs text-gray-500">{app.compliance_score?.toFixed(0)}%</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Main workspace */}
        {selected ? (
          <div className="flex-1 min-w-0">
            {/* App header */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{grantForApp(selected)?.title || selected.grant_id}</h2>
                  <p className="text-sm text-gray-500">{grantForApp(selected)?.funder}</p>
                </div>
                <select value={selected.pipeline_stage || "Discovered"}
                  onChange={async (e) => {
                    await GrantApplication.update(selected.id, { pipeline_stage: e.target.value });
                    setSelected({ ...selected, pipeline_stage: e.target.value });
                  }}
                  className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-emerald-500">
                  {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {/* Scores */}
              <div className="flex gap-6 mt-4">
                {selected.compliance_score !== undefined && (
                  <div>
                    <p className="text-xs text-gray-500">Compliance</p>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-lg">{selected.compliance_score?.toFixed(0)}%</span>
                      {selected.compliance_status && (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${complianceColors[selected.compliance_status]}`}>
                          {selected.compliance_status.replace("_", " ")}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {selected.review_score !== undefined && (
                  <div>
                    <p className="text-xs text-gray-500">Review Score</p>
                    <span className="font-bold text-lg">{selected.review_score?.toFixed(0)}/100</span>
                  </div>
                )}
                {selected.grand_total && (
                  <div>
                    <p className="text-xs text-gray-500">Budget Total</p>
                    <span className="font-bold text-lg">${selected.grand_total?.toLocaleString()}</span>
                  </div>
                )}
              </div>

              {/* Agent Actions */}
              <div className="flex gap-2 mt-4 flex-wrap">
                {[
                  { id: "grantWritingAgent", label: "✍️ Draft All Sections", payload: { application_id: selected.id, action: "all_sections" } },
                  { id: "complianceAgent", label: "✅ Run Compliance Check", payload: { application_id: selected.id } },
                  { id: "budgetBuilderAgent", label: "💰 Estimate Budget", payload: { application_id: selected.id, action: "estimate" } },
                  { id: "reviewAgent", label: "🔍 Run Review Panel", payload: { application_id: selected.id } },
                ].map((action) => (
                  <button key={action.id}
                    onClick={() => runAgent(action.id, action.payload)}
                    disabled={!!agentRunning}
                    className="flex items-center gap-1.5 text-sm border border-gray-300 bg-white hover:bg-gray-50 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                    {agentRunning === action.id ? (
                      <><div className="w-3 h-3 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" /> Running...</>
                    ) : action.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Agent Result */}
            {agentResult && (
              <div className={`mb-4 p-4 rounded-xl border ${agentResult.error ? "bg-red-50 border-red-200" : "bg-emerald-50 border-emerald-200"}`}>
                <p className="font-medium text-sm text-gray-900 mb-1">{agentResult.agent} result</p>
                {agentResult.error ? (
                  <p className="text-red-600 text-sm">{agentResult.error}</p>
                ) : (
                  <pre className="text-xs text-gray-700 overflow-auto max-h-40">{JSON.stringify(agentResult.data, null, 2)}</pre>
                )}
              </div>
            )}

            {/* Sections */}
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="border-b border-gray-200 p-4">
                <h3 className="font-semibold text-gray-900">Application Sections</h3>
              </div>
              <div className="flex">
                {/* Section tabs */}
                <div className="w-48 border-r border-gray-200 p-3">
                  {SECTIONS.map((sec) => {
                    const hasContent = selected.sections?.[sec]?.length > 0;
                    return (
                      <button key={sec}
                        onClick={() => setActiveSection(activeSection === sec ? null : sec)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center justify-between mb-1 ${activeSection === sec ? "bg-emerald-50 text-emerald-700 font-medium" : "text-gray-600 hover:bg-gray-50"}`}>
                        <span className="truncate">{sec}</span>
                        {hasContent && <span className="text-emerald-500 ml-1 flex-shrink-0">✓</span>}
                      </button>
                    );
                  })}
                </div>

                {/* Section content */}
                <div className="flex-1 p-5">
                  {activeSection ? (
                    <SectionEditor
                      section={activeSection}
                      applicationId={selected.id}
                      content={selected.sections?.[activeSection] || ""}
                      onSaved={(content) => {
                        const updated = { ...selected, sections: { ...(selected.sections || {}), [activeSection]: content } };
                        setSelected(updated);
                        setApplications((prev) => prev.map((a) => a.id === updated.id ? updated : a));
                      }}
                    />
                  ) : (
                    <div className="text-center py-16 text-gray-400">
                      <div className="text-4xl mb-3">📄</div>
                      <p className="text-sm">Select a section to view or edit it</p>
                      <p className="text-xs mt-1">Or use "Draft All Sections" to auto-generate content</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <div className="text-6xl mb-4">📋</div>
              <p className="text-lg font-medium text-gray-600">No application selected</p>
              <button onClick={() => setShowNewModal(true)} className="mt-4 bg-emerald-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-emerald-700 transition-colors">
                + Create Application
              </button>
            </div>
          </div>
        )}
      </div>

      {/* New Application Modal */}
      {showNewModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="font-bold text-gray-900 text-lg mb-4">New Application</h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Grant</label>
                <select value={newApp.grant_id} onChange={(e) => setNewApp({ ...newApp, grant_id: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500">
                  <option value="">Select a grant...</option>
                  {grants.map((g) => <option key={g.id} value={g.grant_id}>{g.title?.slice(0, 60)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Organization</label>
                <select value={newApp.org_profile_id} onChange={(e) => setNewApp({ ...newApp, org_profile_id: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500">
                  <option value="">Select org...</option>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.org_name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Deadline</label>
                <input type="date" value={newApp.deadline} onChange={(e) => setNewApp({ ...newApp, deadline: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowNewModal(false)} className="flex-1 border border-gray-300 text-gray-700 px-4 py-2.5 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={createApplication} className="flex-1 bg-emerald-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-emerald-700">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionEditor({ section, applicationId, content, onSaved }) {
  const [text, setText] = useState(content);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => { setText(content); }, [content]);

  async function save() {
    setSaving(true);
    try {
      const app = await GrantApplication.filter({ id: applicationId });
      if (app.length > 0) {
        const updated = { sections: { ...(app[0].sections || {}), [section]: text } };
        await GrantApplication.update(applicationId, updated);
        onSaved(text);
      }
    } finally { setSaving(false); }
  }

  async function draftSection() {
    setRunning(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_BASE44_BACKEND_URL}/api/apps/${import.meta.env.VITE_BASE44_APP_ID}/functions/grantWritingAgent`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ application_id: applicationId, action: "draft", section }) }
      );
      const data = await res.json();
      if (data.content) { setText(data.content); onSaved(data.content); }
    } finally { setRunning(false); }
  }

  async function refineSection() {
    if (!feedback) return;
    setRunning(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_BASE44_BACKEND_URL}/api/apps/${import.meta.env.VITE_BASE44_APP_ID}/functions/grantWritingAgent`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ application_id: applicationId, action: "refine", section, feedback }) }
      );
      const data = await res.json();
      if (data.content) { setText(data.content); onSaved(data.content); setFeedback(""); }
    } finally { setRunning(false); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-gray-900">{section}</h4>
        <div className="flex gap-2">
          <button onClick={draftSection} disabled={running}
            className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-100 disabled:opacity-50">
            {running ? "⏳ Working..." : "✨ AI Draft"}
          </button>
          <button onClick={save} disabled={saving}
            className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)}
        placeholder={`Write or generate the ${section} section...`}
        className="w-full h-52 border border-gray-300 rounded-lg p-3 text-sm text-gray-800 resize-none focus:ring-2 focus:ring-emerald-500 outline-none" />
      <div className="flex gap-2 mt-2">
        <input value={feedback} onChange={(e) => setFeedback(e.target.value)}
          placeholder="Enter feedback to refine this section..."
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
        <button onClick={refineSection} disabled={!feedback || running}
          className="text-sm bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 disabled:opacity-50">
          Refine
        </button>
      </div>
    </div>
  );
}
