let currentUser = null;
let selectedCategories = [];
let searchTimeout = null;

// ==================== INITIALIZATION ====================

async function initLogin() {
  // Load categories
  const catRes = await fetch("/api/categories");
  const categories = await catRes.json();
  
  const grid = document.getElementById("categoryGrid");
  grid.innerHTML = categories.map(cat => `
    <div class="category-chip" onclick="toggleCategory('${cat}')">${cat}</div>
  `).join("");
  
  // Load users
  const userRes = await fetch("/api/users");
  const users = await userRes.json();
  
  const select = document.getElementById("userSelectLogin");
  select.innerHTML = '<option value="">Select your account...</option>' +
    users.map(u => `<option value="${u.username}">${u.name} (@${u.username})</option>`).join("");
}

function toggleCategory(category) {
  const chips = document.querySelectorAll('.category-chip');
  chips.forEach(chip => {
    if (chip.textContent === category) {
      chip.classList.toggle('selected');
    }
  });
  
  if (selectedCategories.includes(category)) {
    selectedCategories = selectedCategories.filter(c => c !== category);
  } else {
    selectedCategories.push(category);
  }
}

function login() {
  const username = document.getElementById("userSelectLogin").value;
  if (!username) {
    alert("Please select an account");
    return;
  }
  
  currentUser = username;
  document.getElementById("loginPage").style.display = "none";
  document.getElementById("mainApp").style.display = "block";
  
  initApp();
}

async function initApp() {
  await loadUsers();
  document.getElementById("userSelect").value = currentUser;
  await loadProfile(currentUser);
}

// ==================== USER MANAGEMENT ====================

async function loadUsers() {
  try {
    const res = await fetch("/api/users");
    const users = await res.json();
    const select = document.getElementById("userSelect");
    select.innerHTML = "";

    users.forEach(u => {
      const opt = document.createElement("option");
      opt.value = u.username;
      opt.textContent = `${u.name} (@${u.username})`;
      select.appendChild(opt);
    });
  } catch (error) {
    console.error("Error loading users:", error);
  }
}

async function loadProfile(username) {
  try {
    const res = await fetch(`/api/user/${username}`);
    const profile = await res.json();

    document.getElementById("profileUsername").textContent = profile.username;
    document.getElementById("profileName").textContent = profile.name;
    document.getElementById("profileBio").textContent = profile.bio || "No bio yet";
    document.getElementById("postsCount").textContent = profile.postsCount;
    document.getElementById("followersCount").textContent = profile.followersCount;
    document.getElementById("followingCount").textContent = profile.followingCount;

    const avatarDiv = document.getElementById("profileAvatar");
    const avatarInitial = document.getElementById("avatarInitial");
    
    if (profile.avatar) {
      avatarDiv.innerHTML = `<img src="${profile.avatar}" alt="${profile.name}">`;
    } else {
      avatarInitial.textContent = profile.name.charAt(0).toUpperCase();
    }
    
    // Categories
    const catContainer = document.getElementById("profileCategories");
    if (profile.categories && profile.categories.length > 0) {
      catContainer.innerHTML = profile.categories.map(cat => 
        `<div class="category-badge">${cat}</div>`
      ).join("");
    } else {
      catContainer.innerHTML = "";
    }

    loadPosts(username);
    loadSuggestions(username);
    loadExplore(username);
  } catch (error) {
    console.error("Error loading profile:", error);
  }
}

// ==================== POSTS ====================

