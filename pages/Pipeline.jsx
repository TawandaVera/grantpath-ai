import { useState, useEffect } from "react";
import { GrantApplication } from "@/api/entities";
import { Grant } from "@/api/entities";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

const STAGES = ["Discovered","Evaluating","Preparing","Drafting","Internal Review","Final Review","Submitted","Awaiting Decision","Awarded","Declined","Reporting"];

const STAGE_COLORS = {
  Discovered: "bg-gray-100 text-gray-700 border-gray-200",
  Evaluating: "bg-blue-50 text-blue-700 border-blue-200",
  Preparing: "bg-yellow-50 text-yellow-700 border-yellow-200",
  Drafting: "bg-orange-50 text-orange-700 border-orange-200",
  "Internal Review": "bg-purple-50 text-purple-700 border-purple-200",
  "Final Review": "bg-indigo-50 text-indigo-700 border-indigo-200",
  Submitted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Awaiting Decision": "bg-teal-50 text-teal-700 border-teal-200",
  Awarded: "bg-green-100 text-green-800 border-green-300",
  Declined: "bg-red-50 text-red-700 border-red-200",
  Reporting: "bg-pink-50 text-pink-700 border-pink-200",
};

export default function Pipeline() {
  const [applications, setApplications] = useState([]);
  const [grants, setGrants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("kanban"); // kanban | list
  const [running, setRunning] = useState(false);
  const [pipelineData, setPipelineData] = useState(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [apps, grantList] = await Promise.all([GrantApplication.list(), Grant.list()]);
      setApplications(apps);
      setGrants(grantList);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function runDeadlineCheck() {
    setRunning(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_BASE44_BACKEND_URL}/api/apps/${import.meta.env.VITE_BASE44_APP_ID}/functions/deadlineAgent`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check_all" }) }
      );
      const data = await res.json();
      setPipelineData(data);
    } catch (e) { console.error(e); }
    finally { setRunning(false); }
  }

  async function moveStage(appId, newStage) {
    await GrantApplication.update(appId, { pipeline_stage: newStage });
    setApplications((prev) => prev.map((a) => a.id === appId ? { ...a, pipeline_stage: newStage } : a));
  }

  const grantMap = {};
  grants.forEach((g) => { grantMap[g.grant_id] = g; grantMap[g.id] = g; });

  const daysUntil = (date) => date ? Math.round((new Date(date) - new Date()) / 86400000) : null;

  const byStage = {};
  STAGES.forEach((s) => { byStage[s] = []; });
  applications.forEach((a) => {
    const stage = a.pipeline_stage || "Discovered";
    if (byStage[stage]) byStage[stage].push(a);
  });

  const totalValue = applications.reduce((sum, a) => sum + (a.grand_total || 0), 0);
  const awarded = applications.filter((a) => a.pipeline_stage === "Awarded").length;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-full mx-auto flex items-center justify-between">
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
                className={`px-3 py-2 text-sm rounded-lg transition-colors ${item.page === "Pipeline" ? "bg-emerald-50 text-emerald-700 font-medium" : "text-gray-600 hover:text-emerald-700 hover:bg-emerald-50"}`}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <div className="px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Grant Pipeline</h2>
            <p className="text-gray-500 mt-1">{applications.length} applications · ${(totalValue / 1000).toFixed(0)}K total budget · {awarded} awarded</p>
          </div>
          <div className="flex gap-3">
            <div className="flex border border-gray-200 rounded-lg overflow-hidden">
              <button onClick={() => setView("kanban")} className={`px-3 py-2 text-sm ${view === "kanban" ? "bg-gray-100 font-medium" : "bg-white text-gray-600"}`}>Kanban</button>
              <button onClick={() => setView("list")} className={`px-3 py-2 text-sm ${view === "list" ? "bg-gray-100 font-medium" : "bg-white text-gray-600"}`}>List</button>
            </div>
            <button onClick={runDeadlineCheck} disabled={running}
              className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 transition-colors">
              {running ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Checking...</> : "⏰ Check Deadlines"}
            </button>
          </div>
        </div>

        {/* Deadline alerts */}
        {pipelineData && (
          <div className="mb-6 space-y-2">
            {pipelineData.overdue > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
                <span className="text-2xl">🚨</span>
                <p className="text-red-800 font-medium">{pipelineData.overdue} overdue application{pipelineData.overdue > 1 ? "s" : ""}</p>
              </div>
            )}
            {pipelineData.critical > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-center gap-3">
                <span className="text-2xl">⚠️</span>
                <p className="text-orange-800 font-medium">{pipelineData.critical} application{pipelineData.critical > 1 ? "s" : ""} with deadlines in 3 days</p>
              </div>
            )}
            {pipelineData.capacity_alerts?.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center gap-3">
                <span className="text-2xl">📅</span>
                <p className="text-yellow-800">{pipelineData.capacity_alerts.length} overlapping deadline conflict{pipelineData.capacity_alerts.length > 1 ? "s" : ""} detected</p>
              </div>
            )}
          </div>
        )}

        {/* Kanban View */}
        {view === "kanban" && (
          <div className="overflow-x-auto pb-4">
            <div className="flex gap-3 min-w-max">
              {STAGES.map((stage) => {
                const cards = byStage[stage] || [];
                return (
                  <div key={stage} className="w-56 flex-shrink-0">
                    <div className={`flex items-center justify-between px-3 py-2 rounded-t-lg border-b-2 mb-2 ${STAGE_COLORS[stage]}`}>
                      <span className="text-xs font-semibold truncate">{stage}</span>
                      <span className="text-xs bg-white bg-opacity-70 rounded-full w-5 h-5 flex items-center justify-center font-bold">{cards.length}</span>
                    </div>
                    <div className="space-y-2 min-h-32">
                      {cards.map((app) => {
                        const grant = grantMap[app.grant_id];
                        const days = daysUntil(app.deadline);
                        return (
                          <div key={app.id} className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow">
                            <p className="text-xs font-semibold text-gray-900 leading-tight mb-1 line-clamp-2">
                              {grant?.title?.slice(0, 50) || app.grant_id}
                            </p>
                            <p className="text-xs text-gray-500 truncate">{grant?.funder || "—"}</p>
                            {days !== null && (
                              <p className={`text-xs mt-1.5 font-medium ${days < 0 ? "text-red-500" : days < 7 ? "text-orange-500" : days < 30 ? "text-yellow-600" : "text-gray-400"}`}>
                                {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d remaining`}
                              </p>
                            )}
                            {app.compliance_score !== undefined && (
                              <div className="mt-2">
                                <div className="bg-gray-100 rounded-full h-1">
                                  <div className="bg-emerald-500 h-1 rounded-full" style={{ width: `${app.compliance_score}%` }} />
                                </div>
                              </div>
                            )}
                            {/* Move buttons */}
                            <div className="flex gap-1 mt-2">
                              {STAGES.indexOf(stage) > 0 && (
                                <button onClick={() => moveStage(app.id, STAGES[STAGES.indexOf(stage) - 1])}
                                  className="text-xs text-gray-400 hover:text-gray-600 px-1.5 py-0.5 border border-gray-200 rounded">←</button>
                              )}
                              {STAGES.indexOf(stage) < STAGES.length - 1 && (
                                <button onClick={() => moveStage(app.id, STAGES[STAGES.indexOf(stage) + 1])}
                                  className="text-xs text-gray-400 hover:text-gray-600 px-1.5 py-0.5 border border-gray-200 rounded">→</button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* List View */}
        {view === "list" && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Grant</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Stage</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Deadline</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Compliance</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Budget</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {applications.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-12 text-gray-400">No applications yet</td></tr>
                ) : applications.map((app) => {
                  const grant = grantMap[app.grant_id];
                  const days = daysUntil(app.deadline);
                  return (
                    <tr key={app.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 truncate max-w-xs">{grant?.title || app.grant_id}</p>
                        <p className="text-xs text-gray-500">{grant?.funder}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded-full border ${STAGE_COLORS[app.pipeline_stage] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                          {app.pipeline_stage}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {app.deadline ? (
                          <div>
                            <p className="text-gray-700">{new Date(app.deadline).toLocaleDateString()}</p>
                            <p className={`text-xs ${days !== null && days < 0 ? "text-red-500" : days !== null && days < 14 ? "text-orange-500" : "text-gray-400"}`}>
                              {days !== null ? (days < 0 ? `${Math.abs(days)}d overdue` : `${days}d left`) : ""}
                            </p>
                          </div>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {app.compliance_score !== undefined ? (
                          <div className="flex items-center gap-2">
                            <div className="w-16 bg-gray-100 rounded-full h-1.5">
                              <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${app.compliance_score}%` }} />
                            </div>
                            <span className="text-xs text-gray-600">{app.compliance_score?.toFixed(0)}%</span>
                          </div>
                        ) : <span className="text-gray-400 text-xs">Not checked</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {app.grand_total ? `$${app.grand_total.toLocaleString()}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
