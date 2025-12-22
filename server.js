require("dotenv").config();

const express = require("express");
const neo4j = require("neo4j-driver");

const PORT = process.env.PORT || 3000;

["NEO4J_URI", "NEO4J_USER", "NEO4J_PASSWORD"].forEach((k) => {
  if (!process.env[k]) {
    throw new Error(`Missing environment variable: ${k}`);
  }
});

const app = express();
app.use(express.static("public"));
app.use(express.json({ limit: "10mb" })); // allow base64 images (8mb-ish)

app.get("/health", (req, res) => res.status(200).send("ok"));

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);

// ==================== CATEGORIES ====================

const CATEGORIES = [
  "Technology", "Travel", "Food", "Fashion", "Fitness",
  "Music", "Art", "Gaming", "Sports", "Photography",
  "Business", "Health", "Education", "Entertainment", "Lifestyle"
];

app.get("/api/categories", (req, res) => res.json(CATEGORIES));

// ==================== USER CREATE (LOGIN) ====================
// No passwords. This is just "create account" once.
// Reject if username already exists (your requirement).

app.post("/api/login", async (req, res) => {
  const { username, name, bio, avatar, categories } = req.body;

  if (!username || !name) {
    return res.status(400).json({ error: "username and name are required" });
  }

  const cleanUsername = String(username).trim().toLowerCase();
  if (!/^[a-z0-9._]{3,20}$/.test(cleanUsername)) {
    return res.status(400).json({ error: "username must be 3-20 chars: a-z 0-9 . _" });
  }

  const cats = Array.isArray(categories) ? categories : [];
  if (cats.length < 1) {
    return res.status(400).json({ error: "Select at least one category" });
  }
  const invalid = cats.find(c => !CATEGORIES.includes(c));
  if (invalid) {
    return res.status(400).json({ error: `Invalid category: ${invalid}` });
  }

  // optional avatar (base64 data url)
  if (avatar && typeof avatar === "string" && avatar.length > 10_000_000) {
    return res.status(400).json({ error: "avatar too large" });
  }

  const session = driver.session();
  try {
    const exists = await session.run(
      `MATCH (u:User {username:$username}) RETURN u LIMIT 1`,
      { username: cleanUsername }
    );
    if (exists.records.length > 0) {
      return res.status(409).json({ error: "Username already exists" });
    }

    await session.run(
      `CREATE (u:User {
        username: $username,
        name: $name,
        bio: $bio,
        avatar: $avatar,
        categories: $categories
      })`,
      {
        username: cleanUsername,
        name: String(name).trim(),
        bio: String(bio || "").trim(),
        avatar: avatar || "",
        categories: cats
      }
    );

    res.json({ success: true, username: cleanUsername });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    await session.close();
  }
});

// ==================== USER READ ====================

app.get("/api/users", async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (u:User)
      RETURN u.username AS username, u.name AS name, u.bio AS bio,
             u.avatar AS avatar, u.categories AS categories
      ORDER BY u.username
    `);
    const users = result.records.map(r => ({
      username: r.get("username"),
      name: r.get("name"),
      bio: r.get("bio") || "",
      avatar: r.get("avatar") || "",
      categories: r.get("categories") || []
    }));
    res.json(users);
  } finally {
    await session.close();
  }
});

app.get("/api/user/:username", async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (u:User {username: $username})
      OPTIONAL MATCH (u)-[:FOLLOWS]->(following:User)
      OPTIONAL MATCH (u)<-[:FOLLOWS]-(followers:User)
      OPTIONAL MATCH (u)-[:POSTED]->(posts:Post)
      RETURN u.username AS username, u.name AS name, u.bio AS bio,
             u.avatar AS avatar, u.categories AS categories,
             count(DISTINCT following) AS followingCount,
             count(DISTINCT followers) AS followersCount,
             count(DISTINCT posts) AS postsCount
    `, { username: req.params.username });

    if (result.records.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const record = result.records[0];
    res.json({
      username: record.get("username"),
      name: record.get("name"),
      bio: record.get("bio") || "",
      avatar: record.get("avatar") || "",
      categories: record.get("categories") || [],
      followingCount: record.get("followingCount").toNumber(),
      followersCount: record.get("followersCount").toNumber(),
      postsCount: record.get("postsCount").toNumber()
    });
  } finally {
    await session.close();
  }
});

