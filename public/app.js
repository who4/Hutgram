let currentUser=null;
let viewedUser=null;
let selectedCategories=[];

/* ---------- COOKIES ---------- */
function setCookie(name,value){
  document.cookie=`${name}=${value};path=/;max-age=2592000`;
}
function getCookie(name){
  return document.cookie.split("; ").find(r=>r.startsWith(name+"="))?.split("=")[1];
}

/* ---------- INIT ---------- */
async function init(){
  const cats=await fetch("/api/categories").then(r=>r.json());
  document.getElementById("categoryGrid").innerHTML=cats.map(c=>
    `<div class="category-chip" onclick="toggleCat('${c}',this)">${c}</div>`).join("");
  document.getElementById("postCategory").innerHTML=cats.map(c=>`<option>${c}</option>`).join("");

  const saved=getCookie("hutgram_user");
  if(saved){
    currentUser=saved;
    viewedUser=saved;
    document.getElementById("loginPage").style.display="none";
    document.getElementById("mainApp").style.display="block";
    document.getElementById("whoAmI").textContent="@"+currentUser;
    loadProfile(currentUser);
  }
}
init();

/* ---------- LOGIN ---------- */
function toggleCat(cat,el){
  el.classList.toggle("selected");
  selectedCategories.includes(cat)
    ? selectedCategories=selectedCategories.filter(c=>c!==cat)
    : selectedCategories.push(cat);
}

async function login(){
  const username=loginUsername.value.trim();
  const name=loginName.value.trim();
  const bio=loginBio.value.trim();
  if(!username||!name||!selectedCategories.length)return alert("Fill everything");

  const avatarFile=loginAvatar.files[0];
  let avatar="";
  if(avatarFile){
    avatar=await new Promise(r=>{
      const fr=new FileReader();
      fr.onload=()=>r(fr.result);
      fr.readAsDataURL(avatarFile);
    });
  }

  const res=await fetch("/api/login",{method:"POST",headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username,name,bio,avatar,categories:selectedCategories})});
  if(!res.ok)return alert("Username exists");

  currentUser=username;
  viewedUser=username;
  setCookie("hutgram_user",username);

  loginPage.style.display="none";
  mainApp.style.display="block";
  whoAmI.textContent="@"+username;
  loadProfile(username);
}

/* ---------- NAV ---------- */
function switchTab(tab){
  homeTab.style.display="none";
  exploreTab.style.display="none";
  postTab.style.display="none";
  document.getElementById(tab+"Tab").style.display="block";
}
function goHome(){
  viewedUser=currentUser;
  switchTab("home");
  loadProfile(currentUser);
}

/* ---------- PROFILE ---------- */
async function loadProfile(u){
  const p=await fetch("/api/user/"+u).then(r=>r.json());
  profileUsername.textContent=p.username;
  profileBio.textContent=p.bio||"";
  postsCount.textContent=p.postsCount;
  followersCount.textContent=p.followersCount;
  followingCount.textContent=p.followingCount;

  profileAvatar.innerHTML=p.avatar?`<img src="${p.avatar}">`:p.name[0].toUpperCase();

  if(u!==currentUser){
    profileFollowBtn.style.display="inline";
    const f=await fetch(`/api/isfollowing/${currentUser}/${u}`).then(r=>r.json());
    profileFollowBtn.className="follow-btn "+(f.isFollowing?"following":"");
    profileFollowBtn.textContent=f.isFollowing?"Following":"Follow";
  }else profileFollowBtn.style.display="none";

  loadPosts(u);
}

/* ---------- FOLLOW ---------- */
async function toggleFollow(){
  const following=profileFollowBtn.classList.contains("following");
  await fetch(following?"/api/unfollow":"/api/follow",{method:"POST",headers:{'Content-Type':'application/json'},
    body:JSON.stringify({follower:currentUser,following:viewedUser})});
  loadProfile(viewedUser);
}

/* ---------- POSTS ---------- */
async function loadPosts(u){
  const posts=await fetch(`/api/user/${u}/posts`).then(r=>r.json());
  postsGrid.innerHTML=posts.map(p=>`
    <div class="post">
      ${p.image?`<img src="${p.image}">`:""}
      <div class="post-body">
        ❤️ ${p.likes}<br>${p.caption}
      </div>
    </div>`).join("");
}

async function createPost(){
  const caption=postCaption.value;
  const category=postCategory.value;
  let image="";
  if(postImage.files[0]){
    image=await new Promise(r=>{
      const fr=new FileReader();fr.onload=()=>r(fr.result);
      fr.readAsDataURL(postImage.files[0]);
    });
  }
  await fetch("/api/post",{method:"POST",headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username:currentUser,caption,image,category})});
  postCaption.value="";postImage.value="";
  goHome();
}