async function loadPosts(username) {
  try {
    const res = await fetch(`/api/user/${username}/posts`);
    const posts = await res.json();
    const grid = document.getElementById("postsGrid");

    if (posts.length === 0) {
      grid.innerHTML = '<div class="empty-state">No posts yet</div>';
      return;
    }

    grid.innerHTML = posts.map(post => `
      <div class="post-card">
        <div class="post-image">
          ${post.image ? `<img src="${post.image}" alt="Post">` : '📷'}
        </div>
        <div class="post-info">
          <div class="post-actions">
            <div class="action-btn">
              ❤️ <span class="action-count">${post.likes}</span>
            </div>
            <div class="action-btn">
              📤 <span class="action-count">${post.shares}</span>
            </div>
          </div>
          <div class="post-caption">${post.caption}</div>
          ${post.categories && post.categories.length > 0 ? `
            <div class="post-categories">
              ${post.categories.map(cat => `<div class="post-category-tag">${cat}</div>`).join("")}
            </div>
          ` : ''}
        </div>
      </div>
    `).join("");
  } catch (error) {
    console.error("Error loading posts:", error);
  }
}

// ==================== SUGGESTIONS ====================

async function loadSuggestions(username) {
  try {
    const res = await fetch(`/api/suggestions/${username}`);
    const people = await res.json();
    const peopleList = document.getElementById("peopleList");

    if (people.length === 0) {
      peopleList.innerHTML = '<div class="empty-state">No suggestions available. Follow more people!</div>';
      return;
    }

    const peopleWithStatus = await Promise.all(
      people.map(async person => {
        const followRes = await fetch(`/api/isfollowing/${currentUser}/${person.username}`);
        const followData = await followRes.json();
        return { ...person, isFollowing: followData.isFollowing };
      })
    );

    peopleList.innerHTML = peopleWithStatus.map(person => `
      <div class="person-card">
        <div class="person-avatar" onclick="switchUser('${person.username}')">
          ${person.avatar ? `<img src="${person.avatar}" alt="${person.name}">` : person.name.charAt(0).toUpperCase()}
        </div>
        <div class="person-info" onclick="switchUser('${person.username}')">
          <div class="person-username">${person.username}</div>
          <div class="person-name">${person.name}${person.mutualFriends > 0 ? ` · ${person.mutualFriends} mutual` : ''}</div>
          ${person.categoryMatch > 0 ? `<div class="person-name">${person.categoryMatch} shared interests</div>` : ''}
        </div>
        <button class="follow-btn ${person.isFollowing ? 'following' : ''}" 
                onclick="toggleFollow('${person.username}', this)">
          ${person.isFollowing ? 'Following' : 'Follow'}
        </button>
      </div>
    `).join("");
  } catch (error) {
    console.error("Error loading suggestions:", error);
  }
}

// ==================== EXPLORE ====================

async function loadExplore(username) {
  try {
    const res = await fetch(`/api/explore/${username}`);
    const posts = await res.json();
    const grid = document.getElementById("explorePosts");

    if (posts.length === 0) {
      grid.innerHTML = '<div class="empty-state">No explore posts yet. Follow more people to see personalized content!</div>';
      return;
    }

    grid.innerHTML = posts.map(post => `
      <div class="post-card">
        <div class="post-image">
          ${post.image ? `<img src="${post.image}" alt="Post">` : '📷'}
        </div>
        <div class="post-info">
          <div class="post-actions">
            <button class="action-btn" onclick="toggleLike('${post.id}', this)" data-liked="${post.alreadyLiked}">
              ${post.alreadyLiked ? '❤️' : '🤍'}
              <span class="action-count" id="likes-${post.id}">${post.likes}</span>
            </button>
            <button class="action-btn" onclick="toggleShare('${post.id}', this)" data-shared="${post.alreadyShared}">
              ${post.alreadyShared ? '📤' : '📨'}
              <span class="action-count" id="shares-${post.id}">${post.shares}</span>
            </button>
          </div>
          <div class="post-caption">
            <strong>@${post.author}</strong> ${post.caption}
          </div>
          ${post.categories && post.categories.length > 0 ? `
            <div class="post-categories">
              ${post.categories.map(cat => `<div class="post-category-tag">${cat}</div>`).join("")}
            </div>
          ` : ''}
        </div>
      </div>
    `).join("");
  } catch (error) {
    console.error("Error loading explore posts:", error);
  }
}

// ==================== INTERACTIONS ====================