app.get("/api/user/:username/posts", async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (u:User {username: $username})-[:POSTED]->(p:Post)
      OPTIONAL MATCH (p)<-[:LIKES]-(likers:User)
      OPTIONAL MATCH (p)<-[:SHARED]-(sharers:User)
      RETURN p.caption AS caption, p.image AS image, p.id AS id,
             p.categories AS categories,
             count(DISTINCT likers) AS likes,
             count(DISTINCT sharers) AS shares
      ORDER BY toInteger(p.id) DESC
    `, { username: req.params.username });

    const posts = result.records.map(r => ({
      id: r.get("id"),
      caption: r.get("caption"),
      image: r.get("image") || "",
      categories: r.get("categories") || [],
      likes: r.get("likes").toNumber(),
      shares: r.get("shares").toNumber()
    }));
    res.json(posts);
  } finally {
    await session.close();
  }
});

// Followers/following lists (for UI modal)
app.get("/api/user/:username/followers", async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (u:User {username:$username})<-[:FOLLOWS]-(f:User)
      RETURN f.username AS username, f.name AS name, f.avatar AS avatar
      ORDER BY f.username
      LIMIT 200
    `, { username: req.params.username });

    res.json(result.records.map(r => ({
      username: r.get("username"),
      name: r.get("name"),
      avatar: r.get("avatar") || ""
    })));
  } finally {
    await session.close();
  }
});

app.get("/api/user/:username/following", async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (u:User {username:$username})-[:FOLLOWS]->(f:User)
      RETURN f.username AS username, f.name AS name, f.avatar AS avatar
      ORDER BY f.username
      LIMIT 200
    `, { username: req.params.username });

    res.json(result.records.map(r => ({
      username: r.get("username"),
      name: r.get("name"),
      avatar: r.get("avatar") || ""
    })));
  } finally {
    await session.close();
  }
});

// Is following (for profile + suggestions)
app.get("/api/isfollowing/:follower/:following", async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      OPTIONAL MATCH (a:User {username: $follower})-[r:FOLLOWS]->(b:User {username: $following})
      RETURN COUNT(r) > 0 AS isFollowing
    `, { follower: req.params.follower, following: req.params.following });

    res.json({ isFollowing: result.records[0].get("isFollowing") });
  } finally {
    await session.close();
  }
});

// ==================== POSTS: user can create ====================

app.post("/api/post", async (req, res) => {
  const { username, caption, image, category } = req.body;

  if (!username || !caption) {
    return res.status(400).json({ error: "username and caption are required" });
  }
  if (!category || !CATEGORIES.includes(category)) {
    return res.status(400).json({ error: "valid category is required" });
  }
  if (image && typeof image === "string" && image.length > 12_000_000) {
    return res.status(400).json({ error: "image too large" });
  }

  const session = driver.session();
  try {
    const id = Date.now().toString();
    const result = await session.run(`
      MATCH (u:User {username:$username})
      CREATE (p:Post {
        id:$id,
        caption:$caption,
        image:$image,
        categories:[$category]
      })
      CREATE (u)-[:POSTED]->(p)
      RETURN p.id AS id
    `, {
      username,
      id,
      caption: String(caption).trim(),
      image: image || "",
      category
    });

    if (result.records.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ success: true, id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    await session.close();
  }
});

// ==================== SEARCH ====================

app.get("/api/search/users", async (req, res) => {
  const query = req.query.q || "";
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (u:User)
      WHERE toLower(u.username) CONTAINS toLower($query)
         OR toLower(u.name) CONTAINS toLower($query)
      RETURN u.username AS username, u.name AS name, u.avatar AS avatar
      LIMIT 10
    `, { query });

    res.json(result.records.map(r => ({
      username: r.get("username"),
      name: r.get("name"),
      avatar: r.get("avatar") || ""
    })));
  } finally {
    await session.close();
  }
});

// ==================== SUGGESTIONS (people) ====================

app.get("/api/suggestions/:username", async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (me:User {username: $username})
      WITH me, me.categories AS myCategories

      // Friends-of-friends suggestions
      OPTIONAL MATCH (me)-[:FOLLOWS]->(friend:User)-[:FOLLOWS]->(suggestion:User)
      WHERE NOT (me)-[:FOLLOWS]->(suggestion) AND me <> suggestion

      WITH me, myCategories, suggestion, count(DISTINCT friend) AS mutualFriends
      WHERE suggestion IS NOT NULL

      OPTIONAL MATCH (suggestion)-[:POSTED]->(posts:Post)
      OPTIONAL MATCH (suggestion)<-[:FOLLOWS]-(followers:User)

      WITH suggestion, mutualFriends, myCategories,
           count(DISTINCT posts) AS postCount,
           count(DISTINCT followers) AS followerCount,
           suggestion.categories AS theirCategories

      WITH suggestion, mutualFriends, postCount, followerCount,
           size([cat IN myCategories WHERE cat IN theirCategories]) AS categoryMatch

      WITH suggestion, mutualFriends, categoryMatch,
           (mutualFriends * 15 + categoryMatch * 10 + postCount + followerCount) AS score

      RETURN suggestion.username AS username,
             suggestion.name AS name,
             suggestion.avatar AS avatar,
             suggestion.categories AS categories,
             mutualFriends,
             categoryMatch
      ORDER BY score DESC, mutualFriends DESC
      LIMIT 8
    `, { username: req.params.username });

    res.json(result.records.map(r => ({
      username: r.get("username"),
      name: r.get("name"),
      avatar: r.get("avatar") || "",
      categories: r.get("categories") || [],
      mutualFriends: r.get("mutualFriends").toNumber(),
      categoryMatch: r.get("categoryMatch").toNumber()
    })));
  } finally {
    await session.close();
  }
});

