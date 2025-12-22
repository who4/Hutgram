let currentUser = null;
let viewedUser = null;
let selectedCategories = [];
let searchTimeout = null;
let followModalMode = "followers"; // or "following"

// -------------------- helpers --------------------

async function toDataUrl(file, maxBytes) {
  if (!file) return "";
  if (file.size > maxBytes) {
    throw new Error(`File too large. Max ${(maxBytes / (1024 * 1024)).toFixed(0)}MB`);
  }
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("File read failed"));
    r.readAsDataURL(file);
  });
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// -------------------- init login --------------------

async function initLogin() {
  const catRes = await fetch("/api/categories");
  const categories = await catRes.json();

  const grid = document.getElementById("categoryGrid");
  grid.innerHTML = categories
    .map((cat) => `<div class="category-chip" onclick="toggleCategory('${cat}')">${cat}</div>`)
    .join("");

  // also fill postCategory dropdown (later, but safe)
  const postSelect = document.getElementById("postCategory");
  if (postSelect) {
    postSelect.innerHTML = `<option value="">Select...</option>` + categories.map(c => `<option value="${c}">${c}</option>`).join("");
  }
}

function toggleCategory(category) {
  document.querySelectorAll(".category-chip").forEach((chip) => {
    if (chip.textContent === category) chip.classList.toggle("selected");
  });

  if (selectedCategories.includes(category)) {
    selectedCategories = selectedCategories.filter((c) => c !== category);
  } else {
    selectedCategories.push(category);
  }
}

async function login() {
  try {
    const username = document.getElementById("loginUsername").value.trim().toLowerCase();
    const name = document.getElementById("loginName").value.trim();
    const bio = document.getElementById("loginBio").value.trim();
    const avatarFile = document.getElementById("loginAvatar").files[0];

    if (!username || !name) {
      alert("Username and Name are required.");
      return;
    }
    if (selectedCategories.length < 1) {
      alert("Select at least 1 category.");
      return;
    }

    const avatar = await toDataUrl(avatarFile, 8 * 1024 * 1024);

    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, name, bio, avatar, categories: selectedCategories })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Login failed");
      return;
    }

    currentUser = data.username;
    viewedUser = currentUser;

    document.getElementById("loginPage").style.display = "none";
    document.getElementById("mainApp").style.display = "block";
    document.getElementById("whoAmI").textContent = `Logged in as: @${currentUser}`;

    await initApp();
  } catch (e) {
    alert(e.message || "Login error");
  }
}

async function initApp() {
  await loadCategoriesIntoPostSelect();
  await loadProfile(viewedUser);
}

// -------------------- categories for posting --------------------

async function loadCategoriesIntoPostSelect() {
  const catRes = await fetch("/api/categories");
  const categories = await catRes.json();
  const postSelect = document.getElementById("postCategory");
  postSelect.innerHTML =
    `<option value="">Select...</option>` +
    categories.map((c) => `<option value="${c}">${c}</option>`).join("");
}

// -------------------- profile --------------------

async function loadProfile(username) {
  const res = await fetch(`/api/user/${username}`);
  if (!res.ok) {
    alert("User not found");
    return;
  }
  const profile = await res.json();

  viewedUser = profile.username;

  document.getElementById("profileUsername").textContent = profile.username;
  document.getElementById("profileName").textContent = profile.name;
  document.getElementById("profileBio").textContent = profile.bio || "No bio yet";
  document.getElementById("postsCount").textContent = profile.postsCount;
  document.getElementById("followersCount").textContent = profile.followersCount;
  document.getElementById("followingCount").textContent = profile.followingCount;

  const avatarDiv = document.getElementById("profileAvatar");
  if (profile.avatar) {
    avatarDiv.innerHTML = `<img src="${profile.avatar}" alt="${escapeHtml(profile.name)}">`;
  } else {
    avatarDiv.innerHTML = `<span id="avatarInitial">${escapeHtml(profile.name.charAt(0).toUpperCase())}</span>`;
  }

  const catContainer = document.getElementById("profileCategories");
  catContainer.innerHTML = (profile.categories || [])
    .map((cat) => `<div class="category-badge">${escapeHtml(cat)}</div>`)
    .join("");

  // follow button on profile (only when viewing someone else)
  const btn = document.getElementById("profileFollowBtn");
  if (viewedUser !== currentUser) {
    btn.style.display = "inline-block";
    const f = await fetch(`/api/isfollowing/${currentUser}/${viewedUser}`);
    const fd = await f.json();
    btn.classList.toggle("following", fd.isFollowing);
    btn.textContent = fd.isFollowing ? "Following" : "Follow";
  } else {
    btn.style.display = "none";
  }

  await loadPosts(viewedUser);
  await loadSuggestions(currentUser);
  await loadExplore(currentUser);
}

