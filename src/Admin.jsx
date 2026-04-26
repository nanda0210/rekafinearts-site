import { useEffect, useState } from "react";

const API_BASE = (() => {
  const h = typeof window !== "undefined" ? window.location.hostname : "";
  if (h === "localhost" || h === "127.0.0.1" || h === "") return "http://localhost:3002";
  return import.meta.env.VITE_API_BASE_URL || "";
})();

export default function Admin() {
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [adminUser, setAdminUser] = useState("");
  const [adminPass, setAdminPass] = useState("");
  const [activeAdminTab, setActiveAdminTab] = useState("dashboard");
  const [pendingComments, setPendingComments] = useState([]);
  const [allComments, setAllComments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [stats, setStats] = useState({
    totalImages: 0,
    totalComments: 0,
    totalLikes: 0,
    pendingComments: 0,
  });
  const [editingComment, setEditingComment] = useState(null);
  const [editText, setEditText] = useState("");
  const [loginError, setLoginError] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotUsername, setForgotUsername] = useState("");
  const [forgotMessage, setForgotMessage] = useState("");
  const [forgotError, setForgotError] = useState("");

  // Password change states
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");

  const [emails, setEmails] = useState([
    { id: 1, from: "user1@gmail.com", msg: "Interested in classes", status: "new" },
    { id: 2, from: "user2@gmail.com", msg: "Pricing details?", status: "new" },
  ]);

  const handleAdminLogin = async () => {
    setLoginError("");
    try {
      const res = await fetch(`${API_BASE}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: adminUser, password: adminPass }),
      });

      const data = await res.json();

      if (!res.ok) {
        setLoginError(data.error || "Login failed");
        return;
      }

      setIsAdminLoggedIn(true);
      setAdminUser(adminUser);
      setAdminPass("");
      setLoginError("");
      loadStats();
    } catch (err) {
      console.error(err);
      setLoginError("Connection error");
    }
  };

  const handleLogout = () => {
    setIsAdminLoggedIn(false);
    setAdminUser("");
    setAdminPass("");
    setActiveAdminTab("dashboard");
  };

  const handleForgotPassword = async () => {
    setForgotError("");
    setForgotMessage("");

    if (!forgotUsername) {
      setForgotError("Please enter your username");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/admin/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: forgotUsername }),
      });

      const data = await res.json();

      if (!res.ok) {
        setForgotError(data.error || "Error processing request");
        return;
      }

      setForgotMessage(`Password sent to ${data.email}`);
      setForgotUsername("");
      setTimeout(() => setShowForgotPassword(false), 3000);
    } catch (err) {
      console.error(err);
      setForgotError("Connection error");
    }
  };

  const handleChangePassword = async () => {
    setPasswordError("");
    setPasswordSuccess("");

    if (!oldPassword || !newPassword || !newPasswordConfirm) {
      setPasswordError("All fields are required");
      return;
    }

    if (newPassword !== newPasswordConfirm) {
      setPasswordError("New passwords do not match");
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError("New password must be at least 6 characters");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/admin/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: adminUser,
          oldPassword,
          newPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setPasswordError(data.error || "Failed to change password");
        return;
      }

      setPasswordSuccess("Password changed successfully!");
      setOldPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
      setTimeout(() => setPasswordSuccess(""), 3000);
    } catch (err) {
      console.error(err);
      setPasswordError("Connection error");
    }
  };

  const loadPendingComments = async () => {
    try {
      setLoadingComments(true);
      const res = await fetch(`${API_BASE}/api/admin/comments/pending`);
      const data = await res.json();
      setPendingComments(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingComments(false);
    }
  };

  const loadAllComments = async () => {
    try {
      setLoadingComments(true);
      const res = await fetch(`${API_BASE}/api/comments/all`);
      const data = await res.json();
      setAllComments(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingComments(false);
    }
  };

  const approveComment = async (id) => {
    try {
      await fetch(`${API_BASE}/api/admin/comments/${id}/approve`, {
        method: "POST",
      });
      setPendingComments((prev) => prev.filter((c) => c.id !== id));
      loadStats();
    } catch (err) {
      console.error(err);
    }
  };

  const rejectComment = async (id) => {
    try {
      await fetch(`${API_BASE}/api/admin/comments/${id}/reject`, {
        method: "POST",
      });
      setPendingComments((prev) => prev.filter((c) => c.id !== id));
      loadStats();
    } catch (err) {
      console.error(err);
    }
  };

  const deleteComment = async (id) => {
    if (!confirm("Are you sure you want to delete this comment?")) return;
    try {
      await fetch(`${API_BASE}/api/admin/comments/${id}`, {
        method: "DELETE",
      });
      setAllComments((prev) => prev.filter((c) => c.id !== id));
      loadStats();
    } catch (err) {
      console.error(err);
      alert("Failed to delete comment");
    }
  };

  const startEditComment = (comment) => {
    setEditingComment(comment.id);
    setEditText(comment.comment_text);
  };

  const saveEditComment = async (id) => {
    if (!editText.trim()) return;
    try {
      await fetch(`${API_BASE}/api/admin/comments/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_text: editText }),
      });
      setAllComments((prev) =>
        prev.map((c) => (c.id === id ? { ...c, comment_text: editText } : c))
      );
      setEditingComment(null);
    } catch (err) {
      console.error(err);
      alert("Failed to edit comment");
    }
  };

  const loadStats = async () => {
    try {
      const pendRes = await fetch(`${API_BASE}/api/admin/comments/pending`);
      const pendData = await pendRes.json();
      
      const allRes = await fetch(`${API_BASE}/api/comments`);
      const allData = await allRes.json();
      
      setStats({
        pendingComments: Array.isArray(pendData) ? pendData.length : 0,
        totalComments: Array.isArray(allData) ? allData.length : 0,
        totalImages: 0,
        totalLikes: 0,
      });
    } catch (err) {
      console.error(err);
    }
  };

  const exportToCSV = () => {
    const headers = ["ID", "Comment", "Category", "Filename", "Date", "Status"];
    const rows = allComments.map((c) => [
      c.id,
      `"${c.comment_text.replace(/"/g, '""')}"`,
      c.category || "N/A",
      c.filename || "N/A",
      c.created_at || "N/A",
      c.approved ? "Approved" : "Pending",
    ]);

    const csv = [
      headers.join(","),
      ...rows.map((row) => row.join(",")),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `comments-export-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
  };

  useEffect(() => {
    if (isAdminLoggedIn) {
      if (activeAdminTab === "comments") loadPendingComments();
      if (activeAdminTab === "allComments") loadAllComments();
      if (activeAdminTab === "dashboard") loadStats();
    }
  }, [isAdminLoggedIn, activeAdminTab]);

  const filteredComments = allComments.filter((c) =>
    c.comment_text.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.filename?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.category?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <main className="min-h-screen bg-[#faf7f2] p-10">
      {!isAdminLoggedIn ? (
        <div className="mx-auto max-w-md rounded-3xl bg-white p-8 shadow-sm ring-1 ring-stone-200">
          {!showForgotPassword ? (
            <>
              <h2 className="mb-6 text-2xl font-semibold text-stone-800">Admin Login</h2>

              <input
                placeholder="Username"
                value={adminUser}
                onChange={(e) => setAdminUser(e.target.value)}
                className="mb-4 w-full rounded-xl border border-stone-300 p-3"
              />

              <input
                type="password"
                placeholder="Password"
                value={adminPass}
                onChange={(e) => setAdminPass(e.target.value)}
                className="mb-4 w-full rounded-xl border border-stone-300 p-3"
                onKeyPress={(e) => e.key === "Enter" && handleAdminLogin()}
              />

              {loginError && (
                <p className="mb-4 rounded-xl bg-red-100 p-3 text-sm text-red-700">{loginError}</p>
              )}

              <button
                onClick={handleAdminLogin}
                className="mb-3 w-full rounded-xl bg-rose-700 py-3 text-white transition hover:opacity-90"
              >
                Login
              </button>

              <button
                onClick={() => setShowForgotPassword(true)}
                className="w-full text-sm text-blue-600 underline transition hover:text-blue-700"
              >
                Forgot Password?
              </button>
            </>
          ) : (
            <>
              <h2 className="mb-6 text-2xl font-semibold text-stone-800">Forgot Password</h2>

              <input
                placeholder="Admin Username"
                value={forgotUsername}
                onChange={(e) => setForgotUsername(e.target.value)}
                className="mb-4 w-full rounded-xl border border-stone-300 p-3"
                onKeyPress={(e) => e.key === "Enter" && handleForgotPassword()}
              />

              {forgotError && (
                <p className="mb-4 rounded-xl bg-red-100 p-3 text-sm text-red-700">{forgotError}</p>
              )}

              {forgotMessage && (
                <p className="mb-4 rounded-xl bg-green-100 p-3 text-sm text-green-700">{forgotMessage}</p>
              )}

              <button
                onClick={handleForgotPassword}
                className="mb-3 w-full rounded-xl bg-blue-600 py-3 text-white transition hover:opacity-90"
              >
                Send Password to Email
              </button>

              <button
                onClick={() => setShowForgotPassword(false)}
                className="w-full text-sm text-stone-600 underline transition hover:text-stone-700"
              >
                Back to Login
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="mx-auto max-w-6xl">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-3xl font-semibold text-stone-800">Admin Panel</h1>
            <button
              onClick={handleLogout}
              className="rounded-xl bg-red-600 px-4 py-2 text-white transition hover:opacity-90"
            >
              🚪 Logout
            </button>
          </div>

          <div className="mb-6 flex flex-wrap gap-2">
            <button
              onClick={() => setActiveAdminTab("dashboard")}
              className={`rounded-full px-4 py-2 ${
                activeAdminTab === "dashboard"
                  ? "bg-rose-700 text-white"
                  : "border border-stone-300 bg-white text-stone-800"
              }`}
            >
              📊 Dashboard
            </button>
            <button
              onClick={() => setActiveAdminTab("comments")}
              className={`rounded-full px-4 py-2 ${
                activeAdminTab === "comments"
                  ? "bg-rose-700 text-white"
                  : "border border-stone-300 bg-white text-stone-800"
              }`}
            >
              ✅ Pending Comments
            </button>
            <button
              onClick={() => setActiveAdminTab("allComments")}
              className={`rounded-full px-4 py-2 ${
                activeAdminTab === "allComments"
                  ? "bg-rose-700 text-white"
                  : "border border-stone-300 bg-white text-stone-800"
              }`}
            >
              💬 All Comments
            </button>
            <button
              onClick={() => setActiveAdminTab("settings")}
              className={`rounded-full px-4 py-2 ${
                activeAdminTab === "settings"
                  ? "bg-rose-700 text-white"
                  : "border border-stone-300 bg-white text-stone-800"
              }`}
            >
              🔐 Settings
            </button>
            <button
              onClick={() => setActiveAdminTab("emails")}
              className={`rounded-full px-4 py-2 ${
                activeAdminTab === "emails"
                  ? "bg-rose-700 text-white"
                  : "border border-stone-300 bg-white text-stone-800"
              }`}
            >
              📧 Emails
            </button>
          </div>

          {/* Dashboard Tab */}
          {activeAdminTab === "dashboard" && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-4">
                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
                  <p className="text-sm text-stone-500">Pending Comments</p>
                  <p className="text-3xl font-bold text-rose-700">{stats.pendingComments}</p>
                </div>
                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
                  <p className="text-sm text-stone-500">Total Comments</p>
                  <p className="text-3xl font-bold text-blue-600">{stats.totalComments}</p>
                </div>
                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
                  <p className="text-sm text-stone-500">Total Images</p>
                  <p className="text-3xl font-bold text-green-600">{stats.totalImages}</p>
                </div>
                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
                  <p className="text-sm text-stone-500">Total Likes</p>
                  <p className="text-3xl font-bold text-amber-600">{stats.totalLikes}</p>
                </div>
              </div>
              <button
                onClick={exportToCSV}
                className="rounded-xl bg-green-600 px-6 py-3 text-white transition hover:opacity-90"
              >
                📥 Export All Comments to CSV
              </button>
            </div>
          )}

          {/* Pending Comments Tab */}
          {activeAdminTab === "comments" && (
            <div className="space-y-4">
              {loadingComments ? (
                <p className="text-stone-600">Loading pending comments...</p>
              ) : pendingComments.length === 0 ? (
                <p className="text-stone-600">No pending comments.</p>
              ) : (
                pendingComments.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200"
                  >
                    <img
                      src={c.imageUrl}
                      alt={c.filename}
                      className="h-20 w-20 rounded-xl object-cover ring-1 ring-stone-200"
                    />

                    <div className="flex-1">
                      <p className="text-sm font-semibold text-stone-800">{c.comment_text}</p>
                      <p className="text-xs text-stone-500">
                        {c.category} / {c.filename}
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => approveComment(c.id)}
                        className="rounded-xl bg-green-600 px-4 py-2 text-white"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => rejectComment(c.id)}
                        className="rounded-xl bg-stone-500 px-4 py-2 text-white"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* All Comments Tab */}
          {activeAdminTab === "allComments" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  placeholder="Search comments by text, filename, or category..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 rounded-xl border border-stone-300 px-4 py-2"
                />
                <button
                  onClick={exportToCSV}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-white"
                >
                  📥 Export
                </button>
              </div>

              {loadingComments ? (
                <p className="text-stone-600">Loading comments...</p>
              ) : filteredComments.length === 0 ? (
                <p className="text-stone-600">No comments match your search.</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-stone-600">
                    Showing {filteredComments.length} of {allComments.length} comments
                  </p>
                  {filteredComments.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200"
                    >
                      {editingComment === c.id ? (
                        <div className="space-y-2">
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="w-full rounded-xl border border-stone-300 px-3 py-2"
                            rows={3}
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveEditComment(c.id)}
                              className="rounded-xl bg-green-600 px-4 py-2 text-white"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingComment(null)}
                              className="rounded-xl bg-stone-400 px-4 py-2 text-white"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="text-sm font-semibold text-stone-800">{c.comment_text}</p>
                              <p className="mt-1 text-xs text-stone-500">
                                {c.category} / {c.filename} • {c.created_at}
                              </p>
                              <span
                                className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-medium text-white ${
                                  c.approved ? "bg-green-600" : "bg-amber-600"
                                }`}
                              >
                                {c.approved ? "Approved" : "Pending"}
                              </span>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => startEditComment(c)}
                                className="rounded-xl bg-blue-600 px-3 py-2 text-sm text-white"
                              >
                                ✏️ Edit
                              </button>
                              <button
                                onClick={() => deleteComment(c.id)}
                                className="rounded-xl bg-red-600 px-3 py-2 text-sm text-white"
                              >
                                🗑️ Delete
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Settings Tab */}
          {activeAdminTab === "settings" && (
            <div className="space-y-6">
              <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
                <h2 className="mb-6 text-xl font-semibold text-stone-800">Change Password</h2>

                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-stone-700">
                      Current Password
                    </label>
                    <input
                      type="password"
                      value={oldPassword}
                      onChange={(e) => setOldPassword(e.target.value)}
                      className="w-full rounded-xl border border-stone-300 px-4 py-3"
                      placeholder="Enter current password"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-stone-700">
                      New Password
                    </label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full rounded-xl border border-stone-300 px-4 py-3"
                      placeholder="Enter new password (min 6 characters)"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-stone-700">
                      Confirm New Password
                    </label>
                    <input
                      type="password"
                      value={newPasswordConfirm}
                      onChange={(e) => setNewPasswordConfirm(e.target.value)}
                      className="w-full rounded-xl border border-stone-300 px-4 py-3"
                      placeholder="Confirm new password"
                    />
                  </div>

                  {passwordError && (
                    <p className="rounded-xl bg-red-100 p-3 text-sm text-red-700">{passwordError}</p>
                  )}

                  {passwordSuccess && (
                    <p className="rounded-xl bg-green-100 p-3 text-sm text-green-700">{passwordSuccess}</p>
                  )}

                  <button
                    onClick={handleChangePassword}
                    className="mt-4 rounded-xl bg-blue-600 px-6 py-3 text-white transition hover:opacity-90"
                  >
                    Update Password
                  </button>
                </div>
              </div>

              <div className="rounded-2xl bg-stone-50 p-6 ring-1 ring-stone-200">
                <h3 className="mb-3 font-semibold text-stone-800">Account Information</h3>
                <p className="text-sm text-stone-600">Admin Username: <span className="font-medium">{adminUser}</span></p>
                <p className="mt-2 text-sm text-stone-600">For password reset assistance, contact: nanda73@yahoo.com</p>
              </div>
            </div>
          )}

          {/* Emails Tab */}
          {activeAdminTab === "emails" && (
            <div className="space-y-4">
              {emails.map((e) => (
                <div
                  key={e.id}
                  className="flex justify-between rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200"
                >
                  <div>
                    <p className="text-stone-800">{e.msg}</p>
                    <p className="text-sm text-stone-500">{e.from}</p>
                  </div>

                  <button
                    onClick={() =>
                      setEmails((prev) =>
                        prev.map((x) => (x.id === e.id ? { ...x, status: "ack" } : x))
                      )
                    }
                    className="rounded-xl bg-blue-600 px-4 py-2 text-white"
                  >
                    Acknowledge
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}