// ==================== EXPLORE FEED (improved) ====================
// Includes:
// 1) posts from following
// 2) posts liked by following
// 3) category-matched posts from anyone (so Explore isn't empty)

app.get("/api/explore/:username", async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (me:User {username: $username})
      WITH me, me.categories AS myCategories

      // -------- (1) Posts from people I follow --------
      CALL {
        WITH me, myCategories
        MATCH (me)-[:FOLLOWS]->(author:User)-[:POSTED]->(post:Post)
        OPTIONAL MATCH (post)<-[likes:LIKES]-(:User)
        OPTIONAL MATCH (post)<-[shares:SHARED]-(:User)
        OPTIONAL MATCH (me)-[myLike:LIKES]->(post)
        OPTIONAL MATCH (me)-[myShare:SHARED]->(post)
        RETURN
          post, author,
          count(DISTINCT likes) AS likeCount,
          count(DISTINCT shares) AS shareCount,
          (myLike IS NOT NULL) AS alreadyLiked,
          (myShare IS NOT NULL) AS alreadyShared,
          size([cat IN myCategories WHERE cat IN post.categories]) AS categoryMatch,
          1 AS priority
      }

      RETURN
        post.id AS id,
        post.caption AS caption,
        post.image AS image,
        post.categories AS categories,
        author.username AS author,
        author.name AS authorName,
        author.avatar AS authorAvatar,
        likeCount AS likes,
        shareCount AS shares,
        alreadyLiked,
        alreadyShared,
        priority,
        categoryMatch

      UNION

      // -------- (2) Posts liked by people I follow --------
      MATCH (me:User {username: $username})
      WITH me, me.categories AS myCategories
      MATCH (me)-[:FOLLOWS]->(friend:User)-[:LIKES]->(post:Post)
      OPTIONAL MATCH (author:User)-[:POSTED]->(post)
      WHERE author IS NOT NULL AND author.username <> me.username

      OPTIONAL MATCH (post)<-[likes:LIKES]-(:User)
      OPTIONAL MATCH (post)<-[shares:SHARED]-(:User)
      OPTIONAL MATCH (me)-[myLike:LIKES]->(post)
      OPTIONAL MATCH (me)-[myShare:SHARED]->(post)

      WITH me, myCategories, post, author,
           count(DISTINCT likes) AS likeCount,
           count(DISTINCT shares) AS shareCount,
           (myLike IS NOT NULL) AS alreadyLiked,
           (myShare IS NOT NULL) AS alreadyShared,
           size([cat IN myCategories WHERE cat IN post.categories]) AS categoryMatch

      RETURN
        post.id AS id,
        post.caption AS caption,
        post.image AS image,
        post.categories AS categories,
        author.username AS author,
        author.name AS authorName,
        author.avatar AS authorAvatar,
        likeCount AS likes,
        shareCount AS shares,
        alreadyLiked,
        alreadyShared,
        2 AS priority,
        categoryMatch

      UNION

      // -------- (3) Category-matched posts from anyone --------
      MATCH (me:User {username: $username})
      WITH me, me.categories AS myCategories
      MATCH (author:User)-[:POSTED]->(post:Post)
      WHERE author.username <> me.username
        AND NOT (me)-[:FOLLOWS]->(author)

      OPTIONAL MATCH (post)<-[likes:LIKES]-(:User)
      OPTIONAL MATCH (post)<-[shares:SHARED]-(:User)
      OPTIONAL MATCH (me)-[myLike:LIKES]->(post)
      OPTIONAL MATCH (me)-[myShare:SHARED]->(post)

      WITH myCategories, post, author,
           count(DISTINCT likes) AS likeCount,
           count(DISTINCT shares) AS shareCount,
           (myLike IS NOT NULL) AS alreadyLiked,
           (myShare IS NOT NULL) AS alreadyShared,
           size([cat IN myCategories WHERE cat IN post.categories]) AS categoryMatch
      WHERE categoryMatch > 0

      RETURN
        post.id AS id,
        post.caption AS caption,
        post.image AS image,
        post.categories AS categories,
        author.username AS author,
        author.name AS authorName,
        author.avatar AS authorAvatar,
        likeCount AS likes,
        shareCount AS shares,
        alreadyLiked,
        alreadyShared,
        3 AS priority,
        categoryMatch

      ORDER BY priority ASC, categoryMatch DESC, likes DESC, shares DESC, toInteger(id) DESC
      LIMIT 60
    `, { username: req.params.username });

    res.json(result.records.map(r => ({
      id: r.get("id"),
      caption: r.get("caption"),
      image: r.get("image") || "",
      categories: r.get("categories") || [],
      author: r.get("author"),
      authorName: r.get("authorName"),
      authorAvatar: r.get("authorAvatar") || "",
      likes: r.get("likes").toNumber(),
      shares: r.get("shares").toNumber(),
      alreadyLiked: r.get("alreadyLiked"),
      alreadyShared: r.get("alreadyShared")
    })));
  } finally {
    await session.close();
  }
});

// ==================== USER ACTIONS ====================

app.post("/api/like", async (req, res) => {
  const { username, postId } = req.body;
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (u:User {username: $username})
      MATCH (p:Post {id: $postId})
      MERGE (u)-[:LIKES]->(p)
      RETURN u, p
    `, { username, postId: postId.toString() });

    if (result.records.length === 0) {
      return res.status(404).json({ error: "User or Post not found" });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    await session.close();
  }
});

