let currentUser = null;
let viewedUser = null;
let selectedCategories = [];
let exploreSearchTimer = null;

/* ---------- COOKIES ---------- */
function setCookie(name, value) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=2592000`;
}
function getCookie(name) {
  const row = document.cookie.split("; ").find(r => r.startsWith(name + "="));
  return row ? decodeURIComponent(row.split("=")[1]) : null;
}

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function fileToDataUrl(file, maxBytes = 8 * 1024 * 1024) {
  if (!file) return "";
  if (file.size > maxBytes) throw new Error("File too large (max 8MB).");
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Failed to read file"));
    r.readAsDataURL(file);
  });
}

/* ---------- INIT ---------- */
async function init() {
  const cats = await fetch("/api/categories").then(r => r.json());

  $("categoryGrid").innerHTML = cats.map(c =>
    `<div class="category-chip" onclick="toggleCat('${c}', this)">${c}</div>`
  ).join("");

  $("postCategory").innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join("");

  // Hook explore search
  $("exploreSearchInput").addEventListener("input", () => {
    clearTimeout(exploreSearchTimer);
    const q = $("exploreSearchInput").value.trim();
    if (q.length < 2) {
      $("exploreSearchResults").classList.remove("show");
      $("exploreSearchResults").innerHTML = "";
      return;
    }
    exploreSearchTimer = setTimeout(() => exploreSearchUsers(q), 250);
  });

  // Auto login
  const saved = getCookie("hutgram_user");
  if (saved) {
    currentUser = saved;
    viewedUser = saved;
    $("loginPage").style.display = "none";
    $("mainApp").style.display = "block";
    $("whoAmI").textContent = "@" + currentUser;

    setActiveNav("home");
    await goHome();
  } else {
    $("loginPage").style.display = "flex";
    $("mainApp").style.display = "none";
  }
}
init();

/* ---------- LOGIN ---------- */
function toggleCat(cat, el) {
  el.classList.toggle("selected");
  if (selectedCategories.includes(cat)) selectedCategories = selectedCategories.filter(c => c !== cat);
  else selectedCategories.push(cat);
}

async function login() {
  try {
    const username = $("loginUsername").value.trim().toLowerCase();
    const name = $("loginName").value.trim();
    const bio = $("loginBio").value.trim();
    const avatarFile = $("loginAvatar").files[0];

    if (!username || !name) return alert("Username and Name are required.");
    if (selectedCategories.length < 1) return alert("Pick at least 1 category.");

    const avatar = await fileToDataUrl(avatarFile);

    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, name, bio, avatar, categories: selectedCategories })
    });

    const data = await res.json();
    if (!res.ok) return alert(data.error || "Login failed");

    currentUser = data.username;
    viewedUser = data.username;
    setCookie("hutgram_user", currentUser);

    $("loginPage").style.display = "none";
    $("mainApp").style.display = "block";
    $("whoAmI").textContent = "@" + currentUser;

    setActiveNav("home");
    await goHome();
  } catch (e) {
    alert(e.message || "Login error");
  }
}

/* ---------- NAV ---------- */
function setActiveNav(which) {
  $("navHome").classList.toggle("active", which === "home");
  $("navExplore").classList.toggle("active", which === "explore");
  $("navPost").classList.toggle("active", which === "post");
}

function switchTab(tab) {
  $("homeTab").style.display = "none";
  $("exploreTab").style.display = "none";
  $("postTab").style.display = "none";
  $(tab + "Tab").style.display = "block";

  if (tab === "explore") {
    setActiveNav("explore");
    loadExplore(currentUser);
  } else if (tab === "post") {
    setActiveNav("post");
  } else {
    setActiveNav("home");
  }
}

async function goHome() {
  viewedUser = currentUser;
  switchTab("home");
  await loadProfile(currentUser);
}

/* ---------- PROFILE ---------- */
async function loadProfile(u) {
  viewedUser = u;

  const pRes = await fetch("/api/user/" + u);
  if (!pRes.ok) return alert("User not found");
  const p = await pRes.json();

  $("profileUsername").textContent = p.username;
  $("profileBio").textContent = p.bio || "";
  $("postsCount").textContent = p.postsCount;
  $("followersCount").textContent = p.followersCount;
  $("followingCount").textContent = p.followingCount;

  if (p.avatar) $("profileAvatar").innerHTML = `<img src="${p.avatar}" alt="avatar">`;
  else $("profileAvatar").textContent = (p.name || p.username || "?").charAt(0).toUpperCase();

  const btn = $("profileFollowBtn");
  if (u !== currentUser) {
    btn.style.display = "inline-block";
    const f = await fetch(`/api/isfollowing/${currentUser}/${u}`).then(r => r.json());
    btn.classList.toggle("following", !!f.isFollowing);
    btn.textContent = f.isFollowing ? "Following" : "Follow";
  } else {
    btn.style.display = "none";
  }

  await loadPeopleYouMightKnow(currentUser); // suggestions depend on current user
  await loadPosts(u);
}

async function viewUser(u) {
  viewedUser = u;
  switchTab("home");
  await loadProfile(u);
}

/* ---------- FOLLOW ---------- */
async function toggleFollow() {
  if (!viewedUser || viewedUser === currentUser) return;

  const btn = $("profileFollowBtn");
  const isFollowing = btn.classList.contains("following");
  const endpoint = isFollowing ? "/api/unfollow" : "/api/follow";

  await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ follower: currentUser, following: viewedUser })
  });

  await loadProfile(viewedUser);
}

/* ---------- FOLLOWERS / FOLLOWING MODAL ---------- */
async function openFollowModal(mode) {
  const title = mode === "followers" ? `Followers of @${viewedUser}` : `Following of @${viewedUser}`;
  $("followModalTitle").textContent = title;

  const endpoint = mode === "followers"
    ? `/api/user/${viewedUser}/followers`
    : `/api/user/${viewedUser}/following`;

  const list = await fetch(endpoint).then(r => r.json());
  const body = $("followModalBody");

  if (!list.length) {
    body.innerHTML = `<div style="padding:14px;color:#777;text-align:center;">Empty</div>`;
  } else {
    body.innerHTML = list.map(u => `
      <div class="search-item" onclick="closeFollowModal(); viewUser('${u.username}')">
        <div class="mini-avatar">
          ${u.avatar ? `<img src="${u.avatar}" alt="a">` : escapeHtml((u.name||u.username).charAt(0).toUpperCase())}
        </div>
        <div>
          <div style="font-weight:900">@${escapeHtml(u.username)}</div>
          <div class="mini-name">${escapeHtml(u.name || "")}</div>
        </div>
      </div>
    `).join("");
  }

  $("followModalBackdrop").style.display = "flex";
}
function closeFollowModal() {
  $("followModalBackdrop").style.display = "none";
}

/* ---------- PEOPLE YOU MIGHT KNOW ---------- */
async function loadPeopleYouMightKnow(username) {
  const box = $("peopleYouMightKnow");
  box.innerHTML = `<div style="color:#777;font-size:12px">Loading...</div>`;

  const people = await fetch(`/api/suggestions/${username}`).then(r => r.json());

  if (!people.length) {
    box.innerHTML = `<div style="color:#777;font-size:12px">No suggestions yet. Follow someone to build the graph.</div>`;
    return;
  }

  // fetch follow status for each suggested user
  const enriched = await Promise.all(people.map(async (p) => {
    const f = await fetch(`/api/isfollowing/${currentUser}/${p.username}`).then(r => r.json());
    return { ...p, isFollowing: !!f.isFollowing };
  }));

  box.innerHTML = enriched.map(p => `
    <div class="person">
      <div class="mini-avatar" onclick="viewUser('${p.username}')" style="cursor:pointer">
        ${p.avatar ? `<img src="${p.avatar}" alt="a">` : escapeHtml((p.name||p.username).charAt(0).toUpperCase())}
      </div>
      <div class="info" onclick="viewUser('${p.username}')">
        <div class="u">@${escapeHtml(p.username)}</div>
        <div class="n">${escapeHtml(p.name || "")}${p.mutualFriends ? ` · ${p.mutualFriends} mutual` : ""}</div>
      </div>
      <button class="follow-btn ${p.isFollowing ? "following" : ""}" onclick="event.stopPropagation(); quickToggleFollow('${p.username}', this)">
        ${p.isFollowing ? "Following" : "Follow"}
      </button>
    </div>
  `).join("");
}

async function quickToggleFollow(targetUsername, button) {
  const isFollowing = button.classList.contains("following");
  const endpoint = isFollowing ? "/api/unfollow" : "/api/follow";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ follower: currentUser, following: targetUsername })
  });

  if (!res.ok) return;

  button.classList.toggle("following");
  button.textContent = isFollowing ? "Follow" : "Following";

  // Update counts if viewing current user
  if (viewedUser) loadProfile(viewedUser);
}

/* ---------- POSTS (PROFILE) ---------- */
async function loadPosts(u) {
  const posts = await fetch(`/api/user/${u}/posts`).then(r => r.json());
  const grid = $("postsGrid");

  if (!posts.length) {
    grid.innerHTML = `<div class="card" style="text-align:center;color:#666">No posts yet</div>`;
    return;
  }

  grid.innerHTML = posts.map(p => `
    <div class="post">
      ${p.image ? `<img src="${p.image}" alt="post">` : `<div style="height:220px;background:#eee"></div>`}
      <div class="post-body">
        <div class="like-row">
          <span style="font-weight:900">❤️</span>
          <span class="like-count">${p.likes}</span>
        </div>
        <div class="post-cap">${escapeHtml(p.caption)}</div>
      </div>
    </div>
  `).join("");
}

/* ---------- EXPLORE POSTS (LIKE WORKS) ---------- */
async function loadExplore(username) {
  const posts = await fetch(`/api/explore/${username}`).then(r => r.json());
  const grid = $("explorePosts");

  if (!posts.length) {
    grid.innerHTML = `<div class="card" style="text-align:center;color:#666">No explore posts yet</div>`;
    return;
  }

  grid.innerHTML = posts.map(p => `
    <div class="post">
      ${p.image ? `<img src="${p.image}" alt="post">` : `<div style="height:220px;background:#eee"></div>`}
      <div class="post-body">
        <div class="post-author" onclick="viewUser('${p.author}')">@${escapeHtml(p.author)}</div>

        <div class="like-row">
          <button class="like-btn" onclick="toggleLike('${p.id}', this)" data-liked="${p.alreadyLiked ? "true" : "false"}">
            ${p.alreadyLiked ? "❤️" : "🤍"}
          </button>
          <span class="like-count" id="likes-${p.id}">${p.likes}</span>
        </div>

        <div class="post-cap">${escapeHtml(p.caption)}</div>
      </div>
    </div>
  `).join("");
}

async function toggleLike(postId, btn) {
  const isLiked = btn.dataset.liked === "true";
  const endpoint = isLiked ? "/api/unlike" : "/api/like";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: currentUser, postId })
  });

  if (!res.ok) return;

  btn.dataset.liked = (!isLiked).toString();
  btn.textContent = !isLiked ? "❤️" : "🤍";

  const likesEl = $("likes-" + postId);
  likesEl.textContent = String(parseInt(likesEl.textContent, 10) + (isLiked ? -1 : 1));
}

/* ---------- EXPLORE USER SEARCH ---------- */
async function exploreSearchUsers(q) {
  const res = await fetch(`/api/search/users?q=${encodeURIComponent(q)}`);
  const users = await res.json();
  const box = $("exploreSearchResults");

  if (!users.length) {
    box.innerHTML = `<div style="padding:12px;color:#777;text-align:center;">No users found</div>`;
    box.classList.add("show");
    return;
  }

  box.innerHTML = users.map(u => `
    <div class="search-item" onclick="viewUser('${u.username}'); $('exploreSearchResults').classList.remove('show'); $('exploreSearchInput').value='';">
      <div class="mini-avatar">
        ${u.avatar ? `<img src="${u.avatar}" alt="a">` : escapeHtml((u.name||u.username).charAt(0).toUpperCase())}
      </div>
      <div>
        <div style="font-weight:900">@${escapeHtml(u.username)}</div>
        <div class="mini-name">${escapeHtml(u.name || "")}</div>
      </div>
    </div>
  `).join("");

  box.classList.add("show");
}

/* ---------- CREATE POST ---------- */
async function createPost() {
  try {
    const caption = $("postCaption").value.trim();
    const category = $("postCategory").value;
    const file = $("postImage").files[0];

    if (!caption) return alert("Caption is required.");
    if (!category) return alert("Category is required.");

    const image = await fileToDataUrl(file);

    const res = await fetch("/api/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: currentUser, caption, image, category })
    });

    const data = await res.json();
    if (!res.ok) return alert(data.error || "Failed to post");

    $("postCaption").value = "";
    $("postImage").value = "";

    await goHome();
  } catch (e) {
    alert(e.message || "Post error");
  }
}