// Browse another user WITHOUT changing currentUser
function viewUser(username) {
  // force home tab
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
  document.querySelectorAll(".tab")[0].classList.add("active");
  document.getElementById("homeTab").classList.add("active");

  loadProfile(username);
}

async function toggleProfileFollow() {
  if (viewedUser === currentUser) return;
  const btn = document.getElementById("profileFollowBtn");
  const isFollowing = btn.classList.contains("following");
  const endpoint = isFollowing ? "/api/unfollow" : "/api/follow";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ follower: currentUser, following: viewedUser })
  });

  if (res.ok) {
    btn.classList.toggle("following");
    btn.textContent = isFollowing ? "Follow" : "Following";
    // refresh stats
    setTimeout(() => loadProfile(viewedUser), 200);
  }
}

// -------------------- posts --------------------

async function createPost() {
  try {
    const caption = document.getElementById("postCaption").value.trim();
    const category = document.getElementById("postCategory").value;
    const imgFile = document.getElementById("postImage").files[0];

    if (!caption) {
      alert("Caption is required.");
      return;
    }
    if (!category) {
      alert("Category is required.");
      return;
    }

    const image = await toDataUrl(imgFile, 8 * 1024 * 1024);

    const res = await fetch("/api/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: currentUser, caption, image, category })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Failed to post");
      return;
    }

    document.getElementById("postCaption").value = "";
    document.getElementById("postImage").value = "";
    document.getElementById("postCategory").value = "";

    // refresh
    await loadProfile(currentUser);
    await loadExplore(currentUser);
    alert("Posted ✅");
  } catch (e) {
    alert(e.message || "Post error");
  }
}

async function loadPosts(username) {
  const res = await fetch(`/api/user/${username}/posts`);
  const posts = await res.json();
  const grid = document.getElementById("postsGrid");

  if (!posts.length) {
    grid.innerHTML = '<div class="empty-state">No posts yet</div>';
    return;
  }

  grid.innerHTML = posts
    .map(
      (post) => `
      <div class="post-card">
        <div class="post-image">${post.image ? `<img src="${post.image}" alt="Post">` : "📷"}</div>
        <div class="post-info">
          <div class="post-actions">
            <div class="action-btn">❤️ <span class="action-count">${post.likes}</span></div>
            <div class="action-btn">📤 <span class="action-count">${post.shares}</span></div>
          </div>
          <div class="post-caption">${escapeHtml(post.caption)}</div>
          ${
            post.categories?.length
              ? `<div class="post-categories">${post.categories
                  .map((c) => `<div class="post-category-tag">${escapeHtml(c)}</div>`)
                  .join("")}</div>`
              : ""
          }
        </div>
      </div>
    `
    )
    .join("");
}

// -------------------- suggestions --------------------