app.post("/api/unlike", async (req, res) => {
  const { username, postId } = req.body;
  const session = driver.session();
  try {
    await session.run(`
      MATCH (u:User {username: $username})-[r:LIKES]->(p:Post {id: $postId})
      DELETE r
    `, { username, postId: postId.toString() });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    await session.close();
  }
});

app.post("/api/share", async (req, res) => {
  const { username, postId } = req.body;
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (u:User {username: $username})
      MATCH (p:Post {id: $postId})
      MERGE (u)-[:SHARED]->(p)
      RETURN u, p
    `, { username, postId: postId.toString() });

    if (result.records.length === 0) {
      return res.status(404).json({ error: "User or Post not found" });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    await session.close();
  }
});

app.post("/api/unshare", async (req, res) => {
  const { username, postId } = req.body;
  const session = driver.session();
  try {
    await session.run(`
      MATCH (u:User {username: $username})-[r:SHARED]->(p:Post {id: $postId})
      DELETE r
    `, { username, postId: postId.toString() });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    await session.close();
  }
});

app.post("/api/follow", async (req, res) => {
  const { follower, following } = req.body;
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (a:User {username: $follower})
      MATCH (b:User {username: $following})
      MERGE (a)-[:FOLLOWS]->(b)
      RETURN a, b
    `, { follower, following });

    if (result.records.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    await session.close();
  }
});

app.post("/api/unfollow", async (req, res) => {
  const { follower, following } = req.body;
  const session = driver.session();
  try {
    await session.run(`
      MATCH (a:User {username: $follower})-[r:FOLLOWS]->(b:User {username: $following})
      DELETE r
    `, { follower, following });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    await session.close();
  }
});