async function toggleLike(postId, button) {
  const isLiked = button.dataset.liked === 'true';
  const endpoint = isLiked ? '/api/unlike' : '/api/like';
  
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser, postId })
    });

    if (res.ok) {
      button.dataset.liked = !isLiked;
      button.innerHTML = `${!isLiked ? '❤️' : '🤍'} <span class="action-count" id="likes-${postId}">${parseInt(document.getElementById(`likes-${postId}`).textContent) + (isLiked ? -1 : 1)}</span>`;
    }
  } catch (error) {
    console.error('Error toggling like:', error);
  }
}

async function toggleShare(postId, button) {
  const isShared = button.dataset.shared === 'true';
  const endpoint = isShared ? '/api/unshare' : '/api/share';
  
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser, postId })
    });

    if (res.ok) {
      button.dataset.shared = !isShared;
      button.innerHTML = `${!isShared ? '📤' : '📨'} <span class="action-count" id="shares-${postId}">${parseInt(document.getElementById(`shares-${postId}`).textContent) + (isShared ? -1 : 1)}</span>`;
    }
  } catch (error) {
    console.error('Error toggling share:', error);
  }
}

async function toggleFollow(username, button) {
  const isFollowing = button.classList.contains('following');
  const endpoint = isFollowing ? '/api/unfollow' : '/api/follow';
  
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ follower: currentUser, following: username })
    });

    if (res.ok) {
      button.classList.toggle('following');
      button.textContent = isFollowing ? 'Follow' : 'Following';
      
      if (!isFollowing) {
        setTimeout(() => loadProfile(currentUser), 500);
      }
    }
  } catch (error) {
    console.error('Error toggling follow:', error);
  }
}

// ==================== SEARCH ====================

document.getElementById("searchInput").addEventListener("input", (e) => {
  clearTimeout(searchTimeout);
  const query = e.target.value.trim();
  
  if (query.length < 2) {
    document.getElementById("searchResults").classList.remove("show");
    return;
  }
  
  searchTimeout = setTimeout(() => searchUsers(query), 300);
});

async function searchUsers(query) {
  try {
    const res = await fetch(`/api/search/users?q=${encodeURIComponent(query)}`);
    const users = await res.json();
    const resultsDiv = document.getElementById("searchResults");
    
    if (users.length === 0) {
      resultsDiv.innerHTML = '<div style="padding: 15px; text-align: center; color: #8e8e8e;">No users found</div>';
    } else {
      resultsDiv.innerHTML = users.map(user => `
        <div class="search-result-item" onclick="switchUser('${user.username}'); document.getElementById('searchInput').value = ''; document.getElementById('searchResults').classList.remove('show');">
          <div class="search-avatar">
            ${user.avatar ? `<img src="${user.avatar}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" alt="${user.name}">` : user.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div style="font-weight: 600; font-size: 14px;">${user.username}</div>
            <div style="font-size: 12px; color: #8e8e8e;">${user.name}</div>
          </div>
        </div>
      `).join("");
    }
    
    resultsDiv.classList.add("show");
  } catch (error) {
    console.error('Error searching users:', error);
  }
}

// Close search results when clicking outside
document.addEventListener("click", (e) => {
  if (!e.target.closest('.search-box')) {
    document.getElementById("searchResults").classList.remove("show");
  }
});

// ==================== NAVIGATION ====================

function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  
  event.target.closest('.tab').classList.add('active');
  document.getElementById(tabName + 'Tab').classList.add('active');
}

function switchUser(username) {
  currentUser = username;
  document.getElementById("userSelect").value = username;
  loadProfile(username);
  
  // Switch to home tab
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  document.querySelectorAll('.tab')[0].classList.add('active');
  document.getElementById('homeTab').classList.add('active');
}

document.getElementById("userSelect").onchange = (e) => {
  currentUser = e.target.value;
  loadProfile(currentUser);
};

// ==================== INITIALIZE ====================

initLogin();