async function loadSuggestions(username) {
  const res = await fetch(`/api/suggestions/${username}`);
  const people = await res.json();
  const peopleList = document.getElementById("peopleList");

  if (!people.length) {
    peopleList.innerHTML = '<div class="empty-state">No suggestions yet. Follow people to build a graph.</div>';
    return;
  }

  const peopleWithStatus = await Promise.all(
    people.map(async (person) => {
      const followRes = await fetch(`/api/isfollowing/${currentUser}/${person.username}`);
      const followData = await followRes.json();
      return { ...person, isFollowing: followData.isFollowing };
    })
  );

  peopleList.innerHTML = peopleWithStatus
    .map(
      (p) => `
    <div class="person-card">
      <div class="person-avatar" onclick="viewUser('${p.username}')">
        ${p.avatar ? `<img src="${p.avatar}" alt="${escapeHtml(p.name)}">` : escapeHtml(p.name.charAt(0).toUpperCase())}
      </div>
      <div class="person-info" onclick="viewUser('${p.username}')">
        <div class="person-username">@${escapeHtml(p.username)}</div>
        <div class="person-name">${escapeHtml(p.name)}${p.mutualFriends > 0 ? ` · ${p.mutualFriends} mutual` : ""}</div>
        ${p.categoryMatch > 0 ? `<div class="person-name">${p.categoryMatch} shared interests</div>` : ""}
      </div>
      <button class="follow-btn ${p.isFollowing ? "following" : ""}" onclick="toggleFollow('${p.username}', this)">
        ${p.isFollowing ? "Following" : "Follow"}
      </button>
    </div>
  `
    )
    .join("");
}

async function toggleFollow(username, button) {
  const isFollowing = button.classList.contains("following");
  const endpoint = isFollowing ? "/api/unfollow" : "/api/follow";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ follower: currentUser, following: username })
  });

  if (res.ok) {
    button.classList.toggle("following");
    button.textContent = isFollowing ? "Follow" : "Following";
    setTimeout(() => loadProfile(viewedUser), 200);
  }
}

// -------------------- explore --------------------

async function loadExplore(username) {
  const res = await fetch(`/api/explore/${username}`);
  const posts = await res.json();
  const grid = document.getElementById("explorePosts");

  if (!posts.length) {
    grid.innerHTML = '<div class="empty-state">No explore posts yet.</div>';
    return;
  }

  grid.innerHTML = posts
    .map(
      (post) => `
      <div class="post-card">
        <div class="post-image">${post.image ? `<img src="${post.image}" alt="Post">` : "📷"}</div>
        <div class="post-info">
          <div class="post-actions">
            <button class="action-btn" onclick="toggleLike('${post.id}', this)" data-liked="${post.alreadyLiked}">
              ${post.alreadyLiked ? "❤️" : "🤍"}
              <span class="action-count" id="likes-${post.id}">${post.likes}</span>
            </button>
            <button class="action-btn" onclick="toggleShare('${post.id}', this)" data-shared="${post.alreadyShared}">
              ${post.alreadyShared ? "📤" : "📨"}
              <span class="action-count" id="shares-${post.id}">${post.shares}</span>
            </button>
          </div>
          <div class="post-caption">
            <strong style="cursor:pointer" onclick="viewUser('${post.author}')">@${escapeHtml(post.author)}</strong>
            ${escapeHtml(post.caption)}
          </div>
          ${
            post.categories?.length
              ? `<div class="post-categories">${post.categories
                  .map((c) => `<div class="post-category-tag">${escapeHtml(c)}</div>`)
                  .join("")}</div>`
              : ""
          }
        </div>
      </div>
    `
    )
    .join("");
}

async function toggleLike(postId, button) {
  const isLiked = button.dataset.liked === "true";
  const endpoint = isLiked ? "/api/unlike" : "/api/like";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: currentUser, postId })
  });

  if (res.ok) {
    button.dataset.liked = (!isLiked).toString();
    const likesEl = document.getElementById(`likes-${postId}`);
    likesEl.textContent = String(parseInt(likesEl.textContent, 10) + (isLiked ? -1 : 1));
    button.innerHTML = `${!isLiked ? "❤️" : "🤍"} <span class="action-count" id="likes-${postId}">${likesEl.textContent}</span>`;
  }
}