// ==================== ADMIN APIs (kept) ====================
// Your existing admin.html uses these. Leaving them as-is.

app.get("/api/admin/posts", async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (p:Post)
      OPTIONAL MATCH (u:User)-[:POSTED]->(p)
      RETURN p.id AS id, p.caption AS caption, p.image AS image,
             p.categories AS categories,
             u.username AS username, p.author AS exploreAuthor
      ORDER BY toInteger(p.id) DESC
    `);
    res.json(result.records.map(r => ({
      id: r.get("id"),
      caption: r.get("caption"),
      image: r.get("image") || "",
      categories: r.get("categories") || [],
      username: r.get("username"),
      exploreAuthor: r.get("exploreAuthor")
    })));
  } finally {
    await session.close();
  }
});

app.get("/api/admin/follows", async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (a:User)-[:FOLLOWS]->(b:User)
      RETURN a.username AS follower, a.name AS followerName,
             b.username AS following, b.name AS followingName
      ORDER BY a.username
    `);
    res.json(result.records.map(r => ({
      follower: r.get("follower"),
      followerName: r.get("followerName"),
      following: r.get("following"),
      followingName: r.get("followingName")
    })));
  } finally {
    await session.close();
  }
});

app.get("/api/admin/likes", async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (u:User)-[:LIKES]->(p:Post)
      RETURN u.username AS username, u.name AS name,
             p.id AS postId, p.caption AS caption
      ORDER BY u.username
    `);
    res.json(result.records.map(r => ({
      username: r.get("username"),
      name: r.get("name"),
      postId: r.get("postId"),
      caption: r.get("caption")
    })));
  } finally {
    await session.close();
  }
});

app.post("/api/admin/user", async (req, res) => {
  const { username, name, bio, avatar, categories } = req.body;
  const session = driver.session();
  try {
    await session.run(`
      CREATE (u:User {
        username: $username,
        name: $name,
        bio: $bio,
        avatar: $avatar,
        categories: $categories
      })
    `, {
      username,
      name,
      bio: bio || "",
      avatar: avatar || "",
      categories: categories || []
    });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    await session.close();
  }
});

app.post("/api/admin/post", async (req, res) => {
  const { username, caption, image, id, author, categories } = req.body;
  const session = driver.session();
  try {
    if (username) {
      await session.run(`
        MATCH (u:User {username: $username})
        CREATE (p:Post { id:$id, caption:$caption, image:$image, categories:$categories })
        CREATE (u)-[:POSTED]->(p)
      `, {
        username,
        caption,
        image: image || "",
        id: id || Date.now().toString(),
        categories: categories || []
      });
    } else {
      await session.run(`
        CREATE (p:Post { id:$id, caption:$caption, image:$image, author:$author, categories:$categories })
      `, {
        caption,
        image: image || "",
        id: id || Date.now().toString(),
        author: author || "Unknown User",
        categories: categories || []
      });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    await session.close();
  }
});

app.post("/api/admin/follow", async (req, res) => {
  const { follower, following } = req.body;
  const session = driver.session();
  try {
    await session.run(`
      MATCH (a:User {username: $follower})
      MATCH (b:User {username: $following})
      MERGE (a)-[:FOLLOWS]->(b)
    `, { follower, following });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    await session.close();
  }
});

app.post("/api/admin/like", async (req, res) => {
  const { username, postId } = req.body;
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (u:User {username: $username})
      MATCH (p:Post {id: $postId})
      MERGE (u)-[:LIKES]->(p)
      RETURN u, p
    `, { username, postId: postId.toString() });

    if (result.records.length === 0) {
      return res.status(404).json({ error: "User or Post not found" });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    await session.close();
  }
});

app.delete("/api/admin/user/:username", async (req, res) => {
  const session = driver.session();
  try {
    await session.run(`
      MATCH (u:User {username: $username})
      DETACH DELETE u
    `, { username: req.params.username });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    await session.close();
  }
});

app.delete("/api/admin/post/:id", async (req, res) => {
  const session = driver.session();
  try {
    await session.run(`
      MATCH (p:Post {id:$id})
      DETACH DELETE p
    `, { id: req.params.id });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    await session.close();
  }
});

app.listen(PORT, () => console.log("Server running on port", PORT));
