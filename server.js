const express = require("express");
const neo4j = require("neo4j-driver");

// At the top of server.js
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static("public"));
app.use(express.json());

// Update the driver to use process.env
const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(
    process.env.NEO4J_USER,
    process.env.NEO4J_PASSWORD
  )
);


// ==================== CATEGORIES ====================

const CATEGORIES = [
  "Technology", "Travel", "Food", "Fashion", "Fitness",
  "Music", "Art", "Gaming", "Sports", "Photography",
  "Business", "Health", "Education", "Entertainment", "Lifestyle"
];

app.get("/api/categories", (req, res) => {
  res.json(CATEGORIES);
});

// ==================== USER MANAGEMENT ====================

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
      ORDER BY p.id DESC
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

    const users = result.records.map(r => ({
      username: r.get("username"),
      name: r.get("name"),
      avatar: r.get("avatar") || ""
    }));
    res.json(users);
  } finally {
    await session.close();
  }
});

// ==================== SUGGESTIONS ====================

app.get("/api/suggestions/:username", async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (me:User {username: $username})
      
      // Get user's categories
      WITH me, me.categories AS myCategories
      
      // Find friends of friends
      MATCH (me)-[:FOLLOWS]->(friend:User)-[:FOLLOWS]->(suggestion:User)
      WHERE NOT (me)-[:FOLLOWS]->(suggestion) AND me <> suggestion
      
      // Calculate category match
      WITH suggestion, count(DISTINCT friend) AS mutualFriends, myCategories
      
      // Get suggestion's info
      OPTIONAL MATCH (suggestion)-[:POSTED]->(posts:Post)
      OPTIONAL MATCH (suggestion)<-[:FOLLOWS]-(followers:User)
      
      WITH suggestion, mutualFriends, myCategories,
           count(DISTINCT posts) AS postCount,
           count(DISTINCT followers) AS followerCount,
           suggestion.categories AS theirCategories
      
      // Calculate category overlap
      WITH suggestion, mutualFriends, postCount, followerCount,
           size([cat IN myCategories WHERE cat IN theirCategories]) AS categoryMatch
      
      // Score: mutual friends (high weight) + category match + activity
      WITH suggestion, mutualFriends, categoryMatch,
           (mutualFriends * 15 + categoryMatch * 8 + postCount + followerCount) AS score
      
      RETURN suggestion.username AS username, 
             suggestion.name AS name, 
             suggestion.avatar AS avatar,
             suggestion.categories AS categories,
             mutualFriends,
             categoryMatch,
             score
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

// ==================== EXPLORE FEED ====================

app.get("/api/explore/:username", async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (me:User {username: $username})
      
      WITH me, me.categories AS myCategories
      
      // Posts from people I follow
      MATCH (me)-[:FOLLOWS]->(following:User)-[:POSTED]->(post:Post)
      
      OPTIONAL MATCH (post)<-[likes:LIKES]-(likers:User)
      OPTIONAL MATCH (post)<-[shares:SHARED]-(sharers:User)
      OPTIONAL MATCH (me)-[myLike:LIKES]->(post)
      OPTIONAL MATCH (me)-[myShare:SHARED]->(post)
      
      WITH me, post, following, myCategories,
           count(DISTINCT likes) AS likeCount,
           count(DISTINCT shares) AS shareCount,
           CASE WHEN myLike IS NOT NULL THEN true ELSE false END AS alreadyLiked,
           CASE WHEN myShare IS NOT NULL THEN true ELSE false END AS alreadyShared,
           size([cat IN myCategories WHERE cat IN post.categories]) AS categoryMatch,
           1 AS priority
      
      RETURN DISTINCT
        post.id AS id,
        post.caption AS caption,
        post.image AS image,
        post.categories AS categories,
        following.username AS author,
        following.name AS authorName,
        following.avatar AS authorAvatar,
        likeCount AS likes,
        shareCount AS shares,
        alreadyLiked,
        alreadyShared,
        categoryMatch,
        priority,
        true AS isUserPost
      
      UNION
      
      // Posts liked by people I follow
      MATCH (me:User {username: $username})
      MATCH (me)-[:FOLLOWS]->(friend:User)-[:LIKES]->(post:Post)
      WHERE NOT (me)-[:POSTED]->(post)
      
      OPTIONAL MATCH (author:User)-[:POSTED]->(post)
      OPTIONAL MATCH (post)<-[likes:LIKES]-(likers:User)
      OPTIONAL MATCH (post)<-[shares:SHARED]-(sharers:User)
      OPTIONAL MATCH (me)-[myLike:LIKES]->(post)
      OPTIONAL MATCH (me)-[myShare:SHARED]->(post)
      
      WITH me, post, author, me.categories AS myCategories,
           count(DISTINCT likes) AS likeCount,
           count(DISTINCT shares) AS shareCount,
           CASE WHEN myLike IS NOT NULL THEN true ELSE false END AS alreadyLiked,
           CASE WHEN myShare IS NOT NULL THEN true ELSE false END AS alreadyShared,
           size([cat IN myCategories WHERE cat IN post.categories]) AS categoryMatch
      
      RETURN DISTINCT
        post.id AS id,
        post.caption AS caption,
        post.image AS image,
        post.categories AS categories,
        COALESCE(author.username, post.author, 'unknown') AS author,
        COALESCE(author.name, post.author, 'Unknown User') AS authorName,
        author.avatar AS authorAvatar,
        likeCount AS likes,
        shareCount AS shares,
        alreadyLiked,
        alreadyShared,
        categoryMatch,
        2 AS priority,
        CASE WHEN author IS NOT NULL THEN true ELSE false END AS isUserPost
      
      ORDER BY priority ASC, categoryMatch DESC, likes DESC, id DESC
      LIMIT 40
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
      alreadyShared: r.get("alreadyShared"),
      isUserPost: r.get("isUserPost")
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

// ==================== ADMIN APIs ====================

app.get("/api/admin/posts", async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (p:Post)
      OPTIONAL MATCH (u:User)-[:POSTED]->(p)
      RETURN p.id AS id, p.caption AS caption, p.image AS image,
             p.categories AS categories,
             u.username AS username, p.author AS exploreAuthor
      ORDER BY p.id DESC
    `);
    const posts = result.records.map(r => ({
      id: r.get("id"),
      caption: r.get("caption"),
      image: r.get("image") || "",
      categories: r.get("categories") || [],
      username: r.get("username"),
      exploreAuthor: r.get("exploreAuthor")
    }));
    res.json(posts);
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
    const follows = result.records.map(r => ({
      follower: r.get("follower"),
      followerName: r.get("followerName"),
      following: r.get("following"),
      followingName: r.get("followingName")
    }));
    res.json(follows);
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
    const likes = result.records.map(r => ({
      username: r.get("username"),
      name: r.get("name"),
      postId: r.get("postId"),
      caption: r.get("caption")
    }));
    res.json(likes);
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
        CREATE (p:Post {
          id: $id, 
          caption: $caption, 
          image: $image,
          categories: $categories
        })
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
        CREATE (p:Post {
          id: $id, 
          caption: $caption, 
          image: $image, 
          author: $author,
          categories: $categories
        })
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

app.delete("/api/admin/post/:postId", async (req, res) => {
  const session = driver.session();
  try {
    await session.run(`
      MATCH (p:Post {id: $postId})
      DETACH DELETE p
    `, { postId: req.params.postId });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    await session.close();
  }
});



// At the bottom of server.js
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});