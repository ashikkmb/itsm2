const BASE = "/api";
const REQUEST_TIMEOUT_MS = 25000; // if the server doesn't respond in 25s, fail visibly rather than hang forever

export function getToken() { return localStorage.getItem("hd_token"); }
export function setToken(t) { localStorage.setItem("hd_token", t); }
export function clearToken() { localStorage.removeItem("hd_token"); localStorage.removeItem("hd_user"); }

async function req(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw new Error("The server took too long to respond. Please try again.");
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// Same as req(), but sends FormData (multipart) instead of JSON — used for
// requests that include a file attachment. Do NOT set Content-Type manually;
// the browser sets the correct multipart boundary automatically.
async function reqFormData(method, path, formData) {
  const headers = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Uploads can legitimately take longer than a normal request, so this gets
  // more headroom than the plain-JSON timeout above.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS * 4);
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: formData,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw new Error("The server took too long to respond. Please try again.");
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export const api = {
  // Auth
  login:          (email, password)      => req("POST", "/auth/login", { email, password }),
  me:             ()                     => req("GET",  "/auth/me"),
  changePassword: (currentPassword, newPassword) => req("POST", "/auth/change-password", { currentPassword, newPassword }),

  // Complaints
  getComplaints:  (params = {})          => req("GET",  "/complaints?" + new URLSearchParams(params)),
  getComplaint:   (id)                   => req("GET",  `/complaints/${id}`),
  getStats:       ()                     => req("GET",  "/complaints/stats"),
  createComplaint:(data)                 => {
    const formData = new FormData();
    formData.append("category", data.category);
    formData.append("title", data.title);
    formData.append("description", data.description || "");
    formData.append("complainant_name", data.complainant_name);
    (data.attachments || []).forEach(file => formData.append("attachments", file));
    return reqFormData("POST", "/complaints", formData);
  },
  updateStatus:   (id, status, comment, priority) => req("PATCH",`/complaints/${id}/status`, { status, comment, priority }),
  closeComplaint: (id, remarks)          => req("PATCH",`/complaints/${id}/close`, { remarks }),
  getActivity:    (id)                   => req("GET",  `/complaints/${id}/activity`),

  // Dashboard
  getDashboardSummary: ()                => req("GET", "/dashboard/summary"),

  // Software Repository (admin only)
  getSoftwareRepo:    (search = "")      => req("GET", `/software-repo${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  deleteSoftware:     (id)               => req("DELETE", `/software-repo/${id}`),
  // XHR (not fetch) so upload progress can be reported — installers can be
  // large. onProgress receives a 0-100 integer. Returns { promise, abort }.
  uploadSoftware:     (title, description, file, onProgress) => {
    const formData = new FormData();
    formData.append("title", title);
    formData.append("description", description || "");
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/software-repo`);
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    const promise = new Promise((resolve, reject) => {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || "Upload failed"));
      };
      xhr.onerror = () => reject(new Error("Upload failed — check your connection."));
      xhr.onabort = () => reject(new Error("Upload cancelled."));
    });
    xhr.send(formData);

    return { promise, abort: () => xhr.abort() };
  },

  // Users (admin)
  getUsers:       ()                     => req("GET",  "/users"),
  createUser:     (data)                 => req("POST", "/users", data),
  deleteUser:     (id)                   => req("DELETE",`/users/${id}`),
  resetPassword:  (id, newPassword)      => req("PATCH",`/users/${id}/reset-password`, { newPassword }),
  updateUserRole: (id, role)             => req("PATCH",`/users/${id}/role`, { role }),

  // Settings — Role Management (module access control, admin only)
  getModuleCatalog:   ()                 => req("GET",  "/settings/modules"),
  getDefaultModules:  ()                 => req("GET",  "/settings/default-modules"),
  setDefaultModules:  (modules)          => req("PUT",  "/settings/default-modules", { modules }),
  getRoleAccess:      ()                 => req("GET",  "/settings/role-access"),
  setUserModules:     (userId, modules)  => req("PUT",  `/settings/role-access/${userId}`, { modules }),

  // Knowledge References
  getKnowledgeDocs: ()                   => req("GET",  "/knowledge"),
  uploadKnowledgeDoc: (data)             => {
    const formData = new FormData();
    formData.append("title", data.title);
    formData.append("description", data.description || "");
    formData.append("file", data.file);
    return reqFormData("POST", "/knowledge", formData);
  },
  deleteKnowledgeDoc: (id)               => req("DELETE", `/knowledge/${id}`),

  // Lunch Pass (Services > Lunch Pass)
  getLunchPasses:    (params = {})       => req("GET",  "/lunch-passes?" + new URLSearchParams(params)),
  getLunchPass:      (id)                => req("GET",  `/lunch-passes/${id}`),
  createLunchPass:   (data)              => {
    const formData = new FormData();
    formData.append("pass_no", data.pass_no || "");
    formData.append("name", data.name);
    formData.append("id_no", data.id_no || "");
    formData.append("designation", data.designation || "");
    formData.append("mobile", data.mobile || "");
    formData.append("section", data.section || "");
    formData.append("gate", data.gate);
    formData.append("valid_from", data.valid_from || "");
    formData.append("photo_position_x", data.photo_position_x ?? 50);
    formData.append("photo_position_y", data.photo_position_y ?? 50);
    if (data.photo) formData.append("photo", data.photo);
    return reqFormData("POST", "/lunch-passes", formData);
  },
  updateLunchPass:   (id, data)          => {
    const formData = new FormData();
    formData.append("pass_no", data.pass_no || "");
    formData.append("name", data.name);
    formData.append("id_no", data.id_no || "");
    formData.append("designation", data.designation || "");
    formData.append("mobile", data.mobile || "");
    formData.append("section", data.section || "");
    formData.append("gate", data.gate);
    formData.append("photo_position_x", data.photo_position_x ?? 50);
    formData.append("photo_position_y", data.photo_position_y ?? 50);
    if (data.photo) formData.append("photo", data.photo);
    return reqFormData("PATCH", `/lunch-passes/${id}`, formData);
  },
  renewLunchPass:    (id)                => req("PATCH", `/lunch-passes/${id}/renew`),
  setLunchPassStatus:(id, status)        => req("PATCH", `/lunch-passes/${id}/status`, { status }),
  deleteLunchPass:   (id)                => req("DELETE", `/lunch-passes/${id}`),

  // Tasks
  getTasks:          (params = {})       => req("GET",  "/tasks?" + new URLSearchParams(params)),
  getTask:           (id)                => req("GET",  `/tasks/${id}`),
  getDueTasks:       ()                  => req("GET",  "/tasks/due"),
  createTask:        (data)              => {
    const formData = new FormData();
    formData.append("title", data.title);
    formData.append("description", data.description || "");
    formData.append("priority", data.priority || "Medium");
    formData.append("due_date", data.due_date);
    if (data.assignee_type) formData.append("assignee_type", data.assignee_type);
    if (data.assigned_to !== undefined && data.assigned_to !== null) formData.append("assigned_to", data.assigned_to);
    if (data.attachment) formData.append("attachment", data.attachment);
    return reqFormData("POST", "/tasks", formData);
  },
  updateTask:        (id, data)          => req("PATCH", `/tasks/${id}`, data),
  updateTaskStatus:  (id, status)        => req("PATCH", `/tasks/${id}/status`, { status }),
  deleteTask:        (id)                => req("DELETE", `/tasks/${id}`),
  getTaskComments:   (id)                => req("GET",  `/tasks/${id}/comments`),
  addTaskComment:    (id, comment, attachment) => {
    const formData = new FormData();
    formData.append("comment", comment || "");
    if (attachment) formData.append("attachment", attachment);
    return reqFormData("POST", `/tasks/${id}/comments`, formData);
  },

  // IT Staff directory (named staff for task assignment — not login accounts)
  getStaff:          (includeInactive = false) => req("GET", `/staff${includeInactive ? "?include_inactive=1" : ""}`),
  addStaff:          (data)              => req("POST", "/staff", data),
  updateStaff:       (id, data)          => req("PATCH", `/staff/${id}`, data),
  deleteStaff:       (id)                => req("DELETE", `/staff/${id}`),

  // File Sharing Portal
  getUserDirectory:  ()                  => req("GET", "/users/directory"),
  getFileShares:     ()                  => req("GET", "/file-sharing"),
  deleteFileShare:   (id)                => req("DELETE", `/file-sharing/${id}`),
  // Uses XMLHttpRequest instead of fetch specifically so upload progress can
  // be reported — fetch has no cross-browser way to observe upload progress,
  // only download progress. onProgress receives a 0-100 integer. Returns
  // { promise, abort } — call abort() to cancel a share still in progress.
  shareFile:         (recipientId, message, file, onProgress) => {
    const formData = new FormData();
    formData.append("recipient_id", recipientId);
    formData.append("message", message || "");
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/file-sharing`);
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    const promise = new Promise((resolve, reject) => {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || "Upload failed"));
      };
      xhr.onerror = () => reject(new Error("Upload failed — check your connection."));
      xhr.onabort = () => reject(new Error("Upload cancelled."));
    });
    xhr.send(formData);

    return { promise, abort: () => xhr.abort() };
  },

  // Task & File Tracking System
  getFileTrackingStatuses: ()            => req("GET", "/file-tracking/statuses"),
  getFileTrackingStats:    ()            => req("GET", "/file-tracking/stats"),
  getFileTrackingTasks:    (params = {}) => req("GET", "/file-tracking/tasks?" + new URLSearchParams(params)),
  getFileTrackingTask:     (id)          => req("GET", `/file-tracking/tasks/${id}`),
  createFileTrackingTask:  (data, files = []) => {
    const formData = new FormData();
    Object.entries(data).forEach(([k, v]) => { if (v !== undefined && v !== null) formData.append(k, v); });
    files.forEach(f => formData.append("attachments", f));
    return reqFormData("POST", "/file-tracking/tasks", formData);
  },
  addFileTrackingUpdate:   (id, data, files = []) => {
    const formData = new FormData();
    Object.entries(data).forEach(([k, v]) => { if (v !== undefined && v !== null) formData.append(k, v); });
    files.forEach(f => formData.append("attachments", f));
    return reqFormData("POST", `/file-tracking/tasks/${id}/updates`, formData);
  },
  pinFileTrackingTask:     (id)          => req("POST", `/file-tracking/tasks/${id}/pin`),
  unpinFileTrackingTask:   (id)          => req("DELETE", `/file-tracking/tasks/${id}/pin`),
  deleteFileTrackingTask:  (id)          => req("DELETE", `/file-tracking/tasks/${id}`),
};

// Authenticated file download URL — the token travels as a query param
// because a plain <a href> can't set an Authorization header (same
// approach already used for the live notification stream).
export function fileShareDownloadUrl(id) {
  return `${BASE}/file-sharing/${id}/download?token=${encodeURIComponent(getToken() || "")}`;
}

export function fileTrackingDownloadUrl(id) {
  return `${BASE}/file-tracking/attachments/${id}/download?token=${encodeURIComponent(getToken() || "")}`;
}
export function fileTrackingViewUrl(id) {
  return `${BASE}/file-tracking/attachments/${id}/view?token=${encodeURIComponent(getToken() || "")}`;
}

export function softwareRepoDownloadUrl(id) {
  return `${BASE}/software-repo/${id}/download?token=${encodeURIComponent(getToken() || "")}`;
}

// "Open in Word" deep link for a task/comment Word attachment. `wopiId` is
// "t<taskId>" for a task's own attachment or "c<commentId>" for a comment's
// attachment (matches the id scheme routes/wopi.js expects). Needs the full
// origin, not just BASE ("/api") — this link is handed to the desktop Word
// app via the OS's ms-word: protocol handler, not fetched by the browser,
// so a relative URL wouldn't resolve to anything.
export function wopiEditUrl(wopiId) {
  const action = `${window.location.origin}${BASE}/wopi/files/${wopiId}`;
  return `ms-word:ofe|u|${action}?access_token=${encodeURIComponent(getToken() || "")}`;
}
