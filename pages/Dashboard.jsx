import { useState, useEffect } from "react";
import { Grant } from "@/api/entities";
import { GrantMatch } from "@/api/entities";
import { GrantApplication } from "@/api/entities";
import { OrgProfile } from "@/api/entities";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalGrants: 0,
    activeMatches: 0,
    inPipeline: 0,
    dueThisMonth: 0,
  });
  const [recentMatches, setRecentMatches] = useState([]);
  const [urgentDeadlines, setUrgentDeadlines] = useState([]);
  const [orgProfile, setOrgProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    try {
      const [grants, matches, applications, profiles] = await Promise.all([
        Grant.filter({ status: "active" }),
        GrantMatch.list(),
        GrantApplication.list(),
        OrgProfile.list(),
      ]);

      const now = new Date();
      const thirtyDays = new Date(now.getTime() + 30 * 86400000);

      setStats({
        totalGrants: grants.length,
        activeMatches: matches.length,
        inPipeline: applications.length,
        dueThisMonth: applications.filter(
          (a) => a.deadline && new Date(a.deadline) <= thirtyDays && new Date(a.deadline) > now
        ).length,
      });

      setRecentMatches(
        [...matches].sort((a, b) => b.relevance_score - a.relevance_score).slice(0, 5)
      );

      setUrgentDeadlines(
        applications
          .filter((a) => a.deadline && new Date(a.deadline) > now)
          .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
          .slice(0, 5)
      );

      if (profiles.length > 0) setOrgProfile(profiles[0]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  const stageColor = {
    Discovered: "bg-gray-100 text-gray-700",
    Evaluating: "bg-blue-100 text-blue-700",
    Preparing: "bg-yellow-100 text-yellow-700",
    Drafting: "bg-orange-100 text-orange-700",
    "Internal Review": "bg-purple-100 text-purple-700",
    "Final Review": "bg-indigo-100 text-indigo-700",
    Submitted: "bg-green-100 text-green-700",
    "Awaiting Decision": "bg-teal-100 text-teal-700",
    Awarded: "bg-emerald-100 text-emerald-700",
    Declined: "bg-red-100 text-red-700",
  };

  const daysUntil = (date) => {
    const days = Math.round((new Date(date) - new Date()) / 86400000);
    return days;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading Grant Path AI...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-emerald-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">GP</span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Grant Path AI</h1>
              {orgProfile && (
                <p className="text-xs text-gray-500">{orgProfile.org_name}</p>
              )}
            </div>
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
              <Link
                key={item.page}
                to={createPageUrl(item.page)}
                className="px-3 py-2 text-sm text-gray-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Welcome */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">
            Welcome back{orgProfile ? `, ${orgProfile.org_name}` : ""}
          </h2>
          <p className="text-gray-500 mt-1">
            Here's your grant pipeline snapshot.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: "Active Grants in DB", value: stats.totalGrants, color: "emerald", icon: "🗄️" },
            { label: "Grant Matches", value: stats.activeMatches, color: "blue", icon: "🎯" },
            { label: "In Pipeline", value: stats.inPipeline, color: "purple", icon: "📋" },
            { label: "Due This Month", value: stats.dueThisMonth, color: "orange", icon: "⏰" },
          ].map((stat) => (
            <div key={stat.label} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="text-2xl mb-2">{stat.icon}</div>
              <div className="text-3xl font-bold text-gray-900">{stat.value}</div>
              <div className="text-sm text-gray-500 mt-1">{stat.label}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Top Matches */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Top Grant Matches</h3>
              <Link
                to={createPageUrl("GrantMatches")}
                className="text-sm text-emerald-600 hover:underline"
              >
                View all →
              </Link>
            </div>
            {recentMatches.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <div className="text-3xl mb-2">🎯</div>
                <p className="text-sm">No matches yet.</p>
                <Link
                  to={createPageUrl("GrantMatches")}
                  className="text-emerald-600 text-sm hover:underline"
                >
                  Run matching →
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {recentMatches.map((match) => (
                  <div key={match.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {match.grant_id}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {match.match_rationale?.slice(0, 80)}...
                      </p>
                    </div>
                    <div className="ml-3 flex-shrink-0">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        match.relevance_score >= 70
                          ? "bg-emerald-100 text-emerald-800"
                          : match.relevance_score >= 50
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-gray-100 text-gray-600"
                      }`}>
                        {match.relevance_score?.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Urgent Deadlines */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Upcoming Deadlines</h3>
              <Link
                to={createPageUrl("Pipeline")}
                className="text-sm text-emerald-600 hover:underline"
              >
                Full pipeline →
              </Link>
            </div>
            {urgentDeadlines.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <div className="text-3xl mb-2">✅</div>
                <p className="text-sm">No upcoming deadlines.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {urgentDeadlines.map((app) => {
                  const days = daysUntil(app.deadline);
                  return (
                    <div key={app.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {app.grant_id}
                        </p>
                        <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full ${stageColor[app.pipeline_stage] || "bg-gray-100 text-gray-600"}`}>
                          {app.pipeline_stage}
                        </span>
                      </div>
                      <div className="ml-3 text-right flex-shrink-0">
                        <span className={`text-sm font-bold ${days <= 7 ? "text-red-600" : days <= 14 ? "text-orange-500" : "text-gray-700"}`}>
                          {days}d
                        </span>
                        <p className="text-xs text-gray-400">remaining</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mt-6 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-xl p-6 text-white">
          <h3 className="font-semibold text-lg mb-4">Quick Actions</h3>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "Discover Grants", page: "GrantDiscovery", icon: "🔍" },
              { label: "Find Matches", page: "GrantMatches", icon: "🎯" },
              { label: "New Application", page: "Applications", icon: "✍️" },
              { label: "View Pipeline", page: "Pipeline", icon: "📊" },
            ].map((action) => (
              <Link
                key={action.page}
                to={createPageUrl(action.page)}
                className="bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg p-4 text-center transition-all cursor-pointer"
              >
                <div className="text-2xl mb-2">{action.icon}</div>
                <div className="text-sm font-medium">{action.label}</div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