async function toggleShare(postId, button) {
  const isShared = button.dataset.shared === "true";
  const endpoint = isShared ? "/api/unshare" : "/api/share";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: currentUser, postId })
  });

  if (res.ok) {
    button.dataset.shared = (!isShared).toString();
    const sharesEl = document.getElementById(`shares-${postId}`);
    sharesEl.textContent = String(parseInt(sharesEl.textContent, 10) + (isShared ? -1 : 1));
    button.innerHTML = `${!isShared ? "📤" : "📨"} <span class="action-count" id="shares-${postId}">${sharesEl.textContent}</span>`;
  }
}

// -------------------- search --------------------

document.getElementById("searchInput").addEventListener("input", (e) => {
  clearTimeout(searchTimeout);
  const query = e.target.value.trim();
  if (query.length < 2) {
    document.getElementById("searchResults").classList.remove("show");
    return;
  }
  searchTimeout = setTimeout(() => searchUsers(query), 250);
});

async function searchUsers(query) {
  const res = await fetch(`/api/search/users?q=${encodeURIComponent(query)}`);
  const users = await res.json();
  const resultsDiv = document.getElementById("searchResults");

  if (!users.length) {
    resultsDiv.innerHTML = '<div style="padding: 15px; text-align: center; color: #8e8e8e;">No users found</div>';
  } else {
    resultsDiv.innerHTML = users
      .map(
        (u) => `
      <div class="search-result-item" onclick="viewUser('${u.username}'); document.getElementById('searchInput').value=''; document.getElementById('searchResults').classList.remove('show');">
        <div class="search-avatar">
          ${u.avatar ? `<img src="${u.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="${escapeHtml(u.name)}">` : escapeHtml(u.name.charAt(0).toUpperCase())}
        </div>
        <div>
          <div style="font-weight: 700; font-size: 14px;">@${escapeHtml(u.username)}</div>
          <div style="font-size: 12px; color: #8e8e8e;">${escapeHtml(u.name)}</div>
        </div>
      </div>
    `
      )
      .join("");
  }

  resultsDiv.classList.add("show");
}

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-box")) {
    document.getElementById("searchResults").classList.remove("show");
  }
});

// -------------------- tabs --------------------

function switchTab(tabName) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach((content) => content.classList.remove("active"));

  event.target.closest(".tab").classList.add("active");
  document.getElementById(tabName + "Tab").classList.add("active");
}

// -------------------- followers/following modal --------------------

async function openFollowModal(mode) {
  followModalMode = mode; // followers or following
  document.getElementById("followModalTitle").textContent =
    mode === "followers" ? `Followers of @${viewedUser}` : `Following of @${viewedUser}`;

  const endpoint = mode === "followers"
    ? `/api/user/${viewedUser}/followers`
    : `/api/user/${viewedUser}/following`;

  const res = await fetch(endpoint);
  const list = await res.json();
  const body = document.getElementById("followModalBody");

  if (!list.length) {
    body.innerHTML = `<div style="padding:14px;color:#888;text-align:center">Empty</div>`;
  } else {
    body.innerHTML = list.map(u => `
      <div class="modal-item" onclick="closeFollowModal(); viewUser('${u.username}')">
        <div class="mini-avatar">
          ${u.avatar ? `<img src="${u.avatar}" alt="${escapeHtml(u.name)}">` : escapeHtml(u.name.charAt(0).toUpperCase())}
        </div>
        <div>
          <div style="font-weight:800">@${escapeHtml(u.username)}</div>
          <div class="mini-name">${escapeHtml(u.name)}</div>
        </div>
      </div>
    `).join("");
  }

  document.getElementById("followModal").style.display = "flex";
}

function closeFollowModal() {
  document.getElementById("followModal").style.display = "none";
}

// -------------------- start --------------------

initLogin